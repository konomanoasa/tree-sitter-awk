export const standardKeywords = [
  "BEGIN",
  "END",
  "break",
  "continue",
  "delete",
  "do",
  "else",
  "exit",
  "for",
  "function",
  "func",
  "getline",
  "if",
  "in",
  "next",
  "nextfile",
  "print",
  "printf",
  "return",
  "while",
];
export const standardBuiltins = [
  "atan2",
  "close",
  "cos",
  "exp",
  "fflush",
  "gsub",
  "index",
  "int",
  "length",
  "log",
  "match",
  "rand",
  "sin",
  "split",
  "sprintf",
  "sqrt",
  "srand",
  "sub",
  "substr",
  "system",
  "tolower",
  "toupper",
];
export const extensionKeywords = [
  "BEGINFILE",
  "ENDFILE",
  "switch",
  "case",
  "default",
];
export const extensionBuiltins = [
  "and",
  "asort",
  "asorti",
  "bindtextdomain",
  "compl",
  "dcgettext",
  "dcngettext",
  "gensub",
  "isarray",
  "lshift",
  "mkbool",
  "mktime",
  "or",
  "patsplit",
  "rshift",
  "strftime",
  "strtonum",
  "systime",
  "typeof",
  "xor",
];
export const directiveNames = ["include", "load", "namespace", "nsinclude"];
export const regexRoles = [
  "character",
  "wildcard",
  "anchor",
  "anchor_start",
  "anchor_end",
  "class",
  "group_open",
  "group_close",
  "bracket_open",
  "bracket_close",
  "negation",
  "alternation",
  "star",
  "plus",
  "question",
  "modifier",
  "interval_open",
  "interval_close",
  "comma",
  "count",
  "range",
  "class_open",
  "class_close",
  "collating_open",
  "collating_close",
  "equivalence_open",
  "equivalence_close",
  "payload",
  "class_marker",
  "collating_marker",
  "equivalence_marker",
  "form_end",
];
export const externalTokens = [
  "identifier",
  "call_identifier",
  "indirect_identifier",
  "qualifier",
  "call_qualifier",
  "qualified_separator",
  "qualified_identifier",
  "builtin",
  "qualified_builtin",
  "length",
  "parameter",
  "function_start",
  "func_start",
  "function_end",
  "translation_marker",
  "typed_regexp_marker",
  "divide",
  "divide_assign",
  "number_boundary",
  "else_mark",
  "if_end",
  "subscript_link",
  ...extensionKeywords.map((word) => `keyword_${word}`),
  "string_start",
  "string_end",
  "string_content",
  "directive_start",
  "namespace_start",
  "directive_end",
  "directive_text",
  "regexp_start",
  "regexp_end",
  "regex_raw",
  "regex_text",
  "escape_prepare",
  "escape",
  "escape_start",
  "escape_fragment",
  "escape_end",
  "line_continuation",
  "operator_continuation",
  "literal_break",
  "end_of_input",
  ...regexRoles.map((role) => `rx_${role}`),
  "error_sentinel",
];

const commaList = (item) => seq(item, repeat(seq(",", repeat("\n"), item)));
const operatorLayout = ($) =>
  seq(
    repeat(choice("\n", $._operator_space)),
    optional(
      seq(alias($._operator_continuation, $.line_continuation), repeat("\n")),
    ),
  );

const subscriptExpression = (list) => ($) =>
  seq(
    field(
      "array",
      choice($._name, alias($._subscript_prefix, $.subscript_expression)),
    ),
    field("subscript", list($)),
  );
const subscriptList = ($, closing) =>
  seq("[", commaList(field("index", $._expression)), closing);

const directive = (name, operand) => ($) =>
  seq("@", name, operand($), choice(";", "\n", $._end_of_input));
const pathDirective = (name) =>
  directive(name, ($) => field("path", $.directive_string));

const quoted = ($, start, content, end) =>
  seq(
    field("opening", alias(start, '"')),
    repeat(choice(content, $._escape_sequence, $.line_continuation)),
    field("closing", alias(end, '"')),
  );

const directiveString = (start) => ($) =>
  seq(
    optional(alias($._translation_marker, "_")),
    quoted(
      $,
      start($),
      alias($._directive_text, $.directive_text),
      $._directive_end,
    ),
  );

