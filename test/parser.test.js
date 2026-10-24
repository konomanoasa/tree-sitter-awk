import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, edited, parse, parseSummary } from "./support/parser.js";
import { nestedCases } from "./support/workloads.js";

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

test("awk: host bracket edits restore nested and formerly negative delimiter depths", () => {
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

test("awk: regexp repairs retain endpoint kinds through resumed byte and character edits", () => {
  for (const { initial, final, byte, deleteBytes, insert } of [
    {
      initial: String.raw`/[\x80-\x81]/`,
      final: String.raw`/[\x80-\x80]/`,
      byte: 10,
      deleteBytes: 1,
      insert: "0",
    },
    {
      initial: String.raw`/[\x80-\u0080]/`,
      final: String.raw`/[\u0080-\u0080]/`,
      byte: 3,
      deleteBytes: 3,
      insert: "u0080",
    },
    {
      initial: String.raw`/[\x5c\x80-\u0080]/`,
      final: String.raw`/[\x5c\x80-\x80]/`,
      byte: 12,
      deleteBytes: 5,
      insert: "x80",
    },
    {
      initial: String.raw`/[[=\xc3=]]/`,
      final: String.raw`/[[=\xc3\xa9=]]/`,
      byte: 8,
      deleteBytes: 0,
      insert: String.raw`\xa9`,
    },
    {
      initial: String.raw`/[[=\xed\xa0=]]/`,
      final: String.raw`/[[=\xed\xa0\x80=]]/`,
      byte: 12,
      deleteBytes: 0,
      insert: String.raw`\x80`,
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
      final: String.raw`/\]x[/]/`,
      byte: 1,
      deleteBytes: 0,
      insert: "\\",
    },
  ])
    edited(initial, final, [{ byte, deleteBytes, insert }]);
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
      before: "a{2,1}[/]b",
      after: "a{2,3}[/]b",
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: "a{2,1}[[:alpha:]/]b",
      after: "a{2,3}[[:alpha:]/]b",
      byte: 4,
      deleteBytes: 1,
      insert: "3",
    },
    {
      before: "a{2,1}[\\\n/]b",
      after: "a{2,3}[\\\n/]b",
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
      before: "a{2,[/]}b",
      after: "a[/]}b",
      byte: 1,
      deleteBytes: 3,
      insert: "",
    },
    {
      before: "a[[:bogus:]/]b",
      after: "a[[:alpha:]/]b",
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

test("awk: nested syntax long names parameter lists and continuations are not truncated", () => {
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

const stressNestingDepth = 2048;
const stressContinuationCount = 32_768;
const stressIncompleteCount = 1200;
const stressCases = [
  ...nestedCases.map(({ name, source }) => ({
    name,
    source: source(stressNestingDepth),
    successful: true,
  })),
  {
    name: "split regexp escape",
    source: `/a\\x2${"\\\n".repeat(stressContinuationCount)}b/\n`,
    successful: true,
  },
  {
    name: "incomplete directives",
    source: '@namespace "\n'.repeat(stressIncompleteCount),
    successful: false,
  },
  {
    name: "incomplete getline expressions",
    source: ") getline < \n".repeat(stressIncompleteCount),
    successful: false,
  },
  {
    name: "incomplete operators and delimiters",
    source: "$ ) , \n".repeat(stressIncompleteCount),
    successful: false,
  },
];

for (const { name, source, successful } of stressCases) {
  test(`awk: stress: ${name} finish through EOF`, () => {
    assert.equal(
      parseSummary(source, [], { completionOnly: true }).successful,
      successful,
      name,
    );
  });
}
