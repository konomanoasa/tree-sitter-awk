import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { grammars, root } from "../scripts/tree-sitter.js";
import {
  clean,
  nativeLibrary,
  runtime,
  writeSource,
} from "./support/parser.js";

const commandTimeoutMs = 60_000;
const grammar = grammars[0];

function highlights(source) {
  const path = writeSource(source);
  const result = runtime.run(
    [
      "query",
      "--captures",
      "--lib-path",
      nativeLibrary,
      "--lang-name",
      grammar.name,
      join(root, "queries/highlights.scm"),
      path,
    ],
    {
      timeout: commandTimeoutMs,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const lines = source.split("\n");
  const offset = (row, column) =>
    Buffer.byteLength(lines.slice(0, Number(row)).join("\n")) +
    (Number(row) ? 1 : 0) +
    Number(column);
  const captures = [];
  for (const match of result.stdout.matchAll(
    /pattern: +([0-9]+), capture: +[0-9]+ - ([a-z_.]+), start: \(([0-9]+), ([0-9]+)\), end: \(([0-9]+), ([0-9]+)\)/g,
  )) {
    captures.push({
      pattern: Number(match[1]),
      name: match[2],
      start: offset(match[3], match[4]),
      end: offset(match[5], match[6]),
    });
  }
  const final = Array(Buffer.byteLength(source)).fill("");
  for (const capture of captures.sort((a, b) => a.pattern - b.pattern))
    final.fill(capture.name, capture.start, capture.end);
  return final;
}

function check(segments) {
  const source = segments.map(([text]) => text).join("");
  clean(source);
  const expected = segments.flatMap(([text, capture = ""]) =>
    Array(Buffer.byteLength(text)).fill(capture),
  );
  assert.deepEqual(highlights(source), expected, source);
}

test("awk: highlight uses lexical namespace and parameter classifications", () => {
  check([
    ["@namespace", "keyword.directive"],
    [" "],
    ['"lib"', "string"],
    ["\n"],
    ["function", "keyword"],
    [" "],
    ["lib", "module"],
    ["::", "punctuation.delimiter"],
    ["f", "function"],
    ["(", "punctuation.bracket"],
    ["systime", "variable.parameter"],
    [")", "punctuation.bracket"],
    [" "],
    ["{", "punctuation.bracket"],
    ["return", "keyword"],
    [" "],
    ["systime", "variable"],
    [" "],
    ["(", "punctuation.bracket"],
    ["3", "number"],
    [")}", "punctuation.bracket"],
    ["\n"],
    ["BEGIN", "keyword"],
    [" "],
    ["{", "punctuation.bracket"],
    ["lib", "module"],
    ["::", "punctuation.delimiter"],
    ["f", "function.call"],
    ["(", "punctuation.bracket"],
    ["awk", "module"],
    ["::", "punctuation.delimiter"],
    ["systime", "function.builtin"],
    ["())}", "punctuation.bracket"],
  ]);
});

test("awk: continuations in split escapes and composite regexp literals keep their own capture", () => {
  check([
    ["/", "punctuation.delimiter"],
    ["a", "string.regexp"],
    ["\\x2", "string.escape"],
    ["\\\n", "punctuation.special"],
    ["b", "string.escape"],
    ["?", "operator"],
    ["/", "punctuation.delimiter"],
  ]);
  check([
    ["/", "punctuation.delimiter"],
    ["\\x5c", "string.escape"],
    ["\\\\", "string.regexp"],
    ["\\\n", "punctuation.special"],
    [".", "string.regexp"],
    ["/", "punctuation.delimiter"],
  ]);
});

test("awk: numeric regex symbols remain escapes and composite tails retain their roles", () => {
  check([
    ["/", "punctuation.delimiter"],
    ["\\x28", "string.escape"],
    ["é", "string.regexp"],
    ["\\x29", "string.escape"],
    ["+?", "operator"],
    ["\\x5c", "string.escape"],
    ["w", "character.special"],
    ["\\xc3\\xa9", "string.escape"],
    ["/", "punctuation.delimiter"],
  ]);
});

test("awk: bracket forms counts and raw regex punctuation have specific captures", () => {
  check([
    ["/", "punctuation.delimiter"],
    ["^", "operator"],
    ["[[", "punctuation.bracket"],
    [":", "punctuation.delimiter"],
    ["alpha", "character.special"],
    [":", "punctuation.delimiter"],
    ["]", "punctuation.bracket"],
    ["a", "string.regexp"],
    ["-", "operator"],
    ["c", "string.regexp"],
    ["]{", "punctuation.bracket"],
    ["1", "number"],
    [",", "punctuation.delimiter"],
    ["2", "number"],
    ["}", "punctuation.bracket"],
    ["$", "operator"],
    ["/", "punctuation.delimiter"],
  ]);
});

test("awk: directive quotes translation marker and escapes keep their own captures", () => {
  check([
    ["@include", "keyword.directive"],
    [" "],
    ["_", "keyword.directive"],
    ['"a', "string"],
    ['\\"', "string.escape"],
    ['b"', "string"],
    [";", "punctuation.delimiter"],
    [" "],
    ["# comment", "comment"],
  ]);
});
