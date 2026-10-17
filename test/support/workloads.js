import assert from "node:assert/strict";
import { applyEdits } from "./parser.js";

const normalFileBytes = 256 * 1024;
const normalNestingDepths = [16, 32, 64];
const scalingItemCounts = [512, 2048, 8192];
const scalingLiteralBytes = [16 * 1024, 64 * 1024, normalFileBytes];

function replacement(source, target, insert, start = 0) {
  const offset = source.indexOf(target, start);
  assert.ok(offset >= 0, `missing edit target: ${target}`);
  return {
    byte: Buffer.byteLength(source.slice(0, offset)),
    deleteBytes: Buffer.byteLength(target),
    insert,
  };
}

const representativeProgram = `@namespace "bench"
function fold(value) {
  if (value ~ /[a-z]+/) return length(value)
  return 0
}
BEGIN {
  total = 0
  values[1][2] = @/a{1,2}/
  name = "fold"
  result = @name("x")
  switch (result) {case 1: print result; default: break;}
  while ((getline record < file) > 0) total += 1
  while (("cat" | getline record) > 0) print record
  while (("cat" |& getline record) > 0) print record
}
/[a-z]+/ {total += 1; print $1}
END {print total}
`;

export const nestedCases = [
  {
    name: "blocks",
    source: (n) => `BEGIN ${"{".repeat(n)}print x;${"}".repeat(n)}\n`,
  },
  {
    name: "parentheses",
    source: (n) => `BEGIN {print ${"(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "calls",
    source: (n) => `BEGIN {print ${"f(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "subscripts",
    source: (n) => `BEGIN {print ${"a[".repeat(n)}x${"]".repeat(n)}}\n`,
  },
  {
    name: "fields",
    source: (n) => `BEGIN {print ${"$(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "regexp groups",
    source: (n) => `/${"(".repeat(n)}x${")".repeat(n)}/\n`,
  },
  {
    name: "getline targets",
    source: (n) => `{${"getline $(".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "getline sources",
    source: (n) => `{${"getline x < (".repeat(n)}x${")".repeat(n)}}\n`,
  },
  {
    name: "multidimensional arrays",
    source: (n) => `BEGIN {print a${"[1]".repeat(n)}[x]}\n`,
  },
];

export const scalingCases = [
  { name: "rules", source: (n) => '{print "x"}\n'.repeat(n) },
  {
    name: "functions",
    source: (n) =>
      Array.from({ length: n }, (_, i) => `function f${i}() {return x}\n`).join(
        "",
      ),
  },
  {
    name: "namespace directives",
    source: (n) =>
      '@namespace "lib"\nBEGIN {print systime (x)}\n@namespace "awk"\nBEGIN {print systime(x)}\n'.repeat(
        n,
      ),
  },
  { name: "include directives", source: (n) => '@include "x.awk"\n'.repeat(n) },
  {
    name: "strings",
    sizes: scalingLiteralBytes,
    source: (n) => `BEGIN {print "x${"a".repeat(n)}"}\n`,
  },
  { name: "regular expressions", source: (n) => `/x${"a".repeat(n)}/\n` },
  { name: "addition", source: (n) => `{x${"+1".repeat(n)}}\n` },
  { name: "assignments", source: (n) => `{${"a=".repeat(n)}x}\n` },
  { name: "conditionals", source: (n) => `{${"a?b:".repeat(n)}x}\n` },
  { name: "arguments", source: (n) => `{f(x${",a".repeat(n)})}\n` },
  {
    name: "getline sources",
    source: (n) => `{getline a < x${"+1".repeat(n)}}\n`,
  },
  {
    name: "unterminated strings",
    sizes: scalingLiteralBytes,
    successful: false,
    source: (n) => `BEGIN {print "x${"a".repeat(n)}`,
  },
];

export function* normalWorkloads() {
  for (const { name, copies } of [
    { name: "small", copies: 1 },
    {
      name: "256 KiB",
      copies: Math.ceil(
        normalFileBytes / Buffer.byteLength(representativeProgram),
      ),
    },
  ]) {
    yield {
      name: `${name} GNU programs`,
      run: (check) => {
        const source = representativeProgram.repeat(copies);
        check(
          name,
          source,
          replacement(source, "total = 0", "total = 1"),
          true,
        );
      },
    };
  }

  yield {
    name: "beginning middle and end edits and repairs",
    run: (check) => {
      const line = '{ name = 1; print "value\\n", /a\\x2bb/; }\n';
      const rows = Math.ceil(normalFileBytes / Buffer.byteLength(line));
      const source = line.repeat(rows);
      for (const row of [0, Math.floor(rows / 2), rows - 1]) {
        const start = row * line.length;
        for (const [target, insert] of [
          ["name", "item"],
          ["1", "2"],
          ["value", "other"],
          ["\\x2b", "\\x2a"],
        ]) {
          check(
            `row ${row}, ${target}`,
            source,
            replacement(source, target, insert, start),
            true,
          );
        }
        const remove = replacement(source, "}", "", start);
        check(`row ${row}, deletion`, source, remove, false);
        const broken = applyEdits(source, [remove]);
        check(
          `row ${row}, repair`,
          broken,
          { byte: remove.byte, deleteBytes: 0, insert: "}" },
          true,
        );
      }
    },
  };

  yield {
    name: "namespace and parameter edits",
    run: (check) => {
      const body = "BEGIN {print systime (3)}\n";
      const copies = Math.ceil(normalFileBytes / Buffer.byteLength(body));
      const namespaced = `@namespace "awk"\n${body.repeat(copies)}`;
      check(
        "namespace",
        namespaced,
        replacement(namespaced, '"awk"', '"lib"'),
        true,
      );
      const functionBody = "print systime (3);\n";
      const parameter = `function f(systime) {\n${functionBody.repeat(Math.ceil(normalFileBytes / functionBody.length))}}\n${body}`;
      check(
        "parameter",
        parameter,
        replacement(parameter, "systime", "local"),
        true,
      );
    },
  };

  for (const { name, source: createSource } of nestedCases) {
    yield {
      name: `${name} at 16 32 and 64 levels`,
      run: (check) => {
        for (const depth of normalNestingDepths) {
          const source = createSource(depth);
          check(
            `${name}/${depth}`,
            source,
            replacement(source, "x", "y"),
            true,
          );
        }
      },
    };
  }
}

export { replacement, scalingItemCounts };
