const PRECEDENCE = {
  assignment: 1,
  conditional: 2,
  logicalOr: 3,
  logicalAnd: 4,
  membership: 5,
  match: 6,
  comparison: 7,
  concatenation: 8,
  additive: 9,
  multiplicative: 10,
  unary: 11,
  exponentiation: 12,
  prefixUpdate: 13,
  postfixUpdate: 14,
  field: 15,
};

const withLineContinuations = ($, ...members) =>
  seq(
    members[0],
    ...members
      .slice(1)
      .flatMap((member) => [repeat($.line_continuation), member]),
  );

const optionalNewlineLayout = ($) =>
  seq(
    repeat($.line_continuation),
    optional(seq($.newline_opt, repeat($.line_continuation))),
  );

// A statement owns only the line continuations interior to its own trailing
// newline_opt. Continuations after that gap belong to the surrounding list,
// action, or item, keeping every continuation a single owner.
const statementEndLayout = ($) =>
  optional(seq(repeat($.line_continuation), $.newline_opt));

const actionBody = ($, statements) =>
  seq(field("body", statements), repeat($.line_continuation));

const continuedMember = ($, marker, member) =>
  choice(member, seq(marker, repeat1($.line_continuation), member));

const continuedOperatorWith = ($, marker, operator) =>
  continuedMember($, marker, field("operator", operator));

const continuedOperator = ($, operator) =>
  continuedOperatorWith($, $._lc_before_operator, operator);

const continuedExpressionMember = ($, member) =>
  choice(member, seq($._continued_expression_layout, member));

const continuedExpression = ($, name, expression) =>
  continuedExpressionMember($, field(name, expression));

const requiredAfterOptionalNewline = (
  $,
  targetGuard,
  present,
  required = present,
) =>
  choice(
    seq(repeat($.line_continuation), targetGuard, $.newline_opt, present),
    required,
  );

const directFunctionBody = ($) =>
  seq(repeat($.line_continuation), field("body", $.action));

const newlineFunctionBody = ($) =>
  seq(
    repeat($.line_continuation),
    $._action_target_guard,
    $.newline_opt,
    repeat($.line_continuation),
    field("body", $.action),
  );

const functionBody = ($) =>
  choice(directFunctionBody($), newlineFunctionBody($));

const requiredParameter = ($) =>
  requiredAfterOptionalNewline(
    $,
    $._parameter_target_guard,
    continuedExpressionMember($, $.name),
  );

const continuedParameter = ($) =>
  seq(continuedMember($, $._lc_before_comma, ","), requiredParameter($));

const ereEscapeWithCharacter = ($, character) =>
  seq($._ere_escape_start, $._escape_introducer, character);

const ereBracketListAlternatives = ($, followList) => [
  followList,
  prec.dynamic(2, seq(followList, $._ere_bracket_hyphen)),
];

const ereRangeExpressionWith = ($, startRange) =>
  prec.dynamic(
    3,
    choice(
      seq(startRange, $.end_range),
      seq(startRange, $._ere_bracket_hyphen),
    ),
  );

const ereCompoundOpening = ($, punctuation) =>
  seq(
    $._ere_compound_open_guard,
    token.immediate("["),
    token.immediate(punctuation),
  );

const ereCompoundClosing = (guard, punctuation) =>
  seq(guard, token.immediate(punctuation), token.immediate("]"));

const ereRequiredPayload = ($, payload, closing) =>
  choice($._ere_lexical_end, seq(payload, choice(closing, $._ere_lexical_end)));

const ereCompound = ($, opening, payload, closing) =>
  prec(3, seq(opening, ereRequiredPayload($, payload, closing)));

const header = ($, keyword, rest) =>
  seq(keyword, rest, optionalNewlineLayout($));

const conditionalHeader = ($, keyword) =>
  header($, keyword, continuedExpressionMember($, $._parenthesized_condition));

const keywordHeader = ($, keyword) => seq(keyword, optionalNewlineLayout($));

const doWhileTail = ($) =>
  seq(
    $.while_keyword,
    continuedExpressionMember($, $._parenthesized_condition),
  );

const continuedDoTail = ($) =>
  continuedMember($, $._lc_before_do_tail, doWhileTail($));

const controlStatements = ($, body) => [
  seq($._if_header, field("consequence", body)),
  seq(
    $._if_header,
    field("consequence", $.terminated_statement),
    continuedMember($, $._lc_before_else, $._else_header),
    field("alternative", body),
  ),
  seq($._while_header, field("body", body)),
  seq($._for_header, field("body", body)),
];

const actionBoundaryControlBody = ($) =>
  alias($._action_body_boundary_control, $.unterminated_statement);

const statementTerminatedBy = ($, terminator) =>
  seq(
    field("statement", $.terminatable_statement),
    repeat($.line_continuation),
    field("terminator", terminator),
    statementEndLayout($),
  );

const parenthesizedPrintStatement = ($, keyword) =>
  seq(
    keyword,
    continuedExpressionMember($, "("),
    repeat($.line_continuation),
    field("arguments", $.multiple_expr_list),
    $._continued_close_parenthesis,
  );

// The call parenthesis has its own continuation marker: after a bare
// builtin_func_name the parser must decide between the call and the
// name-as-atom concatenation at the marker itself, one token before the
// parenthesis would disambiguate them.
const callArguments = ($) =>
  seq(
    continuedMember($, $._lc_before_call_parenthesis, "("),
    choice(
      $._continued_close_parenthesis,
      seq(
        repeat($.line_continuation),
        $.expr_list,
        $._continued_close_parenthesis,
      ),
    ),
  );

const subscriptedName = ($, subscripts) =>
  seq(
    $.name,
    continuedMember($, $._lc_before_open_bracket, "["),
    repeat($.line_continuation),
    subscripts,
    $._continued_close_bracket,
  );

const terminatedItemWith = ($, item, terminator) =>
  withLineContinuations(
    $,
    field("item", item),
    field("terminator", terminator),
  );

