import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  clean,
  edited,
  parse,
  parseSummary,
} from "./support/parser.js";
import {
  normalWorkloads,
  replacement,
  scalingCases,
  scalingItemCounts,
} from "./support/workloads.js";

test("awk: repairs restore names literals and statement ownership across syntax boundaries", () => {
  const sources = [
    '@namespace "lib"\nfunction f(systime) {return systime (3)}\nBEGIN {print systime (3)}',
    "function f(switch) {return switch}\nBEGIN {switch(x) {case @/a{1,2}/: print (a)+b;}}",
    'BEGIN {if(x) {print "é"}\nelse print /[[:alpha:]/]/; getline a[i] < file}',
    String.raw`BEGIN {x = @/\x28a\x29+?/; print (x), y > dest}`,
    "BEGIN {for(i in a; i < 3; i++) {print a[i]} }",
  ];
  for (const source of sources) {
    clean(source);
    const bytes = Buffer.from(source);
    for (const mark of ['"', "}", ")", "/", ";", "(", "{"]) {
      const byte = bytes.lastIndexOf(mark);
      if (byte < 0) continue;
      const broken = Buffer.concat([
        bytes.subarray(0, byte),
        bytes.subarray(byte + 1),
      ]).toString();
      const first = parse(broken);
      assert.equal(first.tree, parse(broken).tree);
      edited(broken, source, [{ byte, deleteBytes: 0, insert: mark }]);
      edited(source, source, [
        { byte, deleteBytes: 1, insert: "" },
        { byte, deleteBytes: 0, insert: mark },
      ]);
    }
    const replacement = 'BEGINFILE {print "replacement"}';
    edited(source, replacement, [
      { byte: 0, deleteBytes: bytes.length, insert: replacement },
    ]);
  }
});

test("awk: fixed-seed generated histories restore fresh CSTs after repairs", () => {
  const historyCount = 512;
  const forwardEditCount = 6;
  const maximumDeletionBytes = 2;
  const seeds = [
    '@namespace "lib"\nfunction f(systime) {return systime (3)}\nBEGIN {print systime(3)}',
    "BEGIN {switch(x) {case @/a{1,2}/: print (a)+b; default: break;}}",
    String.raw`/[[:alpha:]/]\x28a\x29+?\xc3\xa9/`,
    "BEGIN {getline a[i] < file; print (a), b > dest}",
  ];
  const insertions = [
    "",
    "x",
    " ",
    "\n",
    "\\",
    "/",
    "{",
    "}",
    '"',
    "(",
    ")",
    ";",
    "?",
  ];
  let random = 0x61a9203e;
  const next = () => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return random >>> 0;
  };
  for (let history = 0; history < historyCount; history++) {
    const original = seeds[history % seeds.length];
    let source = Buffer.from(original);
    const edits = [];
    const reversals = [];
    for (let step = 0; step < forwardEditCount * 2; step++) {
      let edit;
      if (step < forwardEditCount) {
        const byte = next() % (source.length + 1);
        const deleteBytes = Math.min(
          next() % (maximumDeletionBytes + 1),
          source.length - byte,
        );
        const insert = insertions[next() % insertions.length];
        edit = { byte, deleteBytes, insert };
        reversals.push({
          byte,
          deleteBytes: Buffer.byteLength(insert),
          insert: source.subarray(byte, byte + deleteBytes).toString(),
        });
      } else {
        edit = reversals.pop();
      }
      edits.push(edit);
      source = applyEdits(source, [edit]);
      const fresh = parse(source);
      const incremental = parse(original, edits);
      if (fresh.status === 0) {
        assert.equal(
          incremental.status,
          0,
          `history ${history}, step ${step}: ${incremental.output}`,
        );
        assert.equal(
          incremental.tree,
          fresh.tree,
          `history ${history}, step ${step}`,
        );
      }
    }
    assert.deepEqual(source, Buffer.from(original));
    edited(original, original, edits);
  }
});

function checkWorkload(name, source, edit, successful = true) {
  const final = applyEdits(source, [edit]);
  assert.equal(parseSummary(final).successful, successful, `${name}: fresh`);
  assert.equal(
    parseSummary(source, [edit]).successful,
    successful,
    `${name}: incremental`,
  );
}
for (const { name, run } of normalWorkloads()) {
  test(`awk: ${name} complete after editing`, () => run(checkWorkload));
}
for (const {
  name,
  sizes = scalingItemCounts,
  source,
  successful = true,
} of scalingCases) {
  test(`awk: ${name} complete after editing at each scale`, () => {
    for (const size of sizes) {
      const contents = source(size);
      checkWorkload(
        `${name}/${size}`,
        contents,
        replacement(contents, "x", "y"),
        successful,
      );
    }
  });
}
