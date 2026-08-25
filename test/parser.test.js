"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { Language, Parser } = require("web-tree-sitter");

const {
  createEnvironment,
  grammar,
  repositoryDirectory,
  run,
  runChecked,
} = require("../scripts/tree-sitter.js");

const runtime = createEnvironment("tree-sitter-posix-awk-runtime.");
const nativeLibrary = path.join(runtime.directory, "parser");
const wasmLibrary = path.join(runtime.libraryDirectory, `${grammar.name}.wasm`);
let includedRangeLanguage;
let sourceSequence = 0;

before(async () => {
  runChecked(["build", "--output", nativeLibrary, repositoryDirectory], {
    environment: runtime,
    stdio: "inherit",
  });
  runChecked(
    ["build", "--wasm", "--output", wasmLibrary, repositoryDirectory],
    { environment: runtime, stdio: "inherit" },
  );
  await Parser.init();
  includedRangeLanguage = await Language.load(wasmLibrary);
});

after(() => {
  runtime.remove();
});

function lines(...sourceLines) {
  return `${sourceLines.join("\n")}\n`;
}

function writeSource(testName, label, source) {
  sourceSequence += 1;
  const filename = `${String(sourceSequence).padStart(3, "0")}-${testName}-${label}.awk`;
  const sourcePath = path.join(runtime.directory, filename);
  fs.writeFileSync(sourcePath, source);
  return sourcePath;
}

function normalizeParseTree(stdout, sourcePath) {
  return stdout
    .split("\n")
    .filter((line) => {
      if (line.startsWith(sourcePath)) {
        const suffix = line.slice(sourcePath.length);
        if (/^[ \t]+Parse:[ \t]/.test(suffix)) {
          return false;
        }
      }
      return !/^[ \t]*Edit:[ \t]/.test(line);
    })
    .join("\n");
}

function captureParse(runtimeName, sourcePath, edits = []) {
  const args = ["parse"];
  if (runtimeName === "native") {
    args.push(
      "--lib-path",
      nativeLibrary,
      "--lang-name",
      grammar.name,
      "--cst",
    );
  } else if (runtimeName === "wasm") {
    args.push("--wasm", "--scope", grammar.scope, "--cst");
  } else {
    throw new Error(`Unknown parser runtime: ${runtimeName}`);
  }
  if (edits.length > 0) {
    args.push("--edits", ...edits, "--", sourcePath);
  } else {
    args.push(sourcePath);
  }

  const result = run(args, { environment: runtime });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    tree: normalizeParseTree(result.stdout, sourcePath),
  };
}

function parseDescription(label, result) {
  return `${label}\nExit status: ${result.status}\n${result.stdout}${result.stderr}`;
}

function assertStatus(label, result, expectedStatus) {
  assert.equal(result.status, expectedStatus, parseDescription(label, result));
}

function assertFresh(testName, source, expectedStatus = 0) {
  const sourcePath = writeSource(testName, "fresh", source);
  const native = captureParse("native", sourcePath);
  const wasm = captureParse("wasm", sourcePath);
  assertStatus(`${testName} native fresh parse`, native, expectedStatus);
  assertStatus(`${testName} Wasm fresh parse`, wasm, expectedStatus);
  assert.equal(
    native.tree,
    wasm.tree,
    `${testName}: native fresh and Wasm fresh CSTs differ`,
  );
  return native.tree;
}

function applyEdits(testName, initial, edits) {
  let actual = Buffer.from(initial);
  for (const edit of edits) {
    const firstSpace = edit.indexOf(" ");
    const secondSpace = edit.indexOf(" ", firstSpace + 1);
    assert.ok(
      firstSpace >= 1 && secondSpace >= firstSpace + 2,
      `${testName}: invalid edit ${JSON.stringify(edit)}`,
    );

    const positionText = edit.slice(0, firstSpace);
    const deleteCountText = edit.slice(firstSpace + 1, secondSpace);
    assert.match(
      positionText,
      /^[0-9]+$/,
      `${testName}: invalid edit ${JSON.stringify(edit)}`,
    );
    assert.match(
      deleteCountText,
      /^[0-9]+$/,
      `${testName}: invalid edit ${JSON.stringify(edit)}`,
    );

    const position = Number(positionText);
    const deleteCount = Number(deleteCountText);
    assert.ok(
      Number.isSafeInteger(position) &&
        Number.isSafeInteger(deleteCount) &&
        position <= actual.length &&
        deleteCount <= actual.length - position,
      `${testName}: out-of-bounds edit ${JSON.stringify(edit)} for ${actual.length} bytes`,
    );
    actual = Buffer.concat([
      actual.subarray(0, position),
      Buffer.from(edit.slice(secondSpace + 1)),
      actual.subarray(position + deleteCount),
    ]);
  }
  return actual;
}