const outputStatement = (keyword) => ($) =>
  seq(
    keyword,
    optional(field("arguments", $.output_arguments)),
    optional(field("redirect", $.output_redirection)),
  );

const simpleStatements = {
  expression: ($) => field("expression", $._expression),
  print: outputStatement("print"),
  printf: outputStatement("printf"),
  delete: ($) => seq("delete", field("target", $._array_reference)),
  return: ($) =>
    seq(
      "return",
      optional(field("value", choice($._expression, $.typed_regexp))),
    ),
  exit: ($) => seq("exit", optional(field("value", $._expression))),
  break: () => "break",
  continue: () => "continue",
  next: () => "next",
  nextfile: () => "nextfile",
};

const condition = ($, keyword) =>
  seq(keyword, "(", field("condition", $._expression), ")");

const statementHeaders = {
  if: ($) => condition($, "if"),
  while: ($) => condition($, "while"),
  for: ($) =>
    seq(
      "for",
      "(",
      optional(field("initializer", $._for_part)),
      ";",
      optional(field("condition", $._expression)),
      ";",
      optional(field("update", $._for_part)),
      ")",
    ),
  for_in: ($) => $._for_in_header,
};
const statementHeader = ($, kind) =>
  seq(statementHeaders[kind]($), repeat("\n"));
const elseBranch = ($, alternative) =>
  seq(
    $._else_mark,
    repeat("\n"),
    "else",
    repeat("\n"),
    field("alternative", alternative),
  );

const statementRules = {
  _if_terminated: ($) =>
    seq(
      statementHeader($, "if"),
      field("consequence", $._terminated_statement),
      choice(elseBranch($, $._terminated_statement), $._if_end),
    ),
  _if_last: ($) =>
    seq(
      statementHeader($, "if"),
      choice(
        field("consequence", $._last_statement),
        seq(
          field("consequence", $._terminated_statement),
          elseBranch($, $._last_statement),
        ),
      ),
    ),
};
for (const [name, form] of Object.entries(simpleStatements)) {
  statementRules[`_${name}_terminated`] = ($) =>
    seq(form($), choice(";", "\n"));
  statementRules[`_${name}_last`] = ($) => form($);
}
const loopKinds = ["while", "for", "for_in"];
for (const kind of loopKinds) {
  statementRules[`_${kind}_terminated`] = ($) =>
    seq(statementHeader($, kind), field("body", $._terminated_statement));
  statementRules[`_${kind}_last`] = ($) =>
    seq(statementHeader($, kind), field("body", $._last_statement));
}

const statementKinds = [...Object.keys(simpleStatements), "if", ...loopKinds];
const statementAliases = ($, names, ending) =>
  names.map((name) => alias($[`_${name}_${ending}`], $[`${name}_statement`]));

const caseValue = ($) =>
  choice(
    $._numeric_literal,
    alias($._signed_number, $.unary_expression),
    $.string,
    $.localized_string,
    $.regexp,
    $.typed_regexp,
  );
const clauseHeads = {
  case: ($) =>
    seq(alias($._keyword_case, "case"), field("value", caseValue($))),
  default: ($) => alias($._keyword_default, "default"),
};
const clause = (kind, body) => ($) => seq(clauseHeads[kind]($), ":", body($));
const completeClauseBody = ($) =>
  optional(field("body", alias($._clause_body_complete, $.statement_list)));
const lastClauseBody = ($) =>
  field("body", alias($._clause_body_last, $.statement_list));

const plainPrimaries = ($) => [
  $._numeric_literal,
  $.string,
  $.localized_string,
  $.regexp,
  $.function_call,
  $.indirect_function_call,
  $.parenthesized_expression,
];

const qualified = (namespace, name) => ($) =>
  seq(
    field("namespace", alias(namespace($), $.identifier)),
    alias($._qualified_separator, "::"),
    field("name", name($)),
  );

const hiddenRules = (prefix, rules) =>
  Object.fromEntries(
    Object.entries(rules).map(([name, rule]) => [`_${prefix}${name}`, rule]),
  );
const level = (ref, name, next, type) => ($) =>
  choice(ref($, next), alias(ref($, `${name}_operation`), $[type]));
