const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  createEnvironment,
  grammar,
  repositoryDirectory,
  run,
} = require("../scripts/tree-sitter.js");

const fixture = path.join(repositoryDirectory, "test", "highlight", "awk.awk");
const query = path.join(repositoryDirectory, "queries", "highlights.scm");

function assertCommand(args, options = {}) {
  const result = run(args, options);
  if (result.error !== undefined) {
    throw result.error;
  }
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

test("highlight query", () => {
  assertCommand([
    "highlight",
    "--check",
    "--quiet",
    "--scope",
    grammar.scope,
    fixture,
  ]);
  assertCommand(["query", "--test", "--scope", grammar.scope, query, fixture]);
});

// `query --test` passes when any capture at a position matches, so it cannot
// see which of several overlapping captures a consumer renders. Resolve the
// final capture per character from the highlighter's own HTML output: the
// innermost span wins, exactly as in editors.
const finalCaptureCases = [
  { column: 9, expected: "function", label: "spaced definition name", row: 0 },
  {
    column: 16,
    expected: "string regexp",
    label: "ERE ordinary close parenthesis",
    row: 1,
  },
  {
    column: 18,
    expected: "string regexp",
    label: "ERE ordinary close brace",
    row: 1,
  },
  {
    column: 21,
    expected: "string escape",
    label: "ERE escaped delimiter slash",
    row: 1,
  },
  {
    column: 4,
    expected: "character special",
    label: "equivalence class delimiter",
    row: 2,
  },
  {
    column: 22,
    expected: "keyword conditional ternary",
    label: "conditional question mark",
    row: 3,
  },
];
const finalCaptureSource = [
  "function spaced (first) { return first }",
  String.raw`BEGIN { print /a)b}c\/d/ }`,
  "/[x[=a=]]/ { print }",
  "END { print first ? 1 : 2 }",
  "",
].join("\n");

function themedEnvironment() {
  const environment = createEnvironment("tree-sitter-awk-highlight.");
  const configPath = path.join(
    environment.directory,
    "config",
    "tree-sitter",
    "config.json",
  );
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.theme = {};
  const captureNames = new Set(
    fs.readFileSync(query, "utf8").match(/@[a-z.]+/g),
  );
  let color = 17;
  for (const captureName of captureNames) {
    config.theme[captureName.slice(1)] = color;
    color += 1;
  }
  fs.writeFileSync(configPath, JSON.stringify(config));
  return environment;
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function finalClassesPerLine(html) {
  const lines = [];
  for (const rowMatch of html.matchAll(/<td class=line>(.*?)<\/td>/gs)) {
    const classes = [];
    const stack = [];
    const row = rowMatch[1];
    const token = /<span class='([^']*)'>|<\/span>|([^<]+)/g;
    for (const part of row.matchAll(token)) {
      if (part[1] !== undefined) {
        stack.push(part[1]);
      } else if (part[0] === "</span>") {
        stack.pop();
      } else if (part[2] !== undefined) {
        const text = decodeEntities(part[2].replace(/\n/g, ""));
        const current = stack.length > 0 ? stack[stack.length - 1] : "";
        for (let i = 0; i < text.length; i++) {
          classes.push(current);
        }
      }
    }
    lines.push(classes);
  }
  return lines;
}

test("final capture resolution", () => {
  const environment = themedEnvironment();
  try {
    const probePath = path.join(environment.directory, "probe.awk");
    fs.writeFileSync(probePath, finalCaptureSource);
    const result = assertCommand(
      [
        "highlight",
        "--html",
        "--css-classes",
        "--scope",
        grammar.scope,
        probePath,
      ],
      { environment },
    );
    const lines = finalClassesPerLine(result.stdout);
    for (const { column, expected, label, row } of finalCaptureCases) {
      assert.equal(
        lines[row]?.[column],
        expected,
        `${label} at ${row}:${column}\n${result.stdout}`,
      );
    }
  } finally {
    environment.remove();
  }
});