function captureEditParses(testName, initialSource, finalSource, edits) {
  const initialPath = writeSource(testName, "initial", initialSource);
  const finalPath = writeSource(testName, "final", finalSource);
  assert.deepEqual(
    applyEdits(testName, initialSource, edits),
    Buffer.from(finalSource),
    `${testName}: edits do not produce the final source`,
  );

  const nativeIncremental = captureParse("native", initialPath, edits);
  const nativeFresh = captureParse("native", finalPath);
  const wasmIncremental = captureParse("wasm", initialPath, edits);
  const wasmFresh = captureParse("wasm", finalPath);

  return { nativeFresh, nativeIncremental, wasmFresh, wasmIncremental };
}

function assertDeterministicEdit(testName, initialSource, finalSource, edits) {
  const parses = captureEditParses(testName, initialSource, finalSource, edits);
  for (const [label, result] of [
    ["native incremental parse", parses.nativeIncremental],
    ["native fresh parse", parses.nativeFresh],
    ["Wasm incremental parse", parses.wasmIncremental],
    ["Wasm fresh parse", parses.wasmFresh],
  ]) {
    assertStatus(`${testName} ${label}`, result, 0);
    clean(result.tree);
  }
  assert.equal(
    parses.nativeIncremental.tree,
    parses.nativeFresh.tree,
    `${testName}: native incremental and fresh CSTs differ`,
  );
  assert.equal(
    parses.wasmIncremental.tree,
    parses.wasmFresh.tree,
    `${testName}: Wasm incremental and fresh CSTs differ`,
  );
  assert.equal(
    parses.nativeFresh.tree,
    parses.wasmFresh.tree,
    `${testName}: native fresh and Wasm fresh CSTs differ`,
  );
  return parses.nativeFresh.tree;
}

function contains(tree, expected) {
  assert.ok(
    tree.includes(expected),
    `Expected CST to contain: ${expected}\n${tree}`,
  );
}

function excludes(tree, unexpected) {
  assert.ok(
    !tree.includes(unexpected),
    `Expected CST not to contain: ${unexpected}\n${tree}`,
  );
}

function clean(tree) {
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
  excludes(tree, "_recovery");
}

function cleanContinuation(tree) {
  contains(tree, "line_continuation");
  clean(tree);
}

function matchingLineCount(tree, pattern) {
  return tree.split("\n").filter((line) => pattern.test(line)).length;
}

function singleActionCloserRecovery(tree) {
  contains(tree, "closing: closer_recovery");
  assert.equal(
    matchingLineCount(tree, /^[ \t0-9:-]+closing:[ \t]+closer_recovery$/),
    1,
    "Expected one action closer-recovery node at physical EOF",
  );
}

function freshTest(name, source, assertions) {
  test(name, () => assertions(assertFresh(name, source)));
}

function determinismTest(name, initial, final, edits, assertions = () => {}) {
  test(name, () =>
    assertions(assertDeterministicEdit(name, initial, final, edits)),
  );
}

function assertIncludedRanges(source, includedRanges, assertions) {
  const parser = new Parser();
  parser.setLanguage(includedRangeLanguage);
  const tree = parser.parse(source, null, { includedRanges });
  assert.notEqual(
    tree,
    null,
    "Expected included-range parse to produce a tree",
  );
  try {
    assertions(tree.rootNode);
  } finally {
    tree.delete();
    parser.delete();
  }
}

function assertSingleNode(root, type, expected) {
  assert.equal(root.hasError, false, root.toString());
  const nodes = root.descendantsOfType(type);
  assert.equal(nodes.length, 1, root.toString());
  assert.equal(nodes[0].startIndex, expected.startIndex);
  assert.equal(nodes[0].endIndex, expected.endIndex);
  assert.deepEqual(nodes[0].startPosition, expected.startPosition);
  assert.deepEqual(nodes[0].endPosition, expected.endPosition);
  assert.equal(nodes[0].text, expected.text);
}