const binaryLevels = (ref, levels) =>
  Object.fromEntries(
    levels.flatMap(({ name, next, operator, precedence, newline }) => [
      [name, level(ref, name, next, "binary_expression")],
      [
        `${name}_operation`,
        ($) =>
          prec.left(
            precedence,
            seq(
              field("left", ref($, name)),
              field("operator", operator($)),
              ...(newline ? [operatorLayout($)] : []),
              field("right", ref($, next)),
            ),
          ),
      ],
    ]),
  );

const shared = ($, name) => $[`_${name}`];
const sharedRules = {
  concat: level(shared, "concat", "add", "concatenation_expression"),
  concat_operation: ($) =>
    seq(field("left", $._concat), field("right", $._add)),
  ...binaryLevels(shared, [
    {
      name: "add",
      next: "multiply",
      operator: () => choice("+", "-"),
      precedence: 9,
    },
    {
      name: "multiply",
      next: "unary",
      operator: ($) => choice("*", alias($._divide, "/"), "%"),
      precedence: 10,
    },
  ]),
  unary: level(shared, "unary", "power", "unary_expression"),
  unary_operation: ($) =>
    seq(field("operator", choice("+", "-", "!")), field("operand", $._unary)),
  power: ($) =>
    choice(
      $._primary,
      $.update_expression,
      alias($._power_operation, $.binary_expression),
    ),
  power_operation: ($) =>
    prec.right(
      12,
      seq(
        field("left", choice($._primary, $.update_expression)),
        field("operator", choice("^", "**")),
        field("right", $._unary),
      ),
    ),
};

function contextRules(context, output) {
  const ref = ($, name) => $[`_${context}_${name}`];
  const named = ($, name, type) => alias(ref($, name), $[type]);
  const relational = ($) => [
    $._concat,
    ...(output ? [] : [named($, "pipe", "getline_expression")]),
  ];
  const pipe = ($, source) =>
    seq(
      field("source", source),
      field("operator", choice("|", "|&")),
      $._getline_head,
    );
  return hiddenRules(`${context}_`, {
    assignment: level(
      ref,
      "assignment",
      "conditional",
      "assignment_expression",
    ),
    assignment_operation: ($) =>
      seq(
        field("left", $._lvalue),
        choice(
          seq(
            field("operator", "="),
            field("right", choice(ref($, "assignment"), $.typed_regexp)),
          ),
          seq(
            field(
              "operator",
              choice(
                "+=",
                "-=",
                "*=",
                alias($._divide_assign, "/="),
                "%=",
                "^=",
                "**=",
              ),
            ),
            field("right", ref($, "assignment")),
          ),
        ),
      ),
    conditional: level(ref, "conditional", "or", "conditional_expression"),
    conditional_operation: ($) =>
      seq(
        field("condition", ref($, "or")),
        "?",
        operatorLayout($),
        field("consequence", ref($, "assignment")),
        ":",
        operatorLayout($),
        field("alternative", ref($, "assignment")),
      ),
    ...binaryLevels(ref, [
      {
        name: "or",
        next: "and",
        operator: () => "||",
        precedence: 3,
        newline: true,
      },
      {
        name: "and",
        next: "membership",
        operator: () => "&&",
        precedence: 4,
        newline: true,
      },
    ]),
    membership: level(ref, "membership", "match", "membership_expression"),
    membership_operation: ($) =>
      seq(
        field("index", choice(ref($, "membership"), $.index_list)),
        "in",
        field("array", $._array_reference),
      ),
    match: level(ref, "match", "compare", "binary_expression"),
    match_operation: ($) =>
      seq(
        field("left", ref($, "match")),
        field("operator", choice("~", "!~")),
        field("right", choice(ref($, "compare"), $.typed_regexp)),
      ),
    compare: ($) =>
      choice(
        ...relational($),
        named($, "compare_operation", "binary_expression"),
        ...(output ? [] : [named($, "comparison_pipe", "getline_expression")]),
      ),
    compare_operation: ($) =>
      prec.left(
        7,
        seq(
          field("left", choice(...relational($))),
          field(
            "operator",
            choice("<", "<=", "==", "!=", ">=", ...(output ? [] : [">"])),
          ),
          field("right", choice(...relational($))),
        ),
      ),
    ...(output
      ? {}
      : {
          pipe: ($) =>
            pipe($, choice($._concat, named($, "pipe", "getline_expression"))),
          comparison_pipe: ($) =>
            pipe(
              $,
              choice(
                named($, "compare_operation", "binary_expression"),
                named($, "comparison_pipe", "getline_expression"),
              ),
            ),
        }),
  });
}

