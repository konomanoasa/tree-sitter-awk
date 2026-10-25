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
  sourcePreservationCases,
} from "./support/workloads.js";

test("awk: keyword parameter repairs preserve simple-name shadowing and qualified reservations", () => {
  for (const name of ["switch", "case", "default", "BEGINFILE", "ENDFILE"]) {
    const prefix = `function f(${name}) {return `;
    const initial = `${prefix}awk::${name}}`;
    edited(initial, `${prefix}${name}}`, [
      { byte: prefix.length, deleteBytes: 5, insert: "" },
    ]);
    edited(initial, `${prefix}lib::${name}}`, [
      { byte: prefix.length, deleteBytes: 3, insert: "lib" },
    ]);
  }
});

test("awk: field-only ownership changes retain the fresh CST after edits", () => {
  edited("axc?d:e", "a?b:c?d:e", [{ byte: 1, deleteBytes: 1, insert: "?b:" }]);
  edited("getline x++ y", "getline;x++ y", [
    { byte: 7, deleteBytes: 1, insert: ";" },
  ]);
});

test("awk: regex literal edits preserve text leaves through composite source changes", () => {
  const initial = String.raw`/\x5c\\./`;
  const final = "/\\x5c\\\\\\\n./";
  edited(initial, final, [{ byte: 7, deleteBytes: 0, insert: "\\\n" }]);
  edited(final, initial, [{ byte: 7, deleteBytes: 2, insert: "" }]);
});

test("awk: repairing directive names restores ordinary and indirect qualified names", () => {
  for (const name of ["include", "load", "namespace", "nsinclude"]) {
    edited(`awk::${name}`, `lib::${name}`, [
      { byte: 0, deleteBytes: 3, insert: "lib" },
    ]);
    edited(`@${name}(1)`, `@${name}_fn(1)`, [
      { byte: name.length + 1, deleteBytes: 0, insert: "_fn" },
    ]);
    edited(`@${name}(1)`, `@${name}::f(1)`, [
      { byte: name.length + 1, deleteBytes: 0, insert: "::f" },
    ]);
  }
});

test("awk: comparison chain edits retain fresh associativity and output redirection", () => {
  for (const { initial, final, byte, insert } of [
    { initial: "a < b", final: "a < b < c", byte: 5, insert: " < c" },
    {
      initial: "a < b | getline x",
      final: "a < b | getline x >= c",
      byte: 17,
      insert: " >= c",
    },
    {
      initial: "BEGIN {print a < b > out}",
      final: "BEGIN {print a < b == c > out}",
      byte: 18,
      insert: " == c",
    },
  ]) {
    edited(initial, final, [{ byte, deleteBytes: 0, insert }]);
    edited(final, initial, [{ byte, deleteBytes: insert.length, insert: "" }]);
  }
});

test("awk: namespace edits reclassify later GNU builtins", () => {
  edited(
    '@namespace "awk"\nBEGIN {print systime (3)}',
    '@namespace "lib"\nBEGIN {print systime (3)}',
    [{ byte: 12, deleteBytes: 3, insert: "lib" }],
  );
  edited(
    '@namespace "lib"\nBEGIN {print systime (3)}',
    '@namespace "awk"\nBEGIN {print systime (3)}',
    [{ byte: 12, deleteBytes: 3, insert: "awk" }],
  );
});

test("awk: parameter edits change body classification and keep following functions independent", () => {
  edited(
    "function f(systime) {return systime (3)}\nBEGIN {print systime (3)}",
    "function f(local) {return systime (3)}\nBEGIN {print systime (3)}",
    [{ byte: 11, deleteBytes: 7, insert: "local" }],
  );
  const initial =
    "function f(systime) {return awk::systime (3)} BEGIN {print awk::systime (3)}";
  const final =
    "function f(local) {return awk::systime (3)} BEGIN {print awk::systime (3)}";
  edited(initial, final, [{ byte: 11, deleteBytes: 7, insert: "local" }]);
  edited(final, initial, [{ byte: 11, deleteBytes: 5, insert: "systime" }]);
});

test("awk: top-level repairs retain adjacent definitions and directive namespace changes", () => {
  for (const [initial, final, edit] of [
    [";BEGIN {}", "BEGIN {}", { byte: 0, deleteBytes: 1, insert: "" }],
    ["BEGIN {};;", "BEGIN {};", { byte: 9, deleteBytes: 1, insert: "" }],
    [
      "BEGIN {} BEGIN {}",
      "BEGIN {}; BEGIN {}",
      { byte: 8, deleteBytes: 0, insert: ";" },
    ],
    [
      "BEGIN {} function f() {}",
      "BEGIN {}; function f() {}",
      { byte: 8, deleteBytes: 0, insert: ";" },
    ],
    [
      'BEGIN {} @namespace "include"\nBEGIN {print systime (3)}',
      'BEGIN {} @namespace "library"\nBEGIN {print systime (3)}',
      { byte: 21, deleteBytes: 7, insert: "library" },
    ],
  ])
    edited(initial, final, [edit]);
});

