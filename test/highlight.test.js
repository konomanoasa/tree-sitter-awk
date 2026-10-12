import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, highlights } from "./support/parser.js";

function check(segments) {
  const source = segments.map(([text]) => text).join("");
  clean(source);
  const expected = segments.flatMap(([text, capture = ""]) =>
    Array(Buffer.byteLength(text)).fill(capture),
  );
  assert.deepEqual(highlights(source), expected, source);
}

test("gawk: highlight uses lexical namespace and parameter classifications", () => {
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

test("gawk: continuations in split escapes and composite regexp literals keep their own capture", () => {
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

test("gawk: numeric regex symbols remain escapes and composite tails retain their roles", () => {
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

test("gawk: bracket forms counts and raw regex punctuation have specific captures", () => {
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

test("gawk: directive quotes translation marker and escapes keep their own captures", () => {
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