const regexSymbol = ($, role, owner) => alias($[`_symbol_${role}`], owner);
const regexToken = (role, raw) => ($) =>
  seq($[`_rx_${role}`], choice(alias($._regex_raw, raw($)), $._regex_sources));
const regexUnit = (role, text) => ($) =>
  seq(
    $[`_rx_${role}`],
    repeat1(
      choice(
        alias($._regex_raw, text($)),
        alias($._regex_text, text($)),
        field("escape", $._escape_sequence),
        $.line_continuation,
      ),
    ),
  );
const regexSymbols = {
  alternation: "|",
  group_open: "(",
  group_close: ")",
  bracket_open: "[",
  bracket_close: "]",
  negation: "^",
  star: "*",
  plus: "+",
  question: "?",
  interval_open: "{",
  interval_close: "}",
  comma: ",",
  range: "-",
  anchor_start: "^",
  anchor_end: "$",
  modifier: "?",
  class_open: "[",
  class_marker: ":",
  class_close: ":",
  collating_open: "[",
  collating_marker: ".",
  collating_close: ".",
  equivalence_open: "[",
  equivalence_marker: "=",
  equivalence_close: "=",
  form_end: "]",
};
const regexForms = {
  class: ["regex_posix_class", "regex_class_name"],
  collating: ["regex_collating_symbol", "regex_collating_element"],
  equivalence: ["regex_equivalence_class", "regex_collating_element"],
};