test("included range starts a keyword after skipped layout", () => {
  const source = "BEGIN {}\n HOSTEND {}\n";
  assertIncludedRanges(
    source,
    [
      {
        startIndex: 0,
        endIndex: 10,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 1 },
      },
      {
        startIndex: 14,
        endIndex: 21,
        startPosition: { row: 1, column: 5 },
        endPosition: { row: 2, column: 0 },
      },
    ],
    (root) =>
      assertSingleNode(root, "end_keyword", {
        startIndex: 14,
        endIndex: 17,
        startPosition: { row: 1, column: 5 },
        endPosition: { row: 1, column: 8 },
        text: "END",
      }),
  );
});

test("included range starts a number at the current range boundary", () => {
  const source = "BEGIN {}\nHOST123 {}\n";
  assertIncludedRanges(
    source,
    [
      {
        startIndex: 0,
        endIndex: 9,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 0 },
      },
      {
        startIndex: 13,
        endIndex: 20,
        startPosition: { row: 1, column: 4 },
        endPosition: { row: 2, column: 0 },
      },
    ],
    (root) =>
      assertSingleNode(root, "number", {
        startIndex: 13,
        endIndex: 16,
        startPosition: { row: 1, column: 4 },
        endPosition: { row: 1, column: 7 },
        text: "123",
      }),
  );
});

const fieldContractSource = `/(a|b)/, /c/ {
  $1 = "value";
  value = -other;
  print -value + other;
  print value + other;
}
`;
const fieldContractQuery = String.raw`(action
  opening: "{" @action.opening
  closing: "}" @action.closing)

(normal_pattern
  separator: "," @normal-pattern.separator)

(ere
  opening: "/" @ere.opening
  closing: "/" @ere.closing)

(ere_expression
  opening: "(" @ere-expression.opening
  closing: ")" @ere-expression.closing)

(extended_reg_exp
  operator: "|" @extended-reg-exp.operator)

(lvalue
  operator: "$" @lvalue.operator)

(non_unary_expr
  operator: "=" @non-unary-expr.operator)

(unary_expr
  operator: "-" @unary-expr.operator)

(non_unary_print_expr
  operator: "+" @non-unary-print-expr.operator)

(unary_print_expr
  operator: "-" @unary-print-expr.operator)

(string
  opening: "\"" @string.opening
  closing: "\"" @string.closing)

(terminated_statement
  terminator: ";" @terminated-statement.terminator)
`;

test("anonymous-token field contract", () => {
  const queryPath = path.join(runtime.directory, "fields.scm");
  const sourcePath = writeSource(
    "anonymous-token-field-contract",
    "source",
    fieldContractSource,
  );
  fs.writeFileSync(queryPath, fieldContractQuery);
  const result = run(
    [
      "query",
      "--lib-path",
      nativeLibrary,
      "--lang-name",
      grammar.name,
      "--captures",
      queryPath,
      sourcePath,
    ],
    { environment: runtime },
  );
  assertStatus("anonymous-token field query", result, 0);
  const captures = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/ - ([^,]+), start:/);
    if (match !== null) {
      captures.push(match[1]);
    }
  }
  captures.sort();
  assert.deepEqual(captures, [
    "action.closing",
    "action.opening",
    "ere-expression.closing",
    "ere-expression.opening",
    "ere.closing",
    "ere.closing",
    "ere.opening",
    "ere.opening",
    "extended-reg-exp.operator",
    "lvalue.operator",
    "non-unary-expr.operator",
    "non-unary-expr.operator",
    "non-unary-print-expr.operator",
    "normal-pattern.separator",
    "string.closing",
    "string.opening",
    "terminated-statement.terminator",
    "terminated-statement.terminator",
    "terminated-statement.terminator",
    "terminated-statement.terminator",
    "unary-expr.operator",
    "unary-print-expr.operator",
  ]);
});

const namedFieldSource = lines(
  "",
  "BEGIN {",
  "  if (cond) left = right; else i++",
  "  do delete arr[i, j]; while (top)",
  '  print a, b > "out"',
  '  "cmd" | getline target',
  "  for (k in rows) break",
  "}",
  "function plus(first) { return first }",
);

freshTest("named-node-field-contract", namedFieldSource, (tree) => {
  for (const memberField of [
    "leading: newline_opt",
    "item: item",
    "terminator: terminator",
    "pattern: pattern",
    "action: action",
    "body: terminated_statement_list",
    "statement: terminatable_statement",
    "condition: expr",
    "consequence: terminated_statement",
    "alternative: terminated_statement",
    "left: lvalue",
    "right: expr",
    "operand: lvalue",
    "operator: incr",
    "body: terminated_statement",
    "array: name",
    "subscripts: expr_list",
    "statement: simple_print_statement",
    "arguments: print_expr_list",
    "redirection: output_redirection",
    "source: non_unary_expr",
    "get: simple_get",
    "target: lvalue",
    "variable: name",
    "name: func_name",
    "parameters: param_list",
    "body: action",
    "body: unterminated_statement_list",
  ]) {
    contains(tree, memberField);
  }
  clean(tree);
});