const boundaryTerminatedItem = ($) =>
  choice(
    withLineContinuations(
      $,
      field("item", alias($._closed_item, $.item)),
      $._closed_item_boundary,
    ),
    withLineContinuations(
      $,
      field("item", alias($._normal_pattern_item, $.item)),
      $._normal_pattern_item_boundary,
    ),
  );

const terminatedStatements = ($) =>
  seq(
    $.terminated_statement,
    repeat(seq(repeat($.line_continuation), $.terminated_statement)),
  );

const statementListWithTail = ($, tail) =>
  choice(tail, withLineContinuations($, terminatedStatements($), tail));

const actionBoundaryBody = ($) =>
  actionBody(
    $,
    alias(
      statementListWithTail(
        $,
        alias($._action_body_boundary_control, $.unterminated_statement),
      ),
      $.unterminated_statement_list,
    ),
  );

const rawNewlines = ($) =>
  seq($.newline, repeat(seq(repeat($.line_continuation), $.newline)));

const EXPRESSION_CONTEXT = {
  normal: {
    prefix: "normal",
    expression: "expr",
    unaryExpression: "unary_expr",
    nonUnaryExpression: "non_unary_expr",
    comparison: true,
    input: true,
  },
  print: {
    prefix: "print",
    expression: "print_expr",
    unaryExpression: "unary_print_expr",
    nonUnaryExpression: "non_unary_print_expr",
    comparison: false,
    input: false,
  },
};

const classTierName = (context, classification, tier) =>
  `_${context.prefix}_${classification}_${tier}_expr`;

const anyTierName = (context, tier) => `_${context.prefix}_${tier}_expr`;

const classTier = ($, context, classification, tier) =>
  $[classTierName(context, classification, tier)];

const aliasedClassTier = ($, context, classification, tier) =>
  alias(
    classTier($, context, classification, tier),
    $[
      classification === "unary"
        ? context.unaryExpression
        : context.nonUnaryExpression
    ],
  );

const aliasedAnyTier = ($, context, tier) =>
  alias($[anyTierName(context, tier)], $[context.expression]);

const expressionTargetGuard = ($, context) =>
  context.input ? $._expression_target_guard : $._print_expression_target_guard;

const continuedPresentTierExpression = ($, context, name, tier) =>
  continuedExpression($, name, aliasedAnyTier($, context, tier));

const nonUnaryAtom = ($, context) => {
  const atoms = [
    $._parenthesized_expression,
    $.number,
    $.string,
    $.lvalue,
    $.ere,
    $._user_function_call,
    $._builtin_function_call,
    $.builtin_func_name,
  ];
  if (context.input) {
    atoms.push($.non_unary_input_function);
  }
  return choice(...atoms);
};

const prefixUpdateExpression = ($) =>
  prec.right(
    PRECEDENCE.prefixUpdate,
    seq(
      field("operator", choice($.incr, $.decr)),
      continuedExpression($, "operand", $.lvalue),
    ),
  );

