const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const {
  grammar,
  repositoryDirectory,
  run,
} = require("../scripts/tree-sitter.js");

const fixture = path.join(repositoryDirectory, "test", "highlight", "awk.awk");
const query = path.join(repositoryDirectory, "queries", "highlights.scm");

function assertCommand(args) {
  const result = run(args);
  if (result.error !== undefined) {
    throw result.error;
  }
  assert.equal(result.status, 0, result.stdout + result.stderr);
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