const division = lines("BEGIN { print x / a }");
const matchEre = lines("BEGIN { print x ~ /a/ }");
const divisionAssignment = lines("BEGIN { x /= 2 }");
const divisionExpression = lines("BEGIN { x / 2 }");
const matchOperand = lines("BEGIN { print x ~ a }");

freshTest(
  "tracer",
  lines("# tracer", "BEGIN {", "  x /= 2", "  print x ~ /a/", "}"),
  (tree) => {
    contains(tree, "div_assign");
    contains(tree, "ere");
    contains(tree, "ordinary_character");
    clean(tree);
    assert.equal(
      matchingLineCount(tree, /^[ \t0-9:-]*"\/"$/),
      2,
      "Expected one opening and one closing ERE slash",
    );
  },
);

freshTest("slash-priority", lines("BEGIN { print x /a/ }"), (tree) => {
  contains(tree, "expression_recovery");
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
  assert.equal(
    matchingLineCount(tree, /^[ \t0-9:-]*ere([ \t]|$)/),
    0,
    "Expected division priority to prevent an ERE node",
  );
  assert.equal(
    matchingLineCount(tree, /^[ \t0-9:-]*"\/"$/),
    2,
    "Expected each division-priority slash to have one CST token",
  );
});

test("div-assign-never-splits-into-division", () => {
  const tree = assertFresh(
    "div-assign-never-splits-into-division",
    lines("BEGIN { (a) /= b }"),
    1,
  );
  contains(tree, "ERROR");
  assert.equal(
    matchingLineCount(tree, /^[ \t0-9:-]*"\/"$/),
    0,
    "Expected no division token where '/=' is the longest match",
  );
});

determinismTest("division-to-match-ere", division, matchEre, ["16 3 ~ /a/"]);
determinismTest(
  "insert-div-assign-equals",
  divisionExpression,
  divisionAssignment,
  ["11 0 ="],
);
determinismTest(
  "delete-div-assign-equals",
  divisionAssignment,
  divisionExpression,
  ["11 1 "],
);
determinismTest("operand-to-ere", matchOperand, matchEre, ["18 1 /a/"]);
determinismTest("ere-to-operand", matchEre, matchOperand, ["18 3 a"]);

const ere = lines(
  "BEGIN {",
  "  print /^a.(b|c)*?d{1,2}?$/",
  String.raw`  print /[a-c][[.ch.]][[.-.]][[=a=]][[:alpha:]][\q\/]/`,
  String.raw`  print /\/\\\052\057\134./`,
  "}",
);

freshTest("ere", ere, (tree) => {
  for (const node of [
    "extended_reg_exp",
    "ere_branch",
    "ere_expression",
    "one_char_or_coll_elem_ere",
    "ere_dupl_symbol",
    "repetition_modifier",
    "bracket_expression",
    "matching_list",
    "bracket_list",
    "follow_list",
    "expression_term",
    "single_expression",
    "range_expression",
    "start_range",
    "end_range",
    "collating_element",
    "collating_symbol",
    "equivalence_class",
    "character_class",
    "class_name",
    "ordinary_character",
    "quoted_character",
    "wildcard",
    "left_anchor",
    "right_anchor",
    "dup_count",
    "meta_character",
    "escape_sequence",
    "escaped_delimiter",
  ]) {
    contains(tree, node);
  }
  clean(tree);
});

const plainBracketList = lines("BEGIN { print /[+]?[a]/ }");
const trailingHyphenBracketList = lines("BEGIN { print /[+-]?[a]/ }");
determinismTest(
  "insert-trailing-bracket-hyphen",
  plainBracketList,
  trailingHyphenBracketList,
  ["17 0 -"],
  (tree) => {
    assert.equal(
      matchingLineCount(tree, /^[ \t0-9:-]+bracket_expression$/),
      2,
      "Expected trailing bracket hyphen source to contain two bracket expressions",
    );
    contains(tree, "ere_dupl_symbol");
    excludes(tree, "range_expression");
  },
);

const closedEre = lines("BEGIN { print /abc/", "print /ok/ }");
const unclosedEre = lines("BEGIN { print /abc", "print /ok/ }");
determinismTest("insert-ere-closing-slash", unclosedEre, closedEre, ["18 0 /"]);