test("awk: repairing subscript adjacency restores nested owners after external extras", () => {
  const source = "BEGIN {print a [1][2][3]}";
  const byte = source.indexOf("][") + 1;
  for (const insert of [" ", "\t", "\r", "\\\n", "# comment\n"]) {
    edited(`${source.slice(0, byte)}${insert}${source.slice(byte)}`, source, [
      { byte, deleteBytes: Buffer.byteLength(insert), insert: "" },
    ]);
  }
  edited("a[1]", "a[1][2]", [{ byte: 4, deleteBytes: 0, insert: "[2]" }]);
  edited("a[1][2]", "a[1]", [{ byte: 4, deleteBytes: 3, insert: "" }]);
});

test("awk: numeric escape edits change regex roles while retaining source ranges", () => {
  edited(String.raw`/a\x2bb/`, String.raw`/a\x2ab/`, [
    { byte: 5, deleteBytes: 1, insert: "a" },
  ]);
  edited(String.raw`/\x28a\x29/`, String.raw`/\x28a\x29b/`, [
    { byte: 10, deleteBytes: 0, insert: "b" },
  ]);
  edited(String.raw`/\x5cw/`, String.raw`/\x5cW/`, [
    { byte: 5, deleteBytes: 1, insert: "W" },
  ]);
  edited(String.raw`/[a\x5d]/`, String.raw`/[a\x5e]/`, [
    { byte: 6, deleteBytes: 1, insert: "e" },
  ]);
  edited(String.raw`/\x5c\./`, String.raw`/\x5c\\./`, [
    { byte: 5, deleteBytes: 0, insert: "\\" },
  ]);
  edited(String.raw`/\x5c\\./`, String.raw`/\x5c\./`, [
    { byte: 5, deleteBytes: 1, insert: "" },
  ]);
});

test("awk: inserting and removing continuation inside an escape preserves the decoded role", () => {
  edited(String.raw`/a\x2b/`, "/a\\x2\\\nb/", [
    { byte: 5, deleteBytes: 0, insert: "\\\n" },
  ]);
  edited("/a\\x2\\\nb/", String.raw`/a\x2b/`, [
    { byte: 5, deleteBytes: 2, insert: "" },
  ]);
});

test("awk: edits after output parentheses reselect the owner of the parentheses", () => {
  for (const tail of ["+b", ",b", " in arr", " > file"]) {
    const initial = "BEGIN {print (a)}";
    const final = `BEGIN {print (a)${tail}}`;
    edited(initial, final, [{ byte: 16, deleteBytes: 0, insert: tail }]);
    edited(final, initial, [
      { byte: 16, deleteBytes: Buffer.byteLength(tail), insert: "" },
    ]);
  }
});

test("awk: for-header edits switch between array iteration and a membership initializer", () => {
  edited("BEGIN {for(i in a) {}}", "BEGIN {for(i in a;0;) {}}", [
    { byte: 17, deleteBytes: 0, insert: ";0;" },
  ]);
});

test("awk: newlines before else are reclassified when the following statement changes", () => {
  const before = "BEGIN {if(x) {}\nprint 1;}";
  const after = "BEGIN {if(x) {}\nelse print 1;}";
  edited(before, after, [{ byte: 16, deleteBytes: 0, insert: "else " }]);
  edited(after, before, [{ byte: 16, deleteBytes: 5, insert: "" }]);
  for (const consequence of ["{}", "a;", "a\n", "{}\n# comment"]) {
    const initial = `BEGIN {\nif (x) ${consequence}\nelsx\na\nb\nd\n}`;
    const far = initial.lastIndexOf("d");
    const byte = initial.indexOf("elsx") + 3;
    edited(
      initial,
      `${initial.slice(0, byte)}e${initial.slice(byte + 1, far)}dd${initial.slice(far + 1)}`,
      [
        { byte: far, deleteBytes: 1, insert: "dd" },
        { byte, deleteBytes: 1, insert: "e" },
      ],
    );
  }
});

test("awk: do completion edits restore statement and else ownership", () => {
  const source = "BEGIN {if(x) do {} while(0) else print 2}";
  const byte = source.indexOf(" else");
  for (const insert of [";", "\n", "\n# comment\n"]) {
    edited(`${source.slice(0, byte)}${insert}${source.slice(byte)}`, source, [
      { byte, deleteBytes: Buffer.byteLength(insert), insert: "" },
    ]);
  }
  const initial = "BEGIN {do {} while(0)}";
  const end = initial.lastIndexOf("}");
  for (const insert of [";", "\n", " print 2"]) {
    const final = `${initial.slice(0, end)}${insert}}`;
    edited(initial, final, [{ byte: end, deleteBytes: 0, insert }]);
    edited(final, initial, [
      { byte: end, deleteBytes: Buffer.byteLength(insert), insert: "" },
    ]);
  }
});