const tieredExpressionRules = (context) => {
  const rules = {};
  const unary = (tier) => classTierName(context, "unary", tier);
  const nonUnary = (tier) => classTierName(context, "non_unary", tier);
  const any = (tier) => anyTierName(context, tier);
  const not = `_${context.prefix}_not_expr`;
  const assignmentRight = `_${context.prefix}_assignment_right_expr`;
  const conditionalConsequence = `_${context.prefix}_conditional_consequence_expr`;
  const conditionalAlternative = `_${context.prefix}_conditional_alternative_expr`;
  const conditionalTail = `_${context.prefix}_conditional_tail`;
  const expression = ($) => $[context.expression];
  const requiredTierName = (name, tier) =>
    `_${context.prefix}_required_${name}_${tier}_expr`;
  const requiredTier = ($, name, tier) => $[requiredTierName(name, tier)];

  const rightTiers = [
    "logical_and",
    "membership",
    ...(context.comparison ? ["comparison"] : []),
    "concatenation",
    "multiplicative",
    "unary",
  ];
  for (const tier of rightTiers) {
    rules[requiredTierName("right", tier)] = ($) =>
      continuedExpression($, "right", aliasedAnyTier($, context, tier));
  }
  rules[requiredTierName("operand", "unary")] = ($) =>
    continuedExpression($, "operand", aliasedAnyTier($, context, "unary"));
  rules[assignmentRight] = ($) =>
    continuedExpression($, "right", expression($));
  rules[conditionalConsequence] = ($) =>
    continuedExpression($, "consequence", expression($));
  rules[conditionalAlternative] = ($) =>
    continuedExpression($, "alternative", expression($));
  rules[conditionalTail] = ($) =>
    seq(
      $._continued_conditional_question,
      $[conditionalConsequence],
      $._continued_conditional_colon,
      $[conditionalAlternative],
    );

  const addAnyTier = (tier) => {
    rules[any(tier)] = ($) =>
      prec(
        1,
        choice(
          aliasedClassTier($, context, "unary", tier),
          aliasedClassTier($, context, "non_unary", tier),
        ),
      );
  };

  const addLeftAssociativeTier = (tier, nextTier, operator, precedence) => {
    const tail = `_${context.prefix}_${tier}_tail`;
    rules[tail] = ($) => seq(operator($), requiredTier($, "right", nextTier));
    for (const classification of ["unary", "non_unary"]) {
      rules[classTierName(context, classification, tier)] = ($) =>
        choice(
          classTier($, context, classification, nextTier),
          prec.left(
            precedence,
            seq(
              field("left", aliasedClassTier($, context, classification, tier)),
              $[tail],
            ),
          ),
        );
    }
  };

  const addNonAssociativeTier = (tier, nextTier, operator, precedence) => {
    addAnyTier(nextTier);
    const tail = `_${context.prefix}_${tier}_tail`;
    rules[tail] = ($) => seq(operator($), requiredTier($, "right", nextTier));
    for (const classification of ["unary", "non_unary"]) {
      rules[classTierName(context, classification, tier)] = ($) =>
        choice(
          classTier($, context, classification, nextTier),
          prec(
            precedence,
            seq(
              field(
                "left",
                aliasedClassTier($, context, classification, nextTier),
              ),
              $[tail],
            ),
          ),
        );
    }
  };

  rules[unary("assignment")] = ($) =>
    classTier($, context, "unary", "conditional");
  rules[nonUnary("assignment")] = ($) =>
    choice(
      classTier($, context, "non_unary", "conditional"),
      prec.right(
        PRECEDENCE.assignment,
        seq(
          field("left", $.lvalue),
          continuedOperator(
            $,
            choice(
              $.pow_assign,
              $.mod_assign,
              $.mul_assign,
              $.div_assign,
              $.add_assign,
              $.sub_assign,
              "=",
            ),
          ),
          $[assignmentRight],
        ),
      ),
    );

  for (const classification of ["unary", "non_unary"]) {
    rules[classTierName(context, classification, "conditional")] = ($) =>
      choice(
        classTier($, context, classification, "logical_or"),
        prec.right(
          PRECEDENCE.conditional,
          seq(
            field(
              "condition",
              aliasedClassTier($, context, classification, "logical_or"),
            ),
            $[conditionalTail],
          ),
        ),
      );
  }

  const addNewlineContinuedTier = (tier, nextTier, operator, precedence) => {
    addAnyTier(nextTier);
    const tail = `_${context.prefix}_${tier}_tail`;
    rules[tail] = ($) =>
      seq(
        operator($),
        requiredAfterOptionalNewline(
          $,
          expressionTargetGuard($, context),
          continuedPresentTierExpression($, context, "right", nextTier),
          requiredTier($, "right", nextTier),
        ),
      );
    for (const classification of ["unary", "non_unary"]) {
      rules[classTierName(context, classification, tier)] = ($) =>
        choice(
          classTier($, context, classification, nextTier),
          prec.left(
            precedence,
            seq(
              field("left", aliasedClassTier($, context, classification, tier)),
              $[tail],
            ),
          ),
        );
    }
  };

  addNewlineContinuedTier(
    "logical_or",
    "logical_and",
    ($) => $._continued_logical_or_operator,
    PRECEDENCE.logicalOr,
  );

  addNewlineContinuedTier(
    "logical_and",
    "membership",
    ($) => $._continued_logical_and_operator,
    PRECEDENCE.logicalAnd,
  );

  const membershipTail = `_${context.prefix}_membership_tail`;
  rules[membershipTail] = ($) =>
    seq(
      $._continued_membership_operator,
      continuedExpression($, "right", $.name),
    );
  for (const classification of ["unary", "non_unary"]) {
    rules[classTierName(context, classification, "membership")] = ($) => {
      const members = [
        classTier($, context, classification, "match"),
        prec.left(
          PRECEDENCE.membership,
          seq(
            field(
              "left",
              aliasedClassTier($, context, classification, "membership"),
            ),
            $[membershipTail],
          ),
        ),
      ];
      if (classification === "non_unary") {
        members.push(
          prec(
            PRECEDENCE.membership,
            seq(
              "(",
              repeat($.line_continuation),
              field("left", $.multiple_expr_list),
              $._continued_close_parenthesis,
              $._continued_membership_operator,
              continuedExpression($, "right", $.name),
            ),
          ),
        );
      }
      return choice(...members);
    };
  }

  const comparisonTier = context.comparison ? "comparison" : "concatenation";
  addNonAssociativeTier(
    "match",
    comparisonTier,
    ($) => $._continued_match_operator,
    PRECEDENCE.match,
  );

  if (context.comparison) {
    addNonAssociativeTier(
      "comparison",
      "concatenation",
      ($) => $._continued_comparison_operator,
      PRECEDENCE.comparison,
    );
  }

  for (const classification of ["unary", "non_unary"]) {
    rules[classTierName(context, classification, "concatenation")] = ($) =>
      choice(
        classTier($, context, classification, "additive"),
        prec.left(
          PRECEDENCE.concatenation,
          seq(
            field(
              "left",
              aliasedClassTier($, context, classification, "concatenation"),
            ),
            continuedExpressionMember(
              $,
              field(
                "right",
                aliasedClassTier($, context, "non_unary", "additive"),
              ),
            ),
          ),
        ),
      );
  }

  addAnyTier("multiplicative");
  addLeftAssociativeTier(
    "additive",
    "multiplicative",
    ($) => $._continued_additive_operator,
    PRECEDENCE.additive,
  );

  addAnyTier("unary");
  addLeftAssociativeTier(
    "multiplicative",
    "unary",
    ($) => $._continued_multiplicative_operator,
    PRECEDENCE.multiplicative,
  );

  const unaryAlternatives = ($) => {
    const alternatives = [];
    if (context.input) {
      alternatives.push(classTier($, context, "unary", "exponentiation"));
    }
    alternatives.push(
      ...["+", "-"].map((operator) =>
        prec.right(
          PRECEDENCE.unary,
          seq(field("operator", operator), requiredTier($, "operand", "unary")),
        ),
      ),
    );
    return alternatives;
  };
  rules[unary("unary")] = ($) => choice(...unaryAlternatives($));
  rules[not] = ($) =>
    prec.right(
      PRECEDENCE.unary,
      seq(field("operator", "!"), requiredTier($, "operand", "unary")),
    );
  rules[nonUnary("unary")] = ($) =>
    choice(classTier($, context, "non_unary", "exponentiation"), $[not]);

  const exponentiationClassifications = context.input
    ? ["unary", "non_unary"]
    : ["non_unary"];
  const exponentiationTail = `_${context.prefix}_exponentiation_tail`;
  rules[exponentiationTail] = ($) =>
    seq(
      $._continued_exponentiation_operator,
      requiredTier($, "right", "unary"),
    );
  for (const classification of exponentiationClassifications) {
    rules[classTierName(context, classification, "exponentiation")] = ($) =>
      choice(
        classTier($, context, classification, "update"),
        prec.right(
          PRECEDENCE.exponentiation,
          seq(
            field(
              "left",
              aliasedClassTier($, context, classification, "update"),
            ),
            $[exponentiationTail],
          ),
        ),
      );
  }
  if (context.input) {
    rules[unary("update")] = ($) => $.unary_input_function;
  }

  rules[nonUnary("update")] = ($) =>
    choice(
      classTier($, context, "non_unary", "atom"),
      $._prefix_update_expr,
      prec.left(
        PRECEDENCE.postfixUpdate,
        seq(
          field("operand", $.lvalue),
          continuedOperator($, choice($.incr, $.decr)),
        ),
      ),
    );

  rules[nonUnary("atom")] = ($) => nonUnaryAtom($, context);

  return rules;
};