const plainEreDelimiter = lines("BEGIN { print /ab/ }");
const escapedEreDelimiter = lines(String.raw`BEGIN { print /ab\/c/ }`);
determinismTest(
  "escape-ere-closing-slash",
  plainEreDelimiter,
  escapedEreDelimiter,
  [String.raw`17 1 \/c/`],
  (tree) => {
    contains(tree, "escaped_delimiter");
  },
);
determinismTest(
  "division-through-broken-to-escaped-ere",
  division,
  escapedEreDelimiter,
  [String.raw`14 5 /ab\/c/`, "20 1 ", "20 0 /"],
);
determinismTest(
  "restore-ere-closing-slash",
  escapedEreDelimiter,
  plainEreDelimiter,
  ["17 4 /"],
  (tree) => excludes(tree, "escaped_delimiter"),
);

const threeDigitOctalEre = lines(String.raw`BEGIN { print /\124/ }`);
const octalFollowedByCharacterEre = lines(String.raw`BEGIN { print /\1234/ }`);
determinismTest(
  "split-ere-octal-at-three-digits",
  threeDigitOctalEre,
  octalFollowedByCharacterEre,
  ["18 0 3"],
  (tree) => {
    contains(tree, "escape_sequence");
    contains(tree, "ordinary_character");
  },
);
determinismTest(
  "join-ere-octal-at-three-digits",
  octalFollowedByCharacterEre,
  threeDigitOctalEre,
  ["18 1 "],
  (tree) => {
    contains(tree, "escape_sequence");
    excludes(tree, "ordinary_character");
  },
);

const greedyEre = lines("BEGIN { print /a*/ }");
const shortestEre = lines("BEGIN { print /a*?/ }");
determinismTest(
  "insert-ere-repetition-modifier",
  greedyEre,
  shortestEre,
  ["17 0 ?"],
  (tree) => contains(tree, "repetition_modifier"),
);
determinismTest(
  "delete-ere-repetition-modifier",
  shortestEre,
  greedyEre,
  ["17 1 "],
  (tree) => excludes(tree, "repetition_modifier"),
);

const equivalenceEre = lines("BEGIN { print /[[=a=]]/ }");
const classEre = lines("BEGIN { print /[[:alpha:]]/ }");
determinismTest(
  "equivalence-to-character-class",
  equivalenceEre,
  classEre,
  ["16 5 [:alpha:]"],
  (tree) => {
    contains(tree, "character_class");
    contains(tree, "class_name");
    excludes(tree, "equivalence_class");
  },
);
determinismTest(
  "character-class-to-equivalence",
  classEre,
  equivalenceEre,
  ["16 9 [=a=]"],
  (tree) => {
    contains(tree, "equivalence_class");
    excludes(tree, "character_class");
  },
);

const literalOpenBracketEre = lines("BEGIN { print /[[]/ }");
const collatingSymbolEre = lines("BEGIN { print /[[.x.]]/ }");
determinismTest(
  "literal-bracket-to-collating-symbol",
  literalOpenBracketEre,
  collatingSymbolEre,
  ["17 0 .x.]"],
  (tree) => {
    contains(tree, "collating_symbol");
  },
);
determinismTest(
  "collating-symbol-to-literal-bracket",
  collatingSymbolEre,
  literalOpenBracketEre,
  ["17 4 "],
  (tree) => {
    contains(tree, "collating_element");
    excludes(tree, "collating_symbol");
  },
);