const definition = {
  name: "awk",
  externals: ($) =>
    externalTokens.map(
      (name) => $[name === "line_continuation" ? name : `_${name}`],
    ),
  extras: ($) => [/[ \t\r]+/, $.comment, $.line_continuation, $._literal_break],
  word: ($) => $._word,
  conflicts: ($) => [
    [$._output_parenthesized, $.parenthesized_expression],
    [$._output_parenthesized, $.index_list],
    [$._for_in_header, $._array_reference],
  ],
  rules: {
    program: ($) => seq(repeat("\n"), optional($._top_level)),
    _operator_space: () => token(/[\f\v]+/),
    _top_level: ($) =>
      choice(
        $._top_nonrule,
        seq(
          alias($._action_rule, $.rule),
          choice(
            seq($._block_separator, optional($._top_level)),
            optional($._top_nonrule),
          ),
        ),
        seq(
          alias($._pattern_rule, $.rule),
          optional(
            seq(choice(";", "\n"), repeat("\n"), optional($._top_level)),
          ),
        ),
      ),
    _top_nonrule: ($) =>
      choice(
        seq(
          $.function_definition,
          repeat("\n"),
          optional(seq(";", repeat("\n"))),
          optional($._top_level),
        ),
        seq($._directive, repeat("\n"), optional($._top_level)),
      ),
    _block_separator: () =>
      choice(seq(repeat("\n"), ";", repeat("\n")), repeat1("\n")),
    _action_rule: ($) =>
      seq(
        optional(
          field(
            "pattern",
            choice($.special_pattern, $._expression, $.range_pattern),
          ),
        ),
        field("action", $.block),
      ),
    _pattern_rule: ($) =>
      field("pattern", choice($._expression, $.range_pattern)),
    range_pattern: ($) =>
      seq(
        field("start", $._expression),
        ",",
        repeat("\n"),
        field("end", $._expression),
      ),
    special_pattern: ($) =>
      choice(
        "BEGIN",
        "END",
        alias($._keyword_BEGINFILE, "BEGINFILE"),
        alias($._keyword_ENDFILE, "ENDFILE"),
      ),
    function_definition: ($) =>
      seq(
        choice(
          alias($._function_start, "function"),
          alias($._func_start, "func"),
        ),
        field(
          "name",
          choice(
            $._name,
            alias($._call_identifier, $.identifier),
            alias($._qualified_definition, $.qualified_name),
          ),
        ),
        field("parameters", $.parameter_list),
        repeat("\n"),
        field("body", $.block),
        $._function_end,
      ),
    parameter_list: ($) =>
      seq("(", optional(commaList(alias($._parameter, $.identifier))), ")"),
    _directive: ($) =>
      choice(
        $.namespace_directive,
        $.include_directive,
        $.nsinclude_directive,
        $.load_directive,
      ),
    include_directive: pathDirective("include"),
    nsinclude_directive: pathDirective("nsinclude"),
    load_directive: pathDirective("load"),
    directive_string: directiveString(($) => $._directive_start),
    namespace_directive: directive("namespace", ($) =>
      field("name", alias($._namespace_string, $.directive_string)),
    ),
    _namespace_string: directiveString(($) => $._namespace_start),
    ...statementRules,
    _for_in_header: ($) =>
      seq(
        "for",
        "(",
        field("index", $._name),
        "in",
        field("array", $._array_reference),
        ")",
      ),
    block: ($) =>
      seq(
        field("opening", "{"),
        optional(field("body", $.statement_list)),
        field("closing", "}"),
      ),
    statement_list: ($) =>
      choice(
        seq(
          repeat1(choice($._terminated_statement, "\n")),
          optional($._last_statement),
        ),
        $._last_statement,
      ),
    _terminated_statement: ($) =>
      choice(
        ...statementAliases($, statementKinds, "terminated"),
        $.empty_statement,
        $.block,
        $.do_statement,
        $.switch_statement,
      ),
    _last_statement: ($) =>
      choice(...statementAliases($, statementKinds, "last")),
    empty_statement: () => ";",
    _for_part: ($) =>
      choice(
        $._expression,
        ...statementAliases($, ["print", "printf", "delete"], "last"),
      ),
    do_statement: ($) =>
      seq(
        "do",
        repeat("\n"),
        field("body", $._terminated_statement),
        repeat("\n"),
        condition($, "while"),
      ),
    switch_statement: ($) =>
      seq(
        alias($._keyword_switch, "switch"),
        "(",
        field("value", $._expression),
        ")",
        repeat("\n"),
        "{",
        repeat("\n"),
        repeat(
          choice(
            alias($._case_complete, $.case_clause),
            alias($._default_complete, $.default_clause),
          ),
        ),
        optional(choice($.case_clause, $.default_clause)),
        "}",
      ),
    _clause_body_complete: ($) =>
      repeat1(choice($._terminated_statement, "\n")),
    _clause_body_last: ($) =>
      seq(optional($._clause_body_complete), $._last_statement),
    _case_complete: clause("case", completeClauseBody),
    _default_complete: clause("default", completeClauseBody),
    case_clause: clause("case", lastClauseBody),
    default_clause: clause("default", lastClauseBody),
    _signed_number: ($) =>
      seq(
        field("operator", choice("+", "-")),
        field("operand", $._numeric_literal),
      ),
    ...hiddenRules("", sharedRules),
    ...contextRules("expr", false),
    ...contextRules("output", true),
    _expression: ($) => $._expr_assignment,
    _output_expression: ($) => $._output_assignment,
    _array_reference: ($) => choice($._name, $.subscript_expression),
    _lvalue: ($) => choice($._array_reference, $.field_reference),
    _primary: ($) =>
      choice($._lvalue, ...plainPrimaries($), $.getline_expression),
    parenthesized_expression: ($) => seq("(", $._expression, ")"),
    subscript_expression: subscriptExpression(($) => $.subscript_list),
    _subscript_prefix: subscriptExpression(($) =>
      alias($._linked_subscript, $.subscript_list),
    ),
    subscript_list: ($) => subscriptList($, "]"),
    _linked_subscript: ($) => subscriptList($, alias($._subscript_link, "]")),
    index_list: ($) =>
      seq(
        "(",
        field("index", $._expression),
        repeat1(seq(",", repeat("\n"), field("index", $._expression))),
        ")",
      ),
    field_reference: ($) =>
      seq(field("operator", "$"), field("index", $._field_index)),
    _field_index: ($) =>
      choice(
        $._array_reference,
        $.field_reference,
        ...plainPrimaries($),
        alias($._unary_operation, $.unary_expression),
        alias($._prefix_update, $.update_expression),
      ),
    _prefix_update: ($) =>
      seq(field("operator", choice("++", "--")), field("operand", $._lvalue)),
    update_expression: ($) =>
      choice(
        $._prefix_update,
        prec.left(
          13,
          seq(
            field("operand", $._lvalue),
            field("operator", choice("++", "--")),
          ),
        ),
      ),
    function_call: ($) =>
      prec.right(
        17,
        choice(
          seq(
            field(
              "name",
              choice(
                alias($._call_identifier, $.identifier),
                alias($._builtin, $.builtin_function),
                alias($._length, $.builtin_function),
                alias($._qualified_call, $.qualified_name),
              ),
            ),
            field("arguments", $.argument_list),
          ),
          field("name", alias($._length, $.builtin_function)),
        ),
      ),
    indirect_function_call: ($) =>
      seq(
        "@",
        field(
          "name",
          choice(
            alias($._indirect_identifier, $.identifier),
            alias($._qualified_definition, $.qualified_name),
          ),
        ),
        field("arguments", $.argument_list),
      ),
    argument_list: ($) =>
      seq(
        "(",
        optional(
          commaList(field("argument", choice($._expression, $.typed_regexp))),
        ),
        ")",
      ),
    typed_regexp: ($) => seq(alias($._typed_regexp_marker, "@"), $.regexp),
    _getline_head: ($) =>
      prec.right(18, seq("getline", optional(field("target", $._lvalue)))),
    getline_expression: ($) =>
      prec.right(
        9,
        seq(
          $._getline_head,
          optional(seq(field("operator", "<"), field("source", $._add))),
        ),
      ),
    output_arguments: ($) => choice($._output_plain, $._output_parenthesized),
    _output_plain: ($) => commaList(field("argument", $._output_expression)),
    _output_parenthesized: ($) =>
      prec.dynamic(
        1,
        seq("(", commaList(field("argument", $._expression)), ")"),
      ),
    output_redirection: ($) =>
      seq(
        field("operator", choice(">", ">>", "|", "|&")),
        field(
          "destination",
          choice($._concat, alias($._expr_pipe, $.getline_expression)),
        ),
      ),
    _name: ($) => choice(alias($._identifier, $.identifier), $.qualified_name),
    qualified_name: qualified(
      ($) => $._qualifier,
      ($) => alias($._qualified_identifier, $.identifier),
    ),
    _qualified_call: qualified(
      ($) => $._call_qualifier,
      ($) =>
        choice(
          alias($._qualified_identifier, $.identifier),
          alias($._qualified_builtin, $.builtin_function),
        ),
    ),
    _qualified_definition: qualified(
      ($) => $._call_qualifier,
      ($) => alias($._qualified_identifier, $.identifier),
    ),
    // Prevent keyword-prefix fallback after scanner rejection.
    _word: () => /[A-Za-z_][A-Za-z0-9_]*/,
    _numeric_literal: ($) =>
      seq($._number_boundary, alias($._number, $.number)),
    _number: () =>
      token(
        choice(
          /([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?/,
          /0[xX][0-9a-fA-F]+/,
          /0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]*)?[pP][+-]?[0-9]+/,
        ),
      ),
    string: ($) =>
      quoted(
        $,
        $._string_start,
        alias($._string_content, $.string_content),
        $._string_end,
      ),
    localized_string: ($) => seq(alias($._translation_marker, "_"), $.string),
    _escape_sequence: ($) =>
      seq(
        $._escape_prepare,
        choice(
          alias($._escape, $.escape_sequence),
          alias($._split_escape, $.escape_sequence),
        ),
      ),
    _split_escape: ($) =>
      seq(
        field("fragment", alias($._escape_start, $.escape_fragment)),
        repeat(
          choice(
            $.line_continuation,
            field("fragment", alias($._escape_fragment, $.escape_fragment)),
          ),
        ),
        $._escape_end,
      ),
    // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL must terminate comments.
    comment: () => token(seq("#", /[^\n\x00]*/)),
    regexp: ($) =>
      seq(
        field("opening", alias($._regexp_start, "/")),
        optional(field("pattern", $.regular_expression)),
        field("closing", alias($._regexp_end, "/")),
      ),
    regular_expression: ($) =>
      choice(
        $.regex_branch,
        seq(
          optional($.regex_branch),
          repeat1(
            seq(
              regexSymbol($, "alternation", $.regex_operator),
              optional($.regex_branch),
            ),
          ),
        ),
      ),
    regex_branch: ($) => repeat1(choice($._regex_atom, $.regex_repetition)),
    _regex_atom: ($) =>
      choice(
        $.regex_character,
        $.regex_wildcard,
        $.regex_anchor,
        $.regex_character_class,
        $.regex_group,
        $.regex_bracket_expression,
      ),
    regex_character: regexToken("character", ($) => $.regex_text),
    _regex_sources: ($) =>
      repeat1(
        choice(
          field("escape", $._escape_sequence),
          alias($._regex_text, $.regex_text),
          $.line_continuation,
        ),
      ),
    regex_wildcard: regexToken("wildcard", () => "."),
    regex_anchor: ($) =>
      choice(
        $._symbol_anchor_start,
        $._symbol_anchor_end,
        seq($._rx_anchor, $._regex_sources),
      ),
    regex_character_class: ($) => seq($._rx_class, $._regex_sources),
    regex_group: ($) =>
      seq(
        field("opening", regexSymbol($, "group_open", $.regex_delimiter)),
        optional(field("pattern", $.regular_expression)),
        field("closing", regexSymbol($, "group_close", $.regex_delimiter)),
      ),
    regex_bracket_expression: ($) =>
      seq(
        field("opening", regexSymbol($, "bracket_open", $.regex_delimiter)),
        optional($._symbol_negation),
        repeat1(
          choice(
            $._regex_endpoint,
            $.regex_range,
            $.regex_posix_class,
            $.regex_equivalence_class,
          ),
        ),
        field("closing", regexSymbol($, "bracket_close", $.regex_delimiter)),
      ),
    _regex_endpoint: ($) => choice($.regex_character, $.regex_collating_symbol),
    regex_range: ($) =>
      seq(
        field("start", choice($._regex_endpoint, $.regex_equivalence_class)),
        field("operator", regexSymbol($, "range", $.regex_operator)),
        field("end", $._regex_endpoint),
      ),
    regex_repetition: ($) =>
      seq(
        field("operand", $._regex_atom),
        repeat1(field("quantifier", $.regex_quantifier)),
      ),
    regex_quantifier: ($) =>
      seq(
        choice(
          field(
            "operator",
            choice(
              regexSymbol($, "star", $.regex_operator),
              regexSymbol($, "plus", $.regex_operator),
              regexSymbol($, "question", $.regex_operator),
            ),
          ),
          field("interval", $.regex_interval),
        ),
        optional(field("modifier", $.regex_repetition_modifier)),
      ),
    regex_repetition_modifier: ($) => $._symbol_modifier,
    regex_interval: ($) =>
      seq(
        field("opening", regexSymbol($, "interval_open", $.regex_delimiter)),
        field("minimum", $.regex_count),
        optional(
          seq($._symbol_comma, optional(field("maximum", $.regex_count))),
        ),
        field("closing", regexSymbol($, "interval_close", $.regex_delimiter)),
      ),
    regex_count: regexUnit("count", ($) => $.regex_digits),
    _regex_payload: regexUnit("payload", ($) => $.regex_text),
    regex_class_name: ($) => $._regex_payload,
    regex_collating_element: ($) => $._regex_payload,
    ...Object.fromEntries(
      Object.entries(regexSymbols).map(([role, spelling]) => [
        `_symbol_${role}`,
        regexToken(role, () => spelling),
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(regexForms).flatMap(([form, [node, payload]]) => [
        [
          node,
          ($) =>
            seq(
              field(
                "opening",
                alias($[`_form_${form}_open`], $.regex_delimiter),
              ),
              field("payload", $[payload]),
              field(
                "closing",
                alias($[`_form_${form}_close`], $.regex_delimiter),
              ),
            ),
        ],
        [
          `_form_${form}_open`,
          ($) => seq($[`_symbol_${form}_open`], $[`_symbol_${form}_marker`]),
        ],
        [
          `_form_${form}_close`,
          ($) => seq($[`_symbol_${form}_close`], $._symbol_form_end),
        ],
      ]),
    ),
  },
};

export default globalThis.grammar?.(definition);
