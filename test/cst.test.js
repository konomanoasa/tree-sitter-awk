import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, parse } from "./support/parser.js";

test("gawk: normal public nodes have source ranges and remain within their parents", () => {
  for (const source of [
    "",
    "BEGIN {print 1}",
    "function f(switch) {return switch (3)}",
    '@namespace "lib"\nBEGIN {print systime (3)}',
    String.raw`/a\x2bb/`,
    String.raw`/\x28a\x29/`,
    String.raw`/\x5cw/`,
    String.raw`/[a\x5d]/`,
    "/a\\x2\\\nb/",
    'BEGIN {print "日本語"}',
  ]) {
    const tree = clean(source);
    const lines = source.split("\n");
    const offset = (row, column) =>
      Buffer.byteLength(lines.slice(0, row).join("\n")) +
      (row ? 1 : 0) +
      column;
    const stack = [];
    for (const line of tree.split("\n")) {
      const match = /^([0-9]+):([0-9]+) +- +([0-9]+):([0-9]+) +(.*)$/.exec(
        line,
      );
      assert.ok(match, line);
      const [, row, column, endRow, endColumn, label] = match;
      const indent = line.length - label.length;
      const start = offset(Number(row), Number(column));
      const end = offset(Number(endRow), Number(endColumn));
      assert.ok(
        start >= 0 && end <= Buffer.byteLength(source) && start <= end,
        line,
      );
      if (label !== "program") assert.ok(start < end, line);
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      if (stack.length) {
        assert.ok(start >= stack.at(-1).start && end <= stack.at(-1).end, line);
      }
      stack.push({ start, end, indent: indent });
    }
  }
});

test("gawk: actual NUL is rejected in source, comments, and literals while escaped NUL remains valid", () => {
  for (const source of [
    "\0",
    "#a\0b\nBEGIN {}",
    'BEGIN {print "a\0b"}',
    "/a\0b/",
  ]) {
    const result = parse(source);
    assert.equal(result.status, 1, result.output);
  }
  clean(String.raw`BEGIN {print "a\0b"}`);
  const source =
    '@namespace "lib"\nBEGIN {x=0x1.2p3; print "x", /x/; f(a[1]); #note\n}\n';
  clean(source);
  for (let position = 0; position <= source.length; position++) {
    const result = parse(
      `${source.slice(0, position)}\0${source.slice(position)}`,
    );
    assert.equal(result.status, 1, `NUL at ${position}: ${result.output}`);
  }
});

test("gawk: only the source-leading BOM is removed by the input layer", () => {
  assert.match(clean("\uFEFFBEGIN {}"), /0:3/);
  assert.equal(parse(" \uFEFFBEGIN {}").status, 1);
  clean('BEGIN {print "\uFEFF"}');
});

test("gawk: CR is layout outside literals and remains string and comment content", () => {
  clean("BEGIN {\rprint 1}\r\n");
  assert.match(clean('BEGIN {print "a\rb"}'), /string_content/);
  clean("#a\rb\nBEGIN {}");
  for (const blank of ["\f", "\v"])
    assert.equal(parse(`BEGIN {${blank}print 1}`).status, 1);
});