freshTest("eof-ere-recovery", "BEGIN { print /abc", (tree) => {
  assert.match(tree, /^0:18[ \t]*-[ \t]*0:18[ \t]+ere_end_recovery$/m);
  singleActionCloserRecovery(tree);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

freshTest("eof-ere-escape-recovery", "BEGIN { print /abc\\", (tree) => {
  assert.match(tree, /^0:18[ \t]*-[ \t]*0:19[ \t]+ere_end_recovery([ \t]|$)/m);
  singleActionCloserRecovery(tree);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

freshTest("nested-group-eof", "BEGIN { print /(a", (tree) => {
  assert.match(tree, /^0:17[ \t]*-[ \t]*0:17[ \t]+ere_inner_recovery$/m);
  assert.match(tree, /^0:17[ \t]*-[ \t]*0:17[ \t]+ere_end_recovery$/m);
  singleActionCloserRecovery(tree);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

const rawStatementNewline = lines("BEGIN {", "  print 1", "}");
const continuedStatementBoundary = lines("BEGIN {", "  print 1\\", "}");
determinismTest(
  "raw-newline-to-line-continuation",
  rawStatementNewline,
  continuedStatementBoundary,
  ["17 0 \\"],
);
determinismTest(
  "line-continuation-to-raw-newline",
  continuedStatementBoundary,
  rawStatementNewline,
  ["17 1 "],
);

const outputPipe = lines("BEGIN { print value | command }");
const logicalOrPrint = lines("BEGIN { print value || command }");
determinismTest(
  "output-pipe-to-logical-or",
  outputPipe,
  logicalOrPrint,
  ["21 0 |"],
  (tree) => {
    contains(tree, "operator: or");
    excludes(tree, "output_redirection");
  },
);

const plainAppend = lines("BEGIN { print value >> archive }");
const continuedAppend = lines("BEGIN { print value \\", ">> archive }");
determinismTest(
  "insert-append-line-continuation",
  plainAppend,
  continuedAppend,
  ["20 0 \\\n"],
  (tree) => {
    contains(tree, "redirection: output_redirection");
    contains(tree, "append");
    contains(tree, "line_continuation");
  },
);

const completeReservedIf = lines(
  "BEGIN { if (condition) print body }",
  "END { print target }",
);
const missingReservedIf = lines(
  "BEGIN { if (condition)",
  "END { print target }",
);
determinismTest(
  "restore-if-body-before-end-item",
  missingReservedIf,
  completeReservedIf,
  ["22 1  print body }\n"],
);

const completeDoTail = lines(
  "BEGIN { do print body; while (condition) }",
  "END { print target }",
);
const missingDoTail = lines("BEGIN { do print body;", "END { print target }");
determinismTest(
  "restore-do-tail-before-end-item",
  missingDoTail,
  completeDoTail,
  ["22 1  while (condition) }\n"],
);
const closedSubscriptEof = "BEGIN { delete array[offset] }";
const openSubscriptEof = "BEGIN { delete array[offset";
determinismTest(
  "insert-subscript-and-action-closers-at-eof",
  openSubscriptEof,
  closedSubscriptEof,
  ["27 0 ] }"],
);

const commentBackslash = lines("#\\", "BEGIN {}");
const leadingContinuation = lines("\\", "BEGIN {}");
determinismTest(
  "comment-backslash-to-line-continuation",
  commentBackslash,
  leadingContinuation,
  ["0 1 "],
);

const blankCall = lines("BEGIN { f (value) }");
const continuedCall = lines("BEGIN { f\\", "(value) }");
determinismTest(
  "blank-to-line-continuation-call",
  blankCall,
  continuedCall,
  ["9 1 \\\n"],
  (tree) => {
    assert.match(tree, /^[ \t0-9:-]*func_name[ \t]/m);
    contains(tree, "line_continuation");
  },
);

const plainAddAssign = lines("BEGIN { value += other }");
const continuedAddAssign = lines("BEGIN { value \\", "+= other }");
determinismTest(
  "insert-add-assign-line-continuation",
  plainAddAssign,
  continuedAddAssign,
  ["14 0 \\\n"],
  (tree) => {
    contains(tree, "add_assign");
    contains(tree, "line_continuation");
  },
);

const plainAdditive = lines("BEGIN { left + right }");
const continuedAdditive = lines("BEGIN { left\\", "+ right }");
determinismTest(
  "insert-additive-operator-line-continuation",
  plainAdditive,
  continuedAdditive,
  ["12 1 \\\n"],
  (tree) => {
    contains(tree, '"+"');
    contains(tree, "line_continuation");
  },
);

const plainComparison = lines("BEGIN { left < right }");
const continuedComparison = lines("BEGIN { left\\", "< right }");
determinismTest(
  "insert-comparison-operator-line-continuation",
  plainComparison,
  continuedComparison,
  ["12 1 \\\n"],
  (tree) => {
    contains(tree, '"<"');
    contains(tree, "line_continuation");
  },
);

const continuedGetlineRedirect = lines(
  "BEGIN { getline target\\",
  "< source }",
);
const continuedGetlineComparison = lines(
  "BEGIN { getline target\\",
  "<= source }",
);
freshTest("continued-getline-redirect", continuedGetlineRedirect, (tree) => {
  contains(tree, "source: expr");
  excludes(tree, "operator: le");
  cleanContinuation(tree);
});
determinismTest(
  "continued-getline-redirect-to-comparison",
  continuedGetlineRedirect,
  continuedGetlineComparison,
  ["25 0 ="],
  (tree) => {
    contains(tree, "operator: le");
    excludes(tree, "source: expr");
    contains(tree, "line_continuation");
  },
);

const plainConditional = lines("BEGIN { condition ? yes : no }");
const continuedConditional = lines("BEGIN { condition ? yes\\", ": no }");
determinismTest(
  "insert-conditional-colon-line-continuation",
  plainConditional,
  continuedConditional,
  ["23 1 \\\n"],
  (tree) => {
    contains(tree, "alternative: expr");
    contains(tree, "line_continuation");
  },
);

const plainLogical = lines("BEGIN { left && right }");
const continuedLogical = lines("BEGIN { left\\", "&& right }");
determinismTest(
  "insert-logical-operator-line-continuation",
  plainLogical,
  continuedLogical,
  ["12 1 \\\n"],
  (tree) => {
    contains(tree, "and");
    contains(tree, "line_continuation");
  },
);

const plainPipeGetline = lines("BEGIN { source | getline target }");
const continuedPipeGetline = lines("BEGIN { source\\", "| getline target }");
determinismTest(
  "insert-input-pipe-line-continuation",
  plainPipeGetline,
  continuedPipeGetline,
  ["14 1 \\\n"],
  (tree) => {
    contains(tree, "non_unary_input_function");
    contains(tree, "line_continuation");
  },
);

const unaryPipeGetline = lines("BEGIN { -source | getline target }");
const fieldPipeGetline = lines("BEGIN { $source | getline target }");
determinismTest(
  "unary-to-field-pipe-getline",
  unaryPipeGetline,
  fieldPipeGetline,
  ["8 1 $"],
  (tree) => {
    assert.match(tree, /^[ \t0-9:-]*non_unary_input_function$/m);
  },
);

const stringSource = lines(
  "BEGIN {",
  '  "value"',
  String.raw`  print "" "a #/é value" "\"\\\a\b\f\n\r\t\v\/\.\q\x"`,
  String.raw`  print "\1234" "abcd" "\\n"`,
  "}",
);
freshTest("string", stringSource, (tree) => {
  contains(tree, "string_content");
  contains(tree, "escape_sequence");
  excludes(tree, "line_continuation");
  clean(tree);
});

const rawStringRecovery = lines('BEGIN { print "abc', 'print "ok" }');
freshTest("raw-string-recovery", rawStringRecovery, (tree) => {
  assert.match(tree, /^0:14[ \t]*-[ \t]*0:18[ \t]+string$/m);
  assert.match(tree, /^0:18[ \t]*-[ \t]*0:18[ \t]+string_end_recovery$/m);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

freshTest("eof-string-recovery", 'BEGIN { print "abc', (tree) => {
  assert.match(tree, /^0:18[ \t]*-[ \t]*0:18[ \t]+string_end_recovery$/m);
  singleActionCloserRecovery(tree);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

const continuedLoneEscape = lines('BEGIN { print "abc\\\\');
freshTest("continued-lone-escape", continuedLoneEscape, (tree) => {
  assert.match(tree, /^0:18[ \t]*-[ \t]*0:20[ \t]+escape_sequence[ \t]/m);
  assert.match(tree, /^0:20[ \t]*-[ \t]*0:20[ \t]+string_end_recovery$/m);
  singleActionCloserRecovery(tree);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

const rawLoneEscapeRecovery = lines(
  'BEGIN { print "abc\\\\',
  "",
  'print "ok" }',
);
freshTest("raw-lone-escape-recovery", rawLoneEscapeRecovery, (tree) => {
  assert.match(tree, /^0:18[ \t]*-[ \t]*0:20[ \t]+escape_sequence[ \t]/m);
  assert.match(tree, /^0:20[ \t]*-[ \t]*0:20[ \t]+string_end_recovery$/m);
  assert.match(tree, /^0:20[ \t]*-[ \t]*1:0[ \t]+terminator:[ \t]+newline$/m);
  excludes(tree, "ERROR");
  excludes(tree, "MISSING");
});

const closedString = lines('BEGIN { print "abc"', "}");
const unclosedString = lines('BEGIN { print "abc', "}");
determinismTest("insert-string-closing-quote", unclosedString, closedString, [
  '18 0 "',
]);

const plainEscape = lines('BEGIN { print "an" }');
const backslashEscape = lines(String.raw`BEGIN { print "a\n" }`);
determinismTest(
  "insert-string-escape-backslash",
  plainEscape,
  backslashEscape,
  ["16 0 \\"],
  (tree) => contains(tree, "escape_sequence"),
);
determinismTest(
  "delete-string-escape-backslash",
  backslashEscape,
  plainEscape,
  ["16 1 "],
  (tree) => excludes(tree, "escape_sequence"),
);

const topLevelErePattern = lines("/ready/ { print }");
const topLevelDivisionPattern = lines("total / count { print }");
determinismTest(
  "top-level-ere-to-division-pattern",
  topLevelErePattern,
  topLevelDivisionPattern,
  ["0 7 total / count"],
  (tree) => {
    contains(tree, "normal_pattern");
    excludes(tree, "extended_reg_exp");
    assert.equal(
      matchingLineCount(tree, /^[ \t0-9:-]*"\/"$/),
      1,
      "Expected one division slash in the top-level normal pattern",
    );
  },
);
determinismTest(
  "top-level-division-to-ere-pattern",
  topLevelDivisionPattern,
  topLevelErePattern,
  ["0 13 /ready/"],
  (tree) => {
    contains(tree, "normal_pattern");
    contains(tree, "extended_reg_exp");
    assert.equal(
      matchingLineCount(tree, /^[ \t0-9:-]*"\/"$/),
      2,
      "Expected opening and closing slashes in the top-level ERE pattern",
    );
  },
);

const adjacentFunctionName = lines("function compute(value) {}");
const continuedSpacedFunctionName = lines("function compute \\", "(value) {}");
determinismTest(
  "adjacent-to-continued-spaced-function-name",
  adjacentFunctionName,
  continuedSpacedFunctionName,
  ["16 0  \\\n"],
  (tree) => {
    assert.match(tree, /^[ \t0-9:-]*name:[ \t]+name[ \t]+`compute`$/m);
    excludes(tree, "func_name");
    contains(tree, "line_continuation");
  },
);
determinismTest(
  "continued-spaced-to-adjacent-function-name",
  continuedSpacedFunctionName,
  adjacentFunctionName,
  ["16 3 "],
  (tree) => {
    assert.match(tree, /^[ \t0-9:-]*name:[ \t]+func_name[ \t]+`compute`$/m);
    excludes(tree, "line_continuation");
  },
);

const compactRangePattern = lines("start,stop {}");
const multilineRangePattern = lines("start,", "stop {}");
determinismTest(
  "insert-range-pattern-newline",
  compactRangePattern,
  multilineRangePattern,
  ["6 0 \n"],
  (tree) => {
    contains(tree, "normal_pattern");
    contains(tree, "left: expr");
    contains(tree, "right: expr");
    contains(tree, "newline_opt");
    assert.equal(
      matchingLineCount(tree, /^[ \t0-9:-]+newline_opt$/),
      1,
      "Expected one range-pattern newline_opt owner",
    );
  },
);
determinismTest(
  "delete-range-pattern-newline",
  multilineRangePattern,
  compactRangePattern,
  ["6 1 "],
  (tree) => {
    excludes(tree, "newline_opt");
  },
);

const separatedClosedItems = "BEGIN {}\nEND {}";
const directOpenActionItem = "BEGIN {END {}";
determinismTest(
  "restore-action-close-and-item-terminator",
  directOpenActionItem,
  separatedClosedItems,
  ["7 0 }\n"],
  (tree) => {
    contains(tree, "terminator: terminator");
  },
);

const bareBuiltinConcat = lines('BEGIN { x = length "" }');
const continuedBuiltinConcat = lines("BEGIN { x = length\\", '"" }');
determinismTest(
  "insert-builtin-concat-line-continuation",
  bareBuiltinConcat,
  continuedBuiltinConcat,
  ["18 1 \\\n"],
  (tree) => {
    contains(tree, "builtin_func_name");
    contains(tree, "line_continuation");
  },
);
determinismTest(
  "delete-builtin-concat-line-continuation",
  continuedBuiltinConcat,
  bareBuiltinConcat,
  ["18 2  "],
);

const separatedEmptyStatement = lines("BEGIN {", "; x", "}");
const continuedEmptyStatement = lines("BEGIN {", ";\\", "x", "}");
determinismTest(
  "insert-statement-gap-line-continuation",
  separatedEmptyStatement,
  continuedEmptyStatement,
  ["9 1 \\\n"],
  (tree) => {
    contains(tree, "line_continuation");
  },
);
determinismTest(
  "delete-statement-gap-line-continuation",
  continuedEmptyStatement,
  separatedEmptyStatement,
  ["9 2  "],
);
