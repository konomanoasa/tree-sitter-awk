import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";
import { parseCst, sourceEndPoint } from "./cst.js";

const commandTimeoutMs = 60_000;
const cstOutputLimitBytes = 16 * 1024 * 1024;
const summaryTimeoutMicros = 10_000_000;
let runtime;
let nativeLibrary;
let sequence = 0;

before(() => {
  runtime = createTreeSitter();
  nativeLibrary = join(
    runtime.directory,
    process.platform === "win32" ? "parser.dll" : "parser",
  );
  const result = runtime.run(["build", root, "--output", nativeLibrary], {
    timeout: commandTimeoutMs,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
after(() => runtime?.close());

export function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const { byte, deleteBytes, insert } of edits) {
    assert.ok(Number.isSafeInteger(byte) && byte >= 0);
    assert.ok(Number.isSafeInteger(deleteBytes) && deleteBytes >= 0);
    assert.equal(typeof insert, "string");
    assert.ok(byte <= bytes.length && deleteBytes <= bytes.length - byte);
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes;
}

export function parse(source, edits = []) {
  const path = join(runtime.directory, `${sequence++}.awk`);
  writeFileSync(path, source);
  const arguments_ = [
    "parse",
    "--lib-path",
    nativeLibrary,
    "--lang-name",
    "gawk",
    "--cst",
  ];
  if (edits.length)
    arguments_.push(
      "--edits",
      ...edits.map(
        ({ byte, deleteBytes, insert }) => `${byte} ${deleteBytes} ${insert}`,
      ),
      "--",
    );
  arguments_.push(path);
  const result = runtime.run(arguments_, {
    timeout: commandTimeoutMs,
    maxBuffer: cstOutputLimitBytes,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const tree = parseCst(
    result.stdout,
    applyEdits(source, edits),
    result.status,
  );
  return { status: result.status, tree, output: result.stdout + result.stderr };
}

export function clean(source) {
  const result = parse(source);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.tree, /•ERROR|MISSING/);
  return result.tree;
}

export function edited(initial, final, edits) {
  assert.deepEqual(applyEdits(initial, edits), Buffer.from(final));
  const result = parse(initial, edits);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.tree, clean(final));
}

export function parseSummary(
  source,
  edits = [],
  { timeoutMicros = summaryTimeoutMicros, completionOnly = false } = {},
) {
  const path = join(runtime.directory, `${sequence++}.awk`);
  writeFileSync(path, source);
  const arguments_ = [
    "parse",
    "--lib-path",
    nativeLibrary,
    "--lang-name",
    "gawk",
    "--quiet",
    "--time",
    "--json-summary",
    ...(completionOnly ? [] : ["--timeout", String(timeoutMicros)]),
  ];
  if (edits.length) {
    arguments_.push(
      "--edits",
      ...edits.map(
        ({ byte, deleteBytes, insert }) => `${byte} ${deleteBytes} ${insert}`,
      ),
      "--",
    );
  }
  arguments_.push(path);
  const result = runtime.run(arguments_, { timeout: commandTimeoutMs });
  assert.ifError(result.error);
  assert.ok(
    result.status === 0 || result.status === 1,
    result.stdout + result.stderr,
  );
  const start = result.stdout.indexOf("{\n");
  assert.notEqual(start, -1, result.stdout + result.stderr);
  const { parse_summaries: summaries } = JSON.parse(result.stdout.slice(start));
  assert.equal(summaries?.length, 1, "parser produced no complete root");
  const summary = summaries[0];
  const final = applyEdits(source, edits);
  assert.equal(
    `${summary.end.row}:${summary.end.column}`,
    sourceEndPoint(final),
    "root must reach the edited source end",
  );
  assert.equal(summary.bytes, final.length, "parser omitted source bytes");
  assert.equal(summary.successful, result.status === 0);
  const freshMs = summary.duration.secs * 1000 + summary.duration.nanos / 1e6;
  let incrementalMs;
  if (edits.length) {
    const match = /Edit: +([0-9.]+) ms/.exec(result.stdout);
    assert.ok(match, "parser produced no edit timing");
    incrementalMs = Number(match[1]);
  }
  assert.ok(Number.isFinite(freshMs) && freshMs >= 0);
  if (edits.length)
    assert.ok(Number.isFinite(incrementalMs) && incrementalMs >= 0);
  return { ...summary, freshMs, incrementalMs };
}

export function highlights(source) {
  const path = join(runtime.directory, `${sequence++}.awk`);
  writeFileSync(path, source);
  const result = runtime.run(
    [
      "query",
      "--captures",
      "--lib-path",
      nativeLibrary,
      "--lang-name",
      "gawk",
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
