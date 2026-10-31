import assert from "node:assert/strict";
import { test } from "node:test";
import { edited, parse } from "./support/parser.js";

test("awk: removing a backslash repairs forbidden raw controls in quoted literals", () => {
  const rejected = [
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13,
    0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    0x7f,
  ];
  for (const [prefix, suffix] of [
    ['BEGIN {print "', '"}\n'],
    ['BEGIN {print _"', '"}\n'],
    ['@include "', '"\nBEGIN {print 1}\n'],
    ['@load "', '"\nBEGIN {print 1}\n'],
    ['@nsinclude "', '"\nBEGIN {print 1}\n'],
  ]) {
    for (const leading of ["", "a"]) {
      for (const code of rejected) {
        const head = prefix + leading;
        const tail = `${String.fromCharCode(code)}b${suffix}`;
        const initial = `${head}\\${tail}`;
        assert.equal(parse(initial).status, 1, JSON.stringify(initial));
        edited(initial, head + tail, [
          { byte: head.length, deleteBytes: 1, insert: "" },
        ]);
        const paired = `${head}\\\\${tail}`;
        assert.equal(parse(paired).status, 0, JSON.stringify(paired));
      }
    }
  }
});

test("awk: quoted escapes retain the permitted raw control boundaries", () => {
  for (const code of [0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d]) {
    for (const [prefix, suffix] of [
      ['BEGIN {print "', '"}\n'],
      ['@include "', '"\n'],
    ]) {
      const source = `${prefix}a\\${String.fromCharCode(code)}b${suffix}`;
      assert.equal(parse(source).status, 0, JSON.stringify(source));
    }
  }
});

test("awk: directive parameter edits restore indirect calls without leaking to other functions", () => {
  for (const name of ["include", "load", "namespace", "nsinclude"]) {
    const prefix = `function f(${name}) {return @${name}(1)}\n`;
    const broken = `${prefix}function g(local) {return @${name}(1)}`;
    const repaired = `${prefix}function g(${name}) {return @${name}(1)}`;
    const byte = Buffer.byteLength(prefix) + 11;
    assert.equal(parse(broken).status, 1);
    edited(broken, repaired, [{ byte, deleteBytes: 5, insert: name }]);
    edited(repaired, repaired, [
      { byte, deleteBytes: name.length, insert: "local" },
      { byte, deleteBytes: 5, insert: name },
    ]);
  }
});

test("awk: operator layout edits preserve continuation boundaries", () => {
  for (const { source, byte } of [
    { source: "1 &&\f1", byte: 4 },
    { source: "0 ||\v1", byte: 4 },
    { source: "1 ?\f2 : 3", byte: 3 },
    { source: "0 ? 2 :\v3", byte: 7 },
  ]) {
    const broken = `${source.slice(0, byte)}\\\n${source.slice(byte)}`;
    assert.equal(parse(broken).status, 1);
    edited(broken, source, [{ byte, deleteBytes: 2, insert: "" }]);
    edited(source, source, [
      { byte, deleteBytes: 0, insert: "\\\n" },
      { byte, deleteBytes: 2, insert: "" },
    ]);
  }
});

test("awk: unterminated literals parse deterministically and repairs restore fresh CSTs", () => {
  const prefix = '@namespace "lib"\nfunction f(systime) {\nprint ';
  const suffix =
    "\nprint systime (3), lib::x; x /= 2\n}\nBEGIN {print systime (3)}";
  for (const [body, closing] of [
    ['"broken', '"'],
    ['"\\123', '"'],
    ["/broken", "/"],
    ["/a[bc", "]/"],
    ["/a{1", "}/"],
    ["/(abc", ")/"],
    ["/[[:alpha", ":]]/"],
    ["/a\\x2b", "/"],
  ]) {
    const initial = prefix + body + suffix;
    const result = parse(initial);
    assert.equal(result.status, 1, initial);
    assert.equal(result.tree, parse(initial).tree);
    edited(initial, prefix + body + closing + suffix, [
      { byte: prefix.length + body.length, deleteBytes: 0, insert: closing },
    ]);
  }
  const initial = '@include "missing\nBEGIN {x /= 2}';
  const result = parse(initial);
  assert.equal(result.status, 1);
  assert.equal(result.tree, parse(initial).tree);
  edited(initial, '@include "missing"\nBEGIN {x /= 2}', [
    { byte: initial.indexOf("\n"), deleteBytes: 0, insert: '"' },
  ]);
});

test("awk: escaping bracket slashes repairs ordinary and typed regexps", () => {
  for (const pattern of [
    "/[/]/",
    "/[]a/]/",
    "/[[:alpha:]/]/",
    "/[[.a.]/]/",
    "/[[=a=]/]/",
    "/]x[:[a/]/",
  ]) {
    for (const marker of ["", "@"]) {
      const prefix = `BEGIN {x = ${marker}`;
      const suffix = "; y /= 2}";
      const byte = prefix.length + pattern.indexOf("/", 1);
      const initial = prefix + pattern + suffix;
      const final = `${initial.slice(0, byte)}\\${initial.slice(byte)}`;
      assert.equal(parse(initial).status, 1, initial);
      edited(initial, final, [{ byte, deleteBytes: 0, insert: "\\" }]);
      edited(final, final, [
        { byte, deleteBytes: 1, insert: "" },
        { byte, deleteBytes: 0, insert: "\\" },
      ]);
    }
  }
});