const normalExpressionRules = tieredExpressionRules(EXPRESSION_CONTEXT.normal);
const printExpressionRules = tieredExpressionRules(EXPRESSION_CONTEXT.print);

const continuedListElementWith = ($, targetGuard, element) =>
  seq(
    continuedMember($, $._lc_before_comma, ","),
    requiredAfterOptionalNewline(
      $,
      targetGuard,
      continuedExpressionMember($, element),
    ),
  );

const continuedListElement = ($, element) =>
  continuedListElementWith($, $._expression_target_guard, element);

const continuedPipeGet = ($) =>
  continuedExpressionMember($, field("get", $.simple_get));

const continuedPrintListElement = ($, element) =>
  continuedListElementWith($, $._print_expression_target_guard, element);

module.exports = grammar({
  name: "awk",

  externals: ($) => [
    $._begin_word,
    $._end_word,
    $._function_word,
    $._print_word,
    $._break_word,
    $._continue_word,
    $._delete_word,
    $._do_word,
    $._else_word,
    $._exit_word,
    $._for_word,
    $._if_word,
    $._next_word,
    $._nextfile_word,
    $._printf_word,
    $._return_word,
    $._while_word,
    $._name_word,
    $._getline_word,
    $._in_word,
    $._builtin_func_name_word,
    $._func_name_word,
    $._number_integer,
    $._number_fraction,
    $._number_exponent,
    $._division_slash,
    $._ere_opening_slash,
    $._div_assign_operator,
    $._add_assign_operator,
    $._sub_assign_operator,
    $._mul_assign_operator,
    $._mod_assign_operator,
    $._pow_assign_operator,
    $._or_operator,
    $._and_operator,
    $._no_match_operator,
    $._eq_operator,
    $._le_operator,
    $._ge_operator,
    $._ne_operator,
    $._incr_operator,
    $._decr_operator,
    $._append_operator,
    $._output_greater_guard,
    $._lc_before_operator,
    $._lc_before_additive_operator,
    $._lc_before_multiplicative_operator,
    $._lc_before_exponentiation_operator,
    $._lc_before_comparison_operator,
    $._lc_before_match_operator,
    $._lc_before_membership_operator,
    $._lc_before_logical_and_operator,
    $._lc_before_logical_or_operator,
    $._lc_before_conditional_question,
    $._lc_before_conditional_colon,
    $._lc_before_less_than,
    $._lc_before_input_pipe,
    $._lc_before_output_redirection,
    $._lc_before_else,
    $._lc_before_do_tail,
    $._lc_before_for_semicolon,
    $._lc_before_for_update,
    $._lc_before_expression,
    $._lc_before_comma,
    $._lc_before_open_bracket,
    $._lc_before_call_parenthesis,
    $._lc_before_close_parenthesis,
    $._lc_before_close_bracket,
    $._closed_item_boundary,
    $._normal_pattern_item_boundary,
    $._ere_compound_open_guard,
    $._ere_dot_close_guard,
    $._ere_equal_close_guard,
    $._ere_colon_close_guard,
    $._ere_escape_start,
    $._ere_escaped_delimiter_start,
    $._ere_escaped_delimiter_end,
    $._ere_lexical_end,
    $._ere_closing,
    $._expression_target_guard,
    $._print_expression_target_guard,
    $._action_target_guard,
    $._parameter_target_guard,
    $._error_sentinel,
  ],

  extras: ($) => [token(repeat1(choice(" ", "\t"))), $.comment],

  inline: ($) => [
    $._normal_unary_assignment_expr,
    $._normal_unary_update_expr,
    $._print_unary_assignment_expr,
  ],

  conflicts: ($) => [
    [$.item_list, $._terminated_items],
    [$._terminated_item, $.item],
    [$._normal_pattern_item, $.pattern],
    [$.item_list],
    [$.newline_opt],
    [$.terminator],
    [$.terminated_statement, $.unterminated_statement],
    [$.action, $.terminated_statement_list, $.unterminated_statement_list],
    [
      $._action_body_boundary_control,
      $._self_terminating_statement,
      $.unterminated_statement,
    ],
    [$.terminated_statement],
    [$._self_terminating_statement],
    [$._if_header],
    [$._while_header],
    [$._for_header],
    [$._for_in_clause, $.lvalue],
    [
      $._normal_non_unary_atom_expr,
      $._normal_non_unary_field_atom_expr,
      $._builtin_function_call,
    ],
    [$.single_expression, $.start_range],
    [$._initial_close_single_expression, $._initial_close_start_range],
    [$.bracket_list, $.collating_element],
    [$.range_expression, $.collating_element],
    [$._initial_close_range_expression, $.collating_element],
  ],

  rules: {
    program: ($) =>
      choice(
        repeat($.line_continuation),
        seq(
          repeat($.line_continuation),
          choice(
            $.item_list,
            field("item", $.item),
            withLineContinuations($, $.item_list, field("item", $.item)),
          ),
          repeat($.line_continuation),
        ),
      ),

    _continued_expression_layout: ($) =>
      seq($._lc_before_expression, repeat1($.line_continuation)),

    _continued_close_parenthesis: ($) =>
      continuedMember($, $._lc_before_close_parenthesis, ")"),

    _continued_close_bracket: ($) =>
      continuedMember($, $._lc_before_close_bracket, "]"),

    _continued_additive_operator: ($) =>
      continuedOperatorWith(
        $,
        $._lc_before_additive_operator,
        choice("+", "-"),
      ),

    _continued_multiplicative_operator: ($) =>
      continuedOperatorWith(
        $,
        $._lc_before_multiplicative_operator,
        choice("*", alias($._division_slash, "/"), "%"),
      ),

    _continued_exponentiation_operator: ($) =>
      continuedOperatorWith($, $._lc_before_exponentiation_operator, "^"),

    _continued_comparison_operator: ($) =>
      choice(
        continuedOperatorWith($, $._lc_before_less_than, "<"),
        continuedOperatorWith(
          $,
          $._lc_before_comparison_operator,
          choice($.le, $.ne, $.eq, ">", $.ge),
        ),
      ),

    _continued_match_operator: ($) =>
      continuedOperatorWith(
        $,
        $._lc_before_match_operator,
        choice("~", $.no_match),
      ),

    _continued_membership_operator: ($) =>
      continuedOperatorWith($, $._lc_before_membership_operator, $.in_keyword),

    _continued_logical_and_operator: ($) =>
      continuedOperatorWith($, $._lc_before_logical_and_operator, $.and),

    _continued_logical_or_operator: ($) =>
      continuedOperatorWith($, $._lc_before_logical_or_operator, $.or),

    _continued_conditional_question: ($) =>
      continuedMember($, $._lc_before_conditional_question, "?"),

    _continued_conditional_colon: ($) =>
      continuedMember($, $._lc_before_conditional_colon, ":"),

    _continued_input_redirect: ($) =>
      continuedMember($, $._lc_before_less_than, "<"),

    _continued_input_pipe: ($) =>
      continuedMember($, $._lc_before_input_pipe, "|"),

    item_list: ($) =>
      choice(
        field("leading", $.newline_opt),
        $._terminated_items,
        withLineContinuations(
          $,
          field("leading", $.newline_opt),
          $._terminated_items,
        ),
      ),

    _terminated_item: ($) =>
      choice(
        terminatedItemWith($, $.item, $.terminator),
        boundaryTerminatedItem($),
      ),

    _terminated_items: ($) =>
      choice(
        $._terminated_item,
        seq(
          $._terminated_items,
          repeat($.line_continuation),
          $._terminated_item,
        ),
      ),

    item: ($) => choice($._normal_pattern_item, $._closed_item),

    _closed_item: ($) =>
      choice($._action_item, $._pattern_action_item, $._function_item),

    _action_item: ($) => field("action", $.action),

    _pattern_action_item: ($) =>
      withLineContinuations(
        $,
        field("pattern", $.pattern),
        field("action", $.action),
      ),

    _normal_pattern_item: ($) => field("pattern", $.normal_pattern),

    _function_item: ($) => seq($._function_header, functionBody($)),

    _function_header_prefix: ($) =>
      seq(
        $.function_keyword,
        repeat($.line_continuation),
        field("name", choice($.name, $.func_name)),
        continuedExpressionMember($, "("),
        repeat($.line_continuation),
      ),

    _function_header: ($) =>
      seq(
        $._function_header_prefix,
        optional(field("parameters", $.param_list)),
        $._continued_close_parenthesis,
      ),

    param_list: ($) => seq($.name, repeat(continuedParameter($))),

    pattern: ($) => choice($.normal_pattern, $.special_pattern),

    normal_pattern: ($) =>
      choice(
        $.expr,
        prec.right(
          1,
          seq(
            field("left", $.expr),
            continuedMember($, $._lc_before_comma, field("separator", ",")),
            choice(
              requiredAfterOptionalNewline(
                $,
                $._expression_target_guard,
                continuedExpression($, "right", $.expr),
              ),
              // Reachable only during recovery: when the right arm is
              // missing, the action guard keeps an action on the next line
              // inside this item.
              seq(
                repeat($.line_continuation),
                $._action_target_guard,
                $.newline_opt,
                continuedExpression($, "right", $.expr),
              ),
            ),
          ),
        ),
      ),

    special_pattern: ($) => choice($.begin_keyword, $.end_keyword),

    begin_keyword: ($) => prec(10, $._begin_word),

    end_keyword: ($) => prec(10, $._end_word),

    function_keyword: ($) => prec(10, $._function_word),

    _action_opening_layout: ($) =>
      seq(field("opening", "{"), optionalNewlineLayout($)),

    _action_body: ($) =>
      actionBody(
        $,
        choice($.terminated_statement_list, $.unterminated_statement_list),
      ),

    _action_body_boundary_control: ($) =>
      choice(
        $._if_header,
        $._while_header,
        $._for_header,
        ...controlStatements($, actionBoundaryControlBody($)),
      ),

    action: ($) =>
      choice(
        seq($._action_opening_layout, field("closing", "}")),
        seq($._action_opening_layout, $._action_body, field("closing", "}")),
        seq(
          $._action_opening_layout,
          actionBoundaryBody($),
          field("closing", "}"),
        ),
      ),

    terminated_statement_list: ($) => terminatedStatements($),

    unterminated_statement_list: ($) =>
      statementListWithTail($, $.unterminated_statement),

    _parenthesized_condition: ($) =>
      seq(
        "(",
        continuedExpression($, "condition", $.expr),
        $._continued_close_parenthesis,
      ),

    _if_header: ($) => conditionalHeader($, $.if_keyword),

    _else_header: ($) => keywordHeader($, $.else_keyword),

    _while_header: ($) => conditionalHeader($, $.while_keyword),

    _do_header: ($) => keywordHeader($, $.do_keyword),

    _for_classic_clause: ($) =>
      seq(
        optional(field("initializer", $.simple_statement)),
        continuedMember($, $._lc_before_for_semicolon, ";"),
        repeat($.line_continuation),
        optional(field("condition", $.expr)),
        continuedMember($, $._lc_before_for_semicolon, ";"),
        optional(
          choice(
            field("update", $.simple_statement),
            seq(
              $._lc_before_for_update,
              repeat1($.line_continuation),
              field("update", $.simple_statement),
            ),
          ),
        ),
      ),

    _for_in_clause: ($) =>
      seq(
        field("variable", $.name),
        continuedMember($, $._lc_before_membership_operator, $.in_keyword),
        continuedExpressionMember($, field("array", $.name)),
      ),

    _for_header: ($) =>
      header(
        $,
        $.for_keyword,
        seq(
          continuedExpressionMember($, "("),
          repeat($.line_continuation),
          choice($._for_classic_clause, $._for_in_clause),
          $._continued_close_parenthesis,
        ),
      ),

    _self_terminating_statement: ($) =>
      choice(...controlStatements($, $.terminated_statement)),

    terminated_statement: ($) =>
      choice(
        seq($.action, statementEndLayout($)),
        $._self_terminating_statement,
        seq(field("terminator", ";"), statementEndLayout($)),
        statementTerminatedBy($, $.newline),
        statementTerminatedBy($, ";"),
      ),

    unterminated_statement: ($) =>
      choice(
        field("statement", $.terminatable_statement),
        ...controlStatements($, $.unterminated_statement),
      ),

    terminatable_statement: ($) =>
      choice(
        $.simple_statement,
        $.break_keyword,
        $.continue_keyword,
        $.next_keyword,
        $.nextfile_keyword,
        seq($.exit_keyword, optional(continuedExpressionMember($, $.expr))),
        seq($.return_keyword, optional(continuedExpressionMember($, $.expr))),
        seq(
          $._do_header,
          field("body", $.terminated_statement),
          continuedDoTail($),
        ),
      ),

    simple_statement: ($) =>
      choice(
        seq(
          $.delete_keyword,
          continuedExpressionMember($, field("array", $.name)),
          optional(
            seq(
              continuedMember($, $._lc_before_open_bracket, "["),
              repeat($.line_continuation),
              field("subscripts", $.expr_list),
              $._continued_close_bracket,
            ),
          ),
        ),
        $.expr,
        $.print_statement,
      ),

    print_statement: ($) =>
      prec.right(
        choice(
          field("statement", $.simple_print_statement),
          seq(
            field("statement", $.simple_print_statement),
            continuedMember(
              $,
              $._lc_before_output_redirection,
              field("redirection", $.output_redirection),
            ),
          ),
        ),
      ),

    simple_print_statement: ($) =>
      choice(
        prec.right(
          seq(
            $.print_keyword,
            optional(
              continuedExpressionMember(
                $,
                field("arguments", $.print_expr_list),
              ),
            ),
          ),
        ),
        parenthesizedPrintStatement($, $.print_keyword),
        prec.right(
          seq(
            $.printf_keyword,
            continuedExpressionMember($, field("arguments", $.print_expr_list)),
          ),
        ),
        parenthesizedPrintStatement($, $.printf_keyword),
      ),

    output_redirection: ($) =>
      seq(
        choice(seq($._output_greater_guard, choice(">", $.append)), "|"),
        continuedExpressionMember($, $.expr),
      ),

    print_keyword: ($) => prec(10, $._print_word),

    printf_keyword: ($) => prec(10, $._printf_word),

    break_keyword: ($) => $._break_word,

    continue_keyword: ($) => $._continue_word,

    delete_keyword: ($) => $._delete_word,

    do_keyword: ($) => $._do_word,

    else_keyword: ($) => $._else_word,

    exit_keyword: ($) => $._exit_word,

    for_keyword: ($) => $._for_word,

    if_keyword: ($) => $._if_word,

    next_keyword: ($) => $._next_word,

    nextfile_keyword: ($) => $._nextfile_word,

    return_keyword: ($) => $._return_word,

    while_keyword: ($) => $._while_word,

    print_expr_list: ($) =>
      prec.left(
        seq($.print_expr, repeat(continuedPrintListElement($, $.print_expr))),
      ),

    expr_list: ($) => choice($.expr, $.multiple_expr_list),

    multiple_expr_list: ($) =>
      prec.left(
        seq(
          $.expr,
          continuedListElement($, $.expr),
          repeat(continuedListElement($, $.expr)),
        ),
      ),

    print_expr: ($) => choice($.unary_print_expr, $.non_unary_print_expr),

    unary_print_expr: ($) => $._print_unary_assignment_expr,

    non_unary_print_expr: ($) => $._print_non_unary_assignment_expr,

    expr: ($) => choice($.unary_expr, $.non_unary_expr),

    unary_expr: ($) => $._normal_unary_assignment_expr,

    non_unary_expr: ($) => $._normal_non_unary_assignment_expr,

    _prefix_update_expr: ($) => prefixUpdateExpression($),

    ...normalExpressionRules,

    ...printExpressionRules,

    _normal_field_expr: ($) =>
      choice(
        alias($._normal_unary_field_expr, $.unary_expr),
        alias($._normal_non_unary_field_expr, $.non_unary_expr),
      ),

    _normal_unary_field_expr: ($) =>
      prec(PRECEDENCE.field, $._normal_unary_unary_expr),

    _normal_non_unary_field_atom_expr: ($) =>
      prec(PRECEDENCE.field, nonUnaryAtom($, EXPRESSION_CONTEXT.normal)),

    _normal_non_unary_field_expr: ($) =>
      prec(
        PRECEDENCE.field,
        choice(
          $._normal_non_unary_field_atom_expr,
          $._normal_not_expr,
          $._prefix_update_expr,
        ),
      ),

    _parenthesized_expression: ($) =>
      seq(
        "(",
        repeat($.line_continuation),
        $.expr,
        $._continued_close_parenthesis,
      ),

    _user_function_call: ($) => seq($.func_name, callArguments($)),

    _builtin_function_call: ($) =>
      prec.right(PRECEDENCE.field, seq($.builtin_func_name, callArguments($))),

    lvalue: ($) =>
      choice(
        $.name,
        prec.right(PRECEDENCE.field, subscriptedName($, $.expr_list)),
        prec(
          PRECEDENCE.field,
          seq(
            field("operator", "$"),
            continuedExpression(
              $,
              "operand",
              alias($._normal_field_expr, $.expr),
            ),
          ),
        ),
      ),

    non_unary_input_function: ($) =>
      choice(
        field("get", $.simple_get),
        prec.right(
          PRECEDENCE.field,
          seq(
            field("get", $.simple_get),
            $._continued_input_redirect,
            continuedExpression($, "source", $.expr),
          ),
        ),
        prec.right(
          PRECEDENCE.field,
          seq(
            field("source", $.non_unary_expr),
            $._continued_input_pipe,
            continuedPipeGet($),
          ),
        ),
      ),

    unary_input_function: ($) =>
      prec.right(
        PRECEDENCE.field,
        seq(
          field("source", $.unary_expr),
          $._continued_input_pipe,
          continuedPipeGet($),
        ),
      ),

    simple_get: ($) =>
      prec.right(
        PRECEDENCE.field,
        seq(
          $.getline_keyword,
          optional(continuedExpressionMember($, field("target", $.lvalue))),
        ),
      ),

    getline_keyword: ($) => $._getline_word,

    in_keyword: ($) => $._in_word,

    func_name: ($) => $._func_name_word,

    builtin_func_name: ($) => $._builtin_func_name_word,

    name: ($) => $._name_word,

    number: ($) =>
      choice($._number_integer, $._number_fraction, $._number_exponent),

    string: ($) =>
      seq(
        field("opening", '"'),
        repeat(choice($.string_content, $.escape_sequence)),
        field("closing", token.immediate('"')),
      ),

    string_content: () => token.immediate(prec(1, /[^"\\\n]+/)),

    escape_sequence: ($) =>
      seq(
        $._escape_introducer,
        choice($._escape_character, $._escape_octal_digits),
      ),

    add_assign: ($) => $._add_assign_operator,

    sub_assign: ($) => $._sub_assign_operator,

    mul_assign: ($) => $._mul_assign_operator,

    div_assign: ($) => $._div_assign_operator,

    mod_assign: ($) => $._mod_assign_operator,

    pow_assign: ($) => $._pow_assign_operator,

    or: ($) => $._or_operator,

    and: ($) => $._and_operator,

    no_match: ($) => $._no_match_operator,

    eq: ($) => $._eq_operator,

    le: ($) => $._le_operator,

    ge: ($) => $._ge_operator,

    ne: ($) => $._ne_operator,

    incr: ($) => $._incr_operator,

    decr: ($) => $._decr_operator,

    append: ($) => $._append_operator,

    ere: ($) =>
      seq(
        field("opening", alias($._ere_opening_slash, "/")),
        choice(
          seq(
            field("expression", $.extended_reg_exp),
            field("closing", alias($._ere_closing, "/")),
          ),
          seq(
            optional(field("expression", $.extended_reg_exp)),
            $._ere_lexical_end,
          ),
        ),
      ),

    extended_reg_exp: ($) =>
      choice(
        $.ere_branch,
        prec.left(
          1,
          seq(
            field("left", $.extended_reg_exp),
            field("operator", token.immediate("|")),
            field("right", $.ere_branch),
          ),
        ),
      ),

    ere_branch: ($) =>
      choice(
        $.ere_expression,
        prec.left(
          seq(field("left", $.ere_branch), field("right", $.ere_expression)),
        ),
      ),

    ere_expression: ($) =>
      choice(
        $.one_char_or_coll_elem_ere,
        $.left_anchor,
        $.right_anchor,
        seq(
          field("opening", token.immediate("(")),
          field("expression", $.extended_reg_exp),
          field("closing", $._ere_close_parenthesis),
        ),
        prec.left(
          2,
          seq(
            field("operand", $.ere_expression),
            field("operator", $.ere_dupl_symbol),
          ),
        ),
      ),

    one_char_or_coll_elem_ere: ($) =>
      choice(
        $.ordinary_character,
        $.quoted_character,
        $.wildcard,
        $.bracket_expression,
        alias($._ere_octal_escape_sequence, $.escape_sequence),
        alias($._ere_undefined_escape_sequence, $.escape_sequence),
      ),

    ordinary_character: ($) =>
      choice(
        $._ordinary_character,
        $._ere_ordinary_close_parenthesis,
        $._ere_ordinary_close_brace,
        $.escaped_delimiter,
        alias($._ere_named_escape_sequence, $.escape_sequence),
      ),

    quoted_character: ($) =>
      alias($._ere_quoted_escape_sequence, $.escape_sequence),

    wildcard: () => token.immediate("."),

    left_anchor: () => token.immediate("^"),

    right_anchor: () => token.immediate("$"),

    ere_dupl_symbol: ($) =>
      prec.right(
        3,
        seq(
          choice(
            token.immediate("*"),
            token.immediate("+"),
            token.immediate("?"),
            $._ere_interval,
          ),
          optional(field("modifier", $.repetition_modifier)),
        ),
      ),

    repetition_modifier: () => token.immediate("?"),

    _ere_interval: ($) =>
      seq(
        token.immediate("{"),
        ereRequiredPayload(
          $,
          seq(
            $.dup_count,
            optional(seq(token.immediate(","), optional($.dup_count))),
          ),
          $._ere_close_brace,
        ),
      ),

    dup_count: ($) => $._number_digit_chunk,

    bracket_expression: ($) =>
      prec(
        2,
        seq(
          token.immediate("["),
          choice($.matching_list, $.nonmatching_list),
          $._ere_close_bracket,
        ),
      ),

    matching_list: ($) => $.bracket_list,

    nonmatching_list: ($) => seq(token.immediate(prec(3, "^")), $.bracket_list),

    bracket_list: ($) =>
      choice(
        ...ereBracketListAlternatives($, $.follow_list),
        ...ereBracketListAlternatives(
          $,
          alias($._initial_close_follow_list, $.follow_list),
        ),
      ),

    _initial_close_follow_list: ($) =>
      choice(
        alias($._initial_close_expression_term, $.expression_term),
        prec.left(
          seq(
            alias($._initial_close_follow_list, $.follow_list),
            $.expression_term,
          ),
        ),
      ),

    _initial_close_expression_term: ($) =>
      choice(
        alias($._initial_close_single_expression, $.single_expression),
        alias($._initial_close_range_expression, $.range_expression),
      ),

    _initial_close_single_expression: ($) =>
      alias($._initial_close_end_range, $.end_range),

    _initial_close_range_expression: ($) =>
      ereRangeExpressionWith(
        $,
        alias($._initial_close_start_range, $.start_range),
      ),

    _initial_close_start_range: ($) =>
      seq(
        alias($._initial_close_end_range, $.end_range),
        $._ere_bracket_hyphen,
      ),

    _initial_close_end_range: ($) =>
      alias($._ere_bracket_close_character, $.collating_element),

    follow_list: ($) =>
      choice(
        $.expression_term,
        prec.left(seq($.follow_list, $.expression_term)),
      ),

    expression_term: ($) => choice($.single_expression, $.range_expression),

    single_expression: ($) =>
      choice($.end_range, $.character_class, $.equivalence_class),

    range_expression: ($) => ereRangeExpressionWith($, $.start_range),

    start_range: ($) => seq($.end_range, $._ere_bracket_hyphen),

    end_range: ($) => choice($.collating_element, $.collating_symbol),

    collating_element: ($) =>
      choice(
        $._ere_bracket_character,
        $._ere_bracket_open_character,
        $._ere_bracket_hyphen,
        $.escaped_delimiter,
        alias($._ere_bracket_escape_sequence, $.escape_sequence),
      ),

    collating_symbol: ($) =>
      ereCompound(
        $,
        $._ere_open_dot,
        choice(
          alias($._ere_compound_collating_element, $.collating_element),
          $.meta_character,
        ),
        $._ere_dot_close,
      ),

    equivalence_class: ($) =>
      ereCompound(
        $,
        $._ere_open_equal,
        choice(
          alias($._ere_compound_collating_element, $.collating_element),
          alias($._ere_compound_meta_character, $.collating_element),
        ),
        $._ere_equal_close,
      ),

    character_class: ($) =>
      ereCompound($, $._ere_open_colon, $.class_name, $._ere_colon_close),

    class_name: ($) => $._ere_class_name_spelling,

    meta_character: ($) => $._ere_compound_meta_character,

    _ere_compound_collating_element: ($) =>
      choice(
        $._ere_compound_nonmeta_atom,
        seq(
          $._ere_compound_atom,
          $._ere_compound_atom,
          repeat($._ere_compound_atom),
        ),
      ),

    _ere_compound_atom: ($) =>
      choice($._ere_compound_nonmeta_atom, $._ere_compound_meta_character),

    _ere_compound_nonmeta_atom: ($) =>
      choice(
        $._ere_compound_nonmeta_character,
        $.escaped_delimiter,
        alias($._ere_bracket_escape_sequence, $.escape_sequence),
      ),

    _ere_open_dot: ($) => ereCompoundOpening($, "."),

    _ere_dot_close: ($) => ereCompoundClosing($._ere_dot_close_guard, "."),

    _ere_open_equal: ($) => ereCompoundOpening($, "="),

    _ere_equal_close: ($) => ereCompoundClosing($._ere_equal_close_guard, "="),

    _ere_open_colon: ($) => ereCompoundOpening($, ":"),

    _ere_colon_close: ($) => ereCompoundClosing($._ere_colon_close_guard, ":"),

    escaped_delimiter: ($) =>
      seq(
        $._ere_escaped_delimiter_start,
        $._escape_introducer,
        alias($._ere_escaped_delimiter_end, "/"),
      ),

    _ere_named_escape_sequence: ($) =>
      ereEscapeWithCharacter($, $._ere_named_escape_character),

    _ere_quoted_escape_sequence: ($) =>
      ereEscapeWithCharacter($, $._ere_quoted_escape_character),

    _ere_octal_escape_sequence: ($) =>
      ereEscapeWithCharacter($, $._escape_octal_digits),

    _ere_undefined_escape_sequence: ($) =>
      ereEscapeWithCharacter($, $._ere_undefined_escape_character),

    _ere_bracket_escape_sequence: ($) =>
      choice(
        $._ere_named_escape_sequence,
        $._ere_quoted_escape_sequence,
        $._ere_octal_escape_sequence,
        $._ere_undefined_escape_sequence,
      ),

    // Tree-sitter rejects the POSIX bracket spelling for these delimiter
    // characters, so the exclusion sets use its hexadecimal regex escape.
    _ordinary_character: () =>
      token.immediate(prec(1, /[^.\x5B\x5C*^$+?{|}()/\n]/)),

    _ere_ordinary_close_parenthesis: () => token.immediate(prec(1, ")")),

    _ere_ordinary_close_brace: () => token.immediate(prec(1, "}")),

    _ere_close_parenthesis: () => token.immediate(prec(2, ")")),

    _ere_close_brace: () => token.immediate(prec(2, "}")),

    _ere_close_bracket: () => token.immediate(prec(3, "]")),

    _ere_bracket_hyphen: () => token.immediate("-"),

    _ere_bracket_character: () =>
      token.immediate(prec(1, /[^\x2D\x2F\x5B\x5C\x5D\n]/)),

    _ere_bracket_open_character: () => token.immediate(prec(1, "[")),

    _ere_bracket_close_character: () => token.immediate(prec(1, "]")),

    _ere_compound_nonmeta_character: () =>
      token.immediate(/[^\x2D\x2F\x5C\x5D\x5E\n]/),

    _ere_compound_meta_character: () => token.immediate(/[\x2D\x5D\x5E]/),

    _ere_class_name_spelling: () => token.immediate(/[A-Za-z][A-Za-z0-9]*/),

    _ere_named_escape_character: () => token.immediate(/[abfnrtv]/),

    _ere_quoted_escape_character: () =>
      token.immediate(/[().*+?{}|^$\x5B\x5C\x5D]/),

    _ere_undefined_escape_character: () =>
      token.immediate(prec(-1, /[^0-7\x2F\x5C\n]/)),

    newline_opt: ($) => rawNewlines($),

    terminator: ($) =>
      choice(
        rawNewlines($),
        seq(";", repeat(seq(repeat($.line_continuation), $.newline))),
      ),

    newline: () => "\n",

    line_continuation: () => token(seq("\\", "\n")),

    comment: () => token(seq("#", /[^\n]*/)),

    _number_digit_chunk: () => token.immediate(/[0-9]+/),

    _escape_introducer: () => token.immediate(/\\/),

    _escape_character: () =>
      choice(token.immediate(/\\/), token.immediate(prec(1, /[^0-7\\\n]/))),

    _escape_octal_digits: () => token.immediate(/[0-7]{1,3}/),
  },
});
