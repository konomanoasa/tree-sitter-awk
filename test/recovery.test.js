import assert from "node:assert/strict";
import { test } from "node:test";
import { edited, parse } from "./support/parser.js";

function topLevelNodes(tree) {
  const stack = [];
  const nodes = [];
  for (const line of tree.split("\n")) {
    const match = /^([0-9]+):[0-9]+ +- +[0-9]+:[0-9]+ +(.*)$/.exec(line);
    assert.ok(match, line);
    const text = match[2];
    const depth = line.length - text.length;
    while (stack.length && stack.at(-1).depth >= depth) stack.pop();
    if (stack.length === 1) {
      assert.equal(stack[0].text.replace(/^•/, ""), "program");
      nodes.push([Number(match[1]), text]);
    }
    stack.push({ depth, text });
  }
  return nodes;
}

const nestingDepths = [0, 1, 3, 6];

test("awk: incomplete for conditions preserve independent surrounding definitions and rules", () => {
  for (const depth of nestingDepths) {
    const prefix =
      "function before() { return 100 }\nBEGIN {\n" +
      "if (x) {\n".repeat(depth) +
      "for (i = 0; i <";
    const suffix =
      "\nx = 123\nprint x\n" +
      "}\n".repeat(depth + 1) +
      "END { print 456 }\nfunction later() { return 789 }\n";
    const source = prefix + suffix;
    const result = parse(source);
    assert.equal(result.status, 1, `nesting depth ${depth}`);
    const nodes = topLevelNodes(result.tree);
    for (const expected of [
      [0, "function_definition"],
      [6 + depth * 2, "rule"],
      [7 + depth * 2, "function_definition"],
    ]) {
      assert.ok(
        nodes.some(
          ([row, text]) => row === expected[0] && text === expected[1],
        ),
        `nesting depth ${depth}: missing ${expected}\n${result.tree}`,
      );
    }
    const completion = " 10; i++) print i";
    const complete = prefix + completion + suffix;
    edited(source, complete, [
      { byte: prefix.length, deleteBytes: 0, insert: completion },
    ]);
    edited(complete, complete, [
      { byte: prefix.length, deleteBytes: completion.length, insert: "" },
      { byte: prefix.length, deleteBytes: 0, insert: completion },
    ]);
  }
});