test("awk: regexp repairs restore byte range order and single-byte collating payloads", () => {
  for (const { initial, final, byte, deleteBytes, insert } of [
    {
      initial: String.raw`/[\x81-\x80]/`,
      final: String.raw`/[\x80-\x80]/`,
      byte: 5,
      deleteBytes: 1,
      insert: "0",
    },
    {
      initial: String.raw`/[a-\u0100]/`,
      final: String.raw`/[a-\u00ff]/`,
      byte: 7,
      deleteBytes: 3,
      insert: "0ff",
    },
    {
      initial: String.raw`/[[=\xc3\xa9=]]/`,
      final: String.raw`/[[=\xc3=]]/`,
      byte: 8,
      deleteBytes: 4,
      insert: "",
    },
    {
      initial: String.raw`/[[.\u0100.]]/`,
      final: String.raw`/[[.\u00ff.]]/`,
      byte: 7,
      deleteBytes: 3,
      insert: "0ff",
    },
  ]) {
    assert.equal(parse(initial).status, 1, initial);
    edited(initial, final, [{ byte, deleteBytes, insert }]);
    const undo = {
      byte,
      deleteBytes: insert.length,
      insert: initial.slice(byte, byte + deleteBytes),
    };
    const broken = parse(final, [undo]);
    assert.equal(broken.status, 1, initial);
    assert.equal(broken.tree, parse(initial).tree);
    edited(final, final, [undo, { byte, deleteBytes, insert }]);
  }
});

test("awk: rejected regexp units repair across literal boundaries and preserve name context", () => {
  const prefix = '@namespace "lib"\nfunction f(systime) {if (x ~ /';
  const suffix =
    '/) print y; z = "s"; print systime (3)}\nBEGIN {print systime (3)}';
  for (const { before, after, byte, deleteBytes, insert } of [
    { before: "a{2,1}", after: "a{2,3}", byte: 4, deleteBytes: 1, insert: "3" },
    {
      before: String.raw`a{2,1}\/b`,
      after: String.raw`a{2,3}\/b`,
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: String.raw`a{2,1}[\/]b`,
      after: String.raw`a{2,3}[\/]b`,
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: String.raw`a{2,1}[[:alpha:]\/]b`,
      after: String.raw`a{2,3}[[:alpha:]\/]b`,
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: "a{2,1}[\\\n\\/]b",
      after: "a{2,3}[\\\n\\/]b",
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: String.raw`a{2,1}\\`,
      after: String.raw`a{2,3}\\`,
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: String.raw`a{2,[\/]}b`,
      after: String.raw`a[\/]}b`,
      byte: 1,
      deleteBytes: 3,
      insert: "",
    },
    {
      before: String.raw`a[[:bogus:]\/]b`,
      after: String.raw`a[[:alpha:]\/]b`,
      byte: 4,
      deleteBytes: 5,
      insert: "alpha",
    },
  ]) {
    const initial = prefix + before + suffix;
    const final = prefix + after + suffix;
    const edit = {
      byte: Buffer.byteLength(prefix) + byte,
      deleteBytes,
      insert,
    };
    const broken = parse(initial);
    assert.equal(broken.status, 1, initial);
    assert.equal(broken.tree, parse(initial).tree);
    edited(initial, final, [edit]);
    edited(final, final, [
      {
        byte: edit.byte,
        deleteBytes: Buffer.byteLength(insert),
        insert: before.slice(byte, byte + deleteBytes),
      },
      edit,
    ]);
  }
});

test("awk: repairs before literals opened during recovery restore fresh CSTs", () => {
  const prefix = '@namespace "lib"\nfunction f(systime) {';
  const suffix = "; print systime (3)}\nBEGIN {print systime (3)}";
  for (const [rejected, insert, literal] of [
    [") ", "", '"}" "a # b"'],
    [") ", "", "x = @/} # b/"],
    [") ", "", "x = 1 \\\n+ 2"],
    ["print ", "x = ", "@/} # b/"],
    ["y ", "x = ", "@/} # b/"],
  ]) {
    const initial = prefix + rejected + literal + suffix;
    const final = prefix + insert + literal + suffix;
    const byte = Buffer.byteLength(prefix);
    const edit = { byte, deleteBytes: rejected.length, insert };
    const broken = parse(initial);
    assert.equal(broken.status, 1, initial);
    assert.equal(broken.tree, parse(initial).tree);
    edited(initial, final, [edit]);
    edited(final, final, [
      { byte, deleteBytes: insert.length, insert: rejected },
      edit,
    ]);
  }
});
