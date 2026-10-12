import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, edited, parse } from "./support/parser.js";

test("gawk: keyword parameter repairs preserve simple-name shadowing and qualified reservations", () => {
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

test("gawk: field-only ownership changes retain the fresh CST after edits", () => {
  edited("axc?d:e", "a?b:c?d:e", [{ byte: 1, deleteBytes: 1, insert: "?b:" }]);
  edited("getline x++ y", "getline;x++ y", [
    { byte: 7, deleteBytes: 1, insert: ";" },
  ]);
});

test("gawk: regex literal edits preserve text leaves through composite source changes", () => {
  const initial = String.raw`/\x5c\\./`;
  const final = "/\\x5c\\\\\\\n./";
  edited(initial, final, [{ byte: 7, deleteBytes: 0, insert: "\\\n" }]);
  edited(final, initial, [{ byte: 7, deleteBytes: 2, insert: "" }]);
});

test("gawk: repairing directive names restores ordinary and indirect qualified names", () => {
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

test("gawk: unterminated literals parse deterministically and repairs restore fresh CSTs", () => {
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

test("gawk: host bracket edits restore nested and formerly negative delimiter depths", () => {
  edited(String.raw`/[\x5c[:\x5c[:a]]/`, String.raw`/[\x5c[:\x5c[:a]]]/`, [
    { byte: 17, deleteBytes: 0, insert: "]" },
  ]);
  edited("/]x[ [a/]/", "/]x[:[a/]/", [
    { byte: 4, deleteBytes: 1, insert: ":" },
  ]);
  edited("/]x[:[a/]/", String.raw`/\]x[:[a/]/`, [
    { byte: 1, deleteBytes: 0, insert: "\\" },
  ]);
  edited(String.raw`/\]x[:[a/]/`, "/]x[:[a/]/", [
    { byte: 1, deleteBytes: 1, insert: "" },
  ]);
  edited("/]x[\\\n:[a/]/", "/]x[:[a/]/", [
    { byte: 4, deleteBytes: 2, insert: "" },
  ]);
  edited("/[[\\\n:alpha:]/]/", "/[[:alpha:]/]/", [
    { byte: 3, deleteBytes: 2, insert: "" },
  ]);
});

test("gawk: namespace edits reclassify later GNU builtins", () => {
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

test("gawk: parameter edits change body classification and keep following functions independent", () => {
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

test("gawk: top-level repairs retain adjacent definitions and directive namespace changes", () => {
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

test("gawk: repairing subscript adjacency restores nested owners after external extras", () => {
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

test("gawk: numeric escape edits change regex roles while retaining source ranges", () => {
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

test("gawk: inserting and removing continuation inside an escape preserves the decoded role", () => {
  edited(String.raw`/a\x2b/`, "/a\\x2\\\nb/", [
    { byte: 5, deleteBytes: 0, insert: "\\\n" },
  ]);
  edited("/a\\x2\\\nb/", String.raw`/a\x2b/`, [
    { byte: 5, deleteBytes: 2, insert: "" },
  ]);
});

test("gawk: edits after output parentheses reselect the owner of the parentheses", () => {
  for (const tail of ["+b", ",b", " in arr", " > file"]) {
    const initial = "BEGIN {print (a)}";
    const final = `BEGIN {print (a)${tail}}`;
    edited(initial, final, [{ byte: 16, deleteBytes: 0, insert: tail }]);
    edited(final, initial, [
      { byte: 16, deleteBytes: Buffer.byteLength(tail), insert: "" },
    ]);
  }
});

test("gawk: for-header edits switch between array iteration and a membership initializer", () => {
  edited("BEGIN {for(i in a) {}}", "BEGIN {for(i in a;0;) {}}", [
    { byte: 17, deleteBytes: 0, insert: ";0;" },
  ]);
});

test("gawk: newlines before else are reclassified when the following statement changes", () => {
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

test("gawk: do completion edits restore statement and else ownership", () => {
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

test("gawk: regexp repairs restore endpoint order and raw slash boundaries", () => {
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
      final: String.raw`/\]x[/]/`,
      byte: 1,
      deleteBytes: 0,
      insert: "\\",
    },
  ])
    edited(initial, final, [{ byte, deleteBytes, insert }]);
});

test("gawk: regexp edits reclassify intervals ranges raw slash boundaries and UTF-8 escapes", () => {
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
      final: "/[a/c]/",
      byte: 3,
      deleteBytes: 1,
      insert: "/",
    },
    {
      initial: "/[[:alpha:]/]/",
      final: "/[[:digit:]/]/",
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
      initial: String.raw`/a\u110000/`,
      final: String.raw`/a\u00003f/`,
      byte: 4,
      deleteBytes: 6,
      insert: "00003f",
    },
    {
      initial: "/[[:alpha:]/]/",
      final: String.raw`/[[:alpha\x3a]/]/`,
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

test("gawk: nested syntax long names parameter lists and continuations are not truncated", () => {
  const nestingDepth = 160;
  const nameSuffixBytes = 4096;
  const parameterCount = 1025;
  const continuationCount = 2048;
  const name = `n${"a".repeat(nameSuffixBytes)}`;
  const parameters = Array.from(
    { length: parameterCount },
    (_, i) => `p${i}`,
  ).join(",");
  const continuation = "\\\n".repeat(continuationCount);
  for (const source of [
    `BEGIN {print ${"(".repeat(nestingDepth)}1${")".repeat(nestingDepth)}}`,
    `/${"(".repeat(nestingDepth)}a${")".repeat(nestingDepth)}/`,
    `@namespace "${name}"\nfunction ${name}(${parameters},systime) {return systime}`,
    `/a\\x2${continuation}b/`,
  ]) {
    const tree = clean(source);
    assert.equal(tree, clean(source));
    edited(source, `${source}\n`, [
      { byte: Buffer.byteLength(source), deleteBytes: 0, insert: "\n" },
    ]);
  }
});