test("awk: regexp repairs restore endpoint order and raw slash boundaries", () => {
  for (const { initial, final, byte, deleteBytes, insert } of [
    {
      initial: "/[z-a]/",
      final: "/[z-z]/",
      byte: 4,
      deleteBytes: 1,
      insert: "z",
    },
    {
      initial: "/[[.z.]-[.a.]]/",
      final: "/[[.z.]-[.z.]]/",
      byte: 10,
      deleteBytes: 1,
      insert: "z",
    },
    {
      initial: "/]x[/]/",
      final: String.raw`/]x[\/]/`,
      byte: 4,
      deleteBytes: 0,
      insert: "\\",
    },
  ])
    edited(initial, final, [{ byte, deleteBytes, insert }]);
});

test("awk: regexp edits reclassify intervals ranges raw slash boundaries and UTF-8 escapes", () => {
  const changes = [
    {
      initial: "/[[:alpha:]-a]/",
      final: "/[[=a=]-a]/",
      byte: 3,
      deleteBytes: 7,
      insert: "=a=",
    },
    {
      initial: "/a{1,2}/",
      final: "/a{1,3}/",
      byte: 5,
      deleteBytes: 1,
      insert: "3",
    },
    {
      initial: "/a{,2}/",
      final: "/a{1,2}/",
      byte: 3,
      deleteBytes: 0,
      insert: "1",
    },
    {
      initial: "/[a-c]/",
      final: String.raw`/[a\/c]/`,
      byte: 3,
      deleteBytes: 1,
      insert: String.raw`\/`,
    },
    {
      initial: String.raw`/[[:alpha:]\/]/`,
      final: String.raw`/[[:digit:]\/]/`,
      byte: 4,
      deleteBytes: 5,
      insert: "digit",
    },
    {
      initial: String.raw`/\xc3\xa9/`,
      final: String.raw`/\xc3\xff/`,
      byte: 7,
      deleteBytes: 2,
      insert: "ff",
    },
    {
      initial: String.raw`/\xed\x9f\xbf/`,
      final: String.raw`/\xed\xaf\xbf/`,
      byte: 7,
      deleteBytes: 1,
      insert: "a",
    },
    {
      initial: String.raw`/[\xed\xa0\x80-\xed\xbf\xbf]/`,
      final: "/[\\xed\\xa0\\\n\\x80-\\xed\\xbf\\xbf]/",
      byte: 10,
      deleteBytes: 0,
      insert: "\\\n",
    },
    {
      initial: String.raw`/a\u110000/`,
      final: String.raw`/a\u00003f/`,
      byte: 4,
      deleteBytes: 6,
      insert: "00003f",
    },
    {
      initial: String.raw`/[[:alpha:]\/]/`,
      final: String.raw`/[[:alpha\x3a]\/]/`,
      byte: 9,
      deleteBytes: 1,
      insert: String.raw`\x3a`,
    },
    {
      initial: "/[[.a.]]/",
      final: String.raw`/[[.a.\x5d]/`,
      byte: 6,
      deleteBytes: 1,
      insert: String.raw`\x5d`,
    },
    {
      initial: "/[[=a=]]/",
      final: String.raw`/[[=a=]\x5d/`,
      byte: 7,
      deleteBytes: 1,
      insert: String.raw`\x5d`,
    },
  ];
  for (const { initial, final, byte, deleteBytes, insert } of changes) {
    edited(initial, final, [{ byte, deleteBytes, insert }]);
    edited(final, initial, [
      {
        byte,
        deleteBytes: Buffer.byteLength(insert),
        insert: initial.slice(byte, byte + deleteBytes),
      },
    ]);
  }
});

test("awk: repairs restore names literals and statement ownership across syntax boundaries", () => {
  const sources = [
    '@namespace "lib"\nfunction f(systime) {return systime (3)}\nBEGIN {print systime (3)}',
    "function f(switch) {return switch}\nBEGIN {switch(x) {case @/a{1,2}/: print (a)+b;}}",
    'BEGIN {if(x) {print "é"}\nelse print /[[:alpha:]\\/]/; getline a[i] < file}',
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
    String.raw`/[[:alpha:]\/]\x28a\x29+?\xc3\xa9/`,
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
  const randomSeed = 0x61a9203e;
  let random = randomSeed;
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
  for (const size of sizes) {
    test(`awk: ${name}/${size} complete after editing`, () => {
      const contents = source(size);
      checkWorkload(
        `${name}/${size}`,
        contents,
        replacement(contents, "x", "y"),
        successful,
      );
    });
  }
}

for (const { name, source } of sourcePreservationCases) {
  test(`awk: ${name} retain the fresh CST after an EOF edit`, () => {
    edited(source, `${source}\n`, [
      { byte: Buffer.byteLength(source), deleteBytes: 0, insert: "\n" },
    ]);
  });
}
