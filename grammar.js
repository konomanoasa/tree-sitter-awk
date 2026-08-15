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

const actionEnd = ($, itemBoundaryGuard) =>
  choice(
    field("closing", "}"),
    actionCloserRecovery($, $._action_eof_recovery),
    actionCloserRecovery($, itemBoundaryGuard),
    seq(
      $._lc_before_action_eof,
      repeat1($.line_continuation),
      actionCloserRecovery($, $._action_eof_recovery),
    ),
  );

const actionCloserRecovery = ($, guard) =>
  field("closing", prec.dynamic(-1, alias(guard, $.closer_recovery)));

const actionItemBoundaryEnd = ($) =>
  field(
    "closing",
    prec.dynamic(
      -1,
      alias($._action_item_boundary_recovery, $.action_item_boundary_recovery),
    ),
  );

const optionalNewlineLayout = ($) =>
  seq(
    repeat($.line_continuation),
    optional(seq($.newline_opt, repeat($.line_continuation))),
  );

const actionOpeningLayout = ($) =>
  seq(field("opening", "{"), optionalNewlineLayout($));

const actionBody = ($, statements) =>
  seq(field("body", statements), repeat($.line_continuation));

const continuedMember = ($, marker, member) =>
  choice(member, seq(marker, repeat1($.line_continuation), member));

const closerRecovery = ($, recovery) =>
  prec.dynamic(-1, alias(recovery, $.closer_recovery));

const continuedClosingRecovery = ($, recovery) =>
  choice(
    closerRecovery($, recovery),
    seq(
      $._lc_before_closer_recovery,
      repeat1($.line_continuation),
      closerRecovery($, recovery),
    ),
  );

const continuedClosingMember = ($, marker, member, recovery) =>
  choice(
    continuedMember($, marker, member),
    continuedClosingRecovery($, recovery),
  );

const continuedOperatorWith = ($, marker, operator) =>
  continuedMember($, marker, field("operator", operator));

const continuedOperator = ($, operator) =>
  continuedOperatorWith($, $._lc_before_operator, operator);

const continuedExpression = ($, name, expression) =>
  continuedMember($, $._lc_before_expression, field(name, expression));

const requiredAfterOptionalNewline = ($, targetGuard, present, required) =>
  choice(
    seq(repeat($.line_continuation), targetGuard, $.newline_opt, present),
    required,
  );

const expressionRecovery = ($) =>
  prec.dynamic(-1, alias($._expression_recovery, $.expression_recovery));

const rangeRightExpressionRecovery = ($) =>
  choice(
    expressionRecovery($),
    prec.dynamic(
      -1,
      alias($._range_right_expression_recovery, $.expression_recovery),
    ),
  );

const listExpressionRecovery = ($) =>
  prec.dynamic(-1, alias($._list_expression_recovery, $.expression_recovery));

const printExpressionRecovery = ($) =>
  prec.dynamic(-1, alias($._print_expression_recovery, $.expression_recovery));

const statementRecovery = ($) =>
  prec.dynamic(-1, alias($._statement_recovery, $.statement_recovery));

const doTailRecovery = ($) =>
  prec.dynamic(-1, alias($._do_tail_recovery, $.do_tail_recovery));

const terminatorRecovery = ($) =>
  prec.dynamic(-1, alias($._terminator_recovery, $.terminator_recovery));

const closedItemTerminatorRecovery = ($) =>
  prec.dynamic(
    -1,
    alias($._closed_item_terminator_recovery, $.terminator_recovery),
  );

const normalItemTerminatorRecovery = ($) =>
  prec.dynamic(
    -1,
    alias($._normal_item_terminator_recovery, $.terminator_recovery),
  );

const functionBodyRecovery = ($) =>
  field(
    "body",
    prec.dynamic(
      -1,
      alias($._function_body_recovery, $.function_body_recovery),
    ),
  );

const continuedFunctionBodyRecovery = ($) =>
  choice(
    functionBodyRecovery($),
    seq(repeat1($.line_continuation), functionBodyRecovery($)),
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
  choice(
    directFunctionBody($),
    newlineFunctionBody($),
    continuedFunctionBodyRecovery($),
  );

const parameterRecovery = ($) =>
  prec.dynamic(-1, alias($._parameter_recovery, $.parameter_recovery));

const requiredParameter = ($) =>
  requiredAfterOptionalNewline(
    $,
    $._parameter_target_guard,
    continuedMember($, $._lc_before_expression, $.name),
    continuedMember($, $._lc_before_expression, $.name),
  );

const continuedParameter = ($) =>
  seq(continuedMember($, $._lc_before_comma, ","), requiredParameter($));

const continuedParameterRecovery = ($) =>
  seq(
    continuedMember($, $._lc_before_comma, ","),
    repeat($.line_continuation),
    parameterRecovery($),
  );

const continuedRequiredMemberWith = ($, member, recovery) =>
  choice(
    choice(member, recovery($)),
    seq($._lc_before_expression, repeat1($.line_continuation), member),
    seq(repeat1($.line_continuation), recovery($)),
  );

const continuedRequiredMember = ($, member) =>
  continuedRequiredMemberWith($, member, expressionRecovery);

const continuedRequiredExpressionWith = ($, name, expression, recovery) =>
  choice(
    field(name, choice(expression, recovery($))),
    seq(
      $._lc_before_expression,
      repeat1($.line_continuation),
      field(name, expression),
    ),
    seq(repeat1($.line_continuation), field(name, recovery($))),
  );

const continuedRequiredExpression = ($, name, expression) =>
  continuedRequiredExpressionWith($, name, expression, expressionRecovery);

const repeatedWithLineContinuations = ($, member) =>
  seq(member, repeat(seq(repeat($.line_continuation), member)));

const ereRecoveryBoundary = ($, boundary) =>
  prec.dynamic(-1, alias(boundary, $.ere_inner_recovery));

const ereRecoveredMember = ($) =>
  choice(
    ereRecoveryBoundary($, $._ere_inner_slash_boundary),
    ereRecoveryBoundary($, $._ere_inner_end_boundary),
  );

const ereRecoverableMember = ($, member) =>
  choice(member, ereRecoveredMember($));

const ereCompoundBoundary = ($) =>
  ereRecoveryBoundary($, $._ere_compound_boundary);

const ereEscapeWithCharacter = ($, character) =>
  seq($._ere_escape_start, $._escape_introducer, character);

const ereEscapeWithOctal = ($) =>
  seq($._ere_escape_start, $._escape_introducer, $._escape_octal_digits);

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

const logicalWord = ($, classification) =>
  seq(classification, $._word_spelling);

const fractionalDigits = ($) =>
  seq($._number_fraction_digits, $._number_digit_chunk);

const numberFraction = ($) =>
  choice(
    seq($._number_digit_chunk, $._number_dot, optional(fractionalDigits($))),
    seq($._number_dot, fractionalDigits($)),
  );

const numberBase = ($) => choice($._number_digit_chunk, numberFraction($));

const numberExponent = ($) =>
  seq(
    $._number_exponent_character,
    optional($._number_sign),
    $._number_digit_chunk,
  );

const conditionalHeader = ($, keyword) =>
  seq(
    keyword,
    continuedMember($, $._lc_before_expression, $._parenthesized_condition),
    optionalNewlineLayout($),
  );

const keywordHeader = ($, keyword) => seq(keyword, optionalNewlineLayout($));

const doWhileTail = ($, whileKeyword) =>
  seq(
    whileKeyword,
    continuedMember($, $._lc_before_expression, $._parenthesized_condition),
  );

const directDoTail = ($) =>
  choice(doWhileTail($, $.while_keyword), doTailRecovery($));

const continuedDoTail = ($) =>
  choice(
    directDoTail($),
    seq($._lc_before_do_tail, repeat1($.line_continuation), directDoTail($)),
  );

const controlStatements = ($, body) => [
  seq($._if_header, field("consequence", body)),
  seq(
    $._if_header,
    field("consequence", $._terminated_statement_or_recovery),
    continuedMember($, $._lc_before_else, $._else_header),
    field("alternative", body),
  ),
  seq($._while_header, field("body", body)),
  seq($._for_header, field("body", body)),
];

const statementTerminatedBy = ($, terminator) =>
  choice(
    withLineContinuations(
      $,
      field("statement", $.terminatable_statement),
      field("terminator", terminator),
    ),
    withLineContinuations(
      $,
      field("statement", $.terminatable_statement),
      field("terminator", terminator),
      $.newline_opt,
    ),
  );

const parenthesizedPrintStatement = ($, keyword) =>
  seq(
    keyword,
    continuedMember($, $._lc_before_expression, "("),
    repeat($.line_continuation),
    field("arguments", $.multiple_expr_list),
    $._continued_close_parenthesis,
  );

const callArguments = ($) =>
  seq(
    continuedMember($, $._lc_before_expression, "("),
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

const terminatedItem = ($) => terminatedItemWith($, $.item, $.terminator);

const recoveredClosedTerminatedItem = ($) =>
  terminatedItemWith(
    $,
    alias($._closed_item, $.item),
    closedItemTerminatorRecovery($),
  );

const recoveredTerminatedItem = ($) =>
  choice(
    recoveredClosedTerminatedItem($),
    terminatedItemWith(
      $,
      alias($._normal_pattern_item, $.item),
      normalItemTerminatorRecovery($),
    ),
  );

const terminatedStatements = ($) =>
  repeatedWithLineContinuations($, $.terminated_statement);

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

const publicClass = ($, context, classification) =>
  $[
    classification === "unary"
      ? context.unaryExpression
      : context.nonUnaryExpression
  ];

const aliasedClassTier = ($, context, classification, tier) =>
  alias(
    classTier($, context, classification, tier),
    publicClass($, context, classification),
  );

const aliasedAnyTier = ($, context, tier) =>
  alias($[anyTierName(context, tier)], $[context.expression]);

const expressionTargetGuard = ($, context) =>
  context.input ? $._expression_target_guard : $._print_expression_target_guard;

const continuedTierExpression = ($, context, name, tier) =>
  continuedRequiredExpression($, name, aliasedAnyTier($, context, tier));

const continuedPresentTierExpression = ($, context, name, tier) =>
  continuedExpression($, name, aliasedAnyTier($, context, tier));

const continuedClassTier = ($, context, name, classification, tier) =>
  continuedMember(
    $,
    $._lc_before_expression,
    field(name, aliasedClassTier($, context, classification, tier)),
  );

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

const tieredExpressionRules = (context) => {
  const rules = {};
  const unary = (tier) => classTierName(context, "unary", tier);
  const nonUnary = (tier) => classTierName(context, "non_unary", tier);
  const any = (tier) => anyTierName(context, tier);
  const not = `_${context.prefix}_not_expr`;
  const prefixUpdate = `_${context.prefix}_prefix_update_expr`;
  const expression = ($) => $[context.expression];

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
    for (const classification of ["unary", "non_unary"]) {
      rules[classTierName(context, classification, tier)] = ($) =>
        choice(
          classTier($, context, classification, nextTier),
          prec.left(
            precedence,
            seq(
              field("left", aliasedClassTier($, context, classification, tier)),
              operator($),
              continuedTierExpression($, context, "right", nextTier),
            ),
          ),
        );
    }
  };

  const addNonAssociativeTier = (tier, nextTier, operator, precedence) => {
    addAnyTier(nextTier);
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
              operator($),
              continuedTierExpression($, context, "right", nextTier),
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
          continuedRequiredExpression($, "right", expression($)),
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
            $._continued_conditional_question,
            continuedRequiredExpression($, "consequence", expression($)),
            $._continued_conditional_colon,
            continuedRequiredExpression($, "alternative", expression($)),
          ),
        ),
      );
  }

  addAnyTier("logical_and");
  for (const classification of ["unary", "non_unary"]) {
    rules[classTierName(context, classification, "logical_or")] = ($) =>
      choice(
        classTier($, context, classification, "logical_and"),
        prec.left(
          PRECEDENCE.logicalOr,
          seq(
            field(
              "left",
              aliasedClassTier($, context, classification, "logical_or"),
            ),
            $._continued_logical_or_operator,
            requiredAfterOptionalNewline(
              $,
              expressionTargetGuard($, context),
              continuedPresentTierExpression(
                $,
                context,
                "right",
                "logical_and",
              ),
              continuedTierExpression($, context, "right", "logical_and"),
            ),
          ),
        ),
      );
  }

  addAnyTier("membership");
  for (const classification of ["unary", "non_unary"]) {
    rules[classTierName(context, classification, "logical_and")] = ($) =>
      choice(
        classTier($, context, classification, "membership"),
        prec.left(
          PRECEDENCE.logicalAnd,
          seq(
            field(
              "left",
              aliasedClassTier($, context, classification, "logical_and"),
            ),
            $._continued_logical_and_operator,
            requiredAfterOptionalNewline(
              $,
              expressionTargetGuard($, context),
              continuedPresentTierExpression($, context, "right", "membership"),
              continuedTierExpression($, context, "right", "membership"),
            ),
          ),
        ),
      );
  }

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
            $._continued_membership_operator,
            continuedExpression($, "right", $.name),
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
            continuedClassTier($, context, "right", "non_unary", "additive"),
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
      prec.right(
        PRECEDENCE.unary,
        seq(
          field("operator", "+"),
          continuedTierExpression($, context, "operand", "unary"),
        ),
      ),
      prec.right(
        PRECEDENCE.unary,
        seq(
          field("operator", "-"),
          continuedTierExpression($, context, "operand", "unary"),
        ),
      ),
    );
    return alternatives;
  };
  rules[unary("unary")] = ($) => choice(...unaryAlternatives($));
  rules[not] = ($) =>
    prec.right(
      PRECEDENCE.unary,
      seq(
        field("operator", "!"),
        continuedTierExpression($, context, "operand", "unary"),
      ),
    );
  rules[nonUnary("unary")] = ($) =>
    choice(classTier($, context, "non_unary", "exponentiation"), $[not]);

  if (context.input) {
    rules[unary("exponentiation")] = ($) =>
      choice(
        classTier($, context, "unary", "update"),
        prec.right(
          PRECEDENCE.exponentiation,
          seq(
            field("left", aliasedClassTier($, context, "unary", "update")),
            $._continued_exponentiation_operator,
            continuedTierExpression($, context, "right", "unary"),
          ),
        ),
      );
    rules[unary("update")] = ($) => $.unary_input_function;
  }

  rules[nonUnary("exponentiation")] = ($) =>
    choice(
      classTier($, context, "non_unary", "update"),
      prec.right(
        PRECEDENCE.exponentiation,
        seq(
          field("left", aliasedClassTier($, context, "non_unary", "update")),
          $._continued_exponentiation_operator,
          continuedTierExpression($, context, "right", "unary"),
        ),
      ),
    );

  rules[prefixUpdate] = ($) =>
    prec.right(
      PRECEDENCE.prefixUpdate,
      seq(
        field("operator", choice($.incr, $.decr)),
        continuedRequiredExpression($, "operand", $.lvalue),
      ),
    );
  rules[nonUnary("update")] = ($) =>
    choice(
      classTier($, context, "non_unary", "atom"),
      $[prefixUpdate],
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

const requiredListElementWith = ($, element, recovery) =>
  choice(
    continuedMember($, $._lc_before_expression, element),
    seq(repeat($.line_continuation), recovery($)),
  );

const continuedListElementWith = ($, targetGuard, element, recovery) =>
  seq(
    continuedMember($, $._lc_before_comma, ","),
    requiredAfterOptionalNewline(
      $,
      targetGuard,
      continuedMember($, $._lc_before_expression, element),
      requiredListElementWith($, element, recovery),
    ),
  );

const continuedListElement = ($, element) =>
  continuedListElementWith(
    $,
    $._expression_target_guard,
    element,
    expressionRecovery,
  );

const printListExpressionRecovery = ($) =>
  choice(expressionRecovery($), printExpressionRecovery($));

const continuedPrintListElement = ($, element) =>
  continuedListElementWith(
    $,
    $._print_expression_target_guard,
    element,
    printListExpressionRecovery,
  );

module.exports = grammar({
  name: "posix_awk",

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
    $._number_fraction_digits,
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
    $._lc_before_closer_recovery,
    $._lc_before_terminator_recovery,
    $._lc_before_expression,
    $._lc_before_comma,
    $._lc_before_open_bracket,
    $._lc_before_close_parenthesis,
    $._lc_before_close_bracket,
    $._lc_before_action_eof,
    $._expression_recovery,
    $._range_right_expression_recovery,
    $._list_expression_recovery,
    $._print_expression_recovery,
    $._parameter_recovery,
    $._function_body_recovery,
    $._statement_recovery,
    $._terminator_recovery,
    $._closed_item_terminator_recovery,
    $._normal_item_terminator_recovery,
    $._action_empty_semicolon_item_boundary_guard,
    $._action_close_item_boundary_guard,
    $._action_item_boundary_recovery,
    $._string_lone_escape,
    $._string_end_boundary,
    $._ere_compound_open_guard,
    $._ere_dot_close_guard,
    $._ere_equal_close_guard,
    $._ere_colon_close_guard,
    $._ere_group_expression_recovery,
    $._ere_escape_start,
    $._ere_escaped_delimiter_start,
    $._ere_escaped_delimiter_end,
    $._ere_lone_escape,
    $._ere_compound_boundary,
    $._ere_inner_slash_boundary,
    $._ere_inner_end_boundary,
    $._ere_end_boundary,
    $._ere_closing,
    $._close_parenthesis_recovery,
    $._close_bracket_recovery,
    $._action_eof_recovery,
    $._expression_target_guard,
    $._print_expression_target_guard,
    $._action_target_guard,
    $._parameter_target_guard,
    $._error_sentinel,
    $._do_tail_recovery,
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
    [$._boundary_recovered_terminated_statement, $.terminated_statement],
    [
      $._boundary_recovered_terminated_statement_list,
      $.terminated_statement_list,
      $.unterminated_statement_list,
    ],
    [$._normal_pattern_item, $.pattern],
    [$.item_list],
    [$.newline_opt],
    [$.terminator],
    [$.terminated_statement, $.unterminated_statement],
    [$._self_terminating_statement, $.unterminated_statement],
    [$.terminated_statement],
    [$._self_terminating_statement],
    [$._for_in_clause, $.lvalue],
    [
      $._terminated_statement_or_recovery,
      $._unterminated_statement_or_recovery,
    ],
    [$._recovered_do_body, $.while_keyword],
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
    [$.param_list, $._recovered_parameter_tail],
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

    _continued_close_parenthesis: ($) =>
      continuedClosingMember(
        $,
        $._lc_before_close_parenthesis,
        ")",
        $._close_parenthesis_recovery,
      ),

    _continued_close_bracket: ($) =>
      continuedClosingMember(
        $,
        $._lc_before_close_bracket,
        "]",
        $._close_bracket_recovery,
      ),

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
        choice("*", $._division_operator, "%"),
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
      choice(terminatedItem($), recoveredTerminatedItem($)),

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

    _function_item: ($) =>
      choice(
        seq($._function_header, functionBody($)),
        seq(
          $._recovered_function_header,
          choice(
            seq(
              continuedMember($, $._lc_before_close_parenthesis, ")"),
              functionBody($),
            ),
            seq(
              continuedClosingRecovery($, $._close_parenthesis_recovery),
              choice(directFunctionBody($), continuedFunctionBodyRecovery($)),
            ),
          ),
        ),
      ),

    _function_header_prefix: ($) =>
      seq(
        $.function_keyword,
        repeat($.line_continuation),
        field("name", choice($.name, $.func_name)),
        continuedMember($, $._lc_before_expression, "("),
        repeat($.line_continuation),
      ),

    _function_header: ($) =>
      seq(
        $._function_header_prefix,
        optional(field("parameters", $.param_list)),
        $._continued_close_parenthesis,
      ),

    _recovered_function_header: ($) =>
      seq(
        $._function_header_prefix,
        field("parameters", alias($._recovered_param_list, $.param_list)),
      ),

    param_list: ($) => seq($.name, repeat(continuedParameter($))),

    _recovered_param_list: ($) => seq($.name, $._recovered_parameter_tail),

    _recovered_parameter_tail: ($) =>
      seq(
        continuedMember($, $._lc_before_comma, ","),
        choice(
          seq(
            repeat($.line_continuation),
            parameterRecovery($),
            repeat(
              choice(continuedParameter($), continuedParameterRecovery($)),
            ),
          ),
          seq(requiredParameter($), $._recovered_parameter_tail),
        ),
      ),

    pattern: ($) => choice($.normal_pattern, $.special_pattern),

    normal_pattern: ($) =>
      choice(
        $.expr,
        prec.right(
          1,
          seq(
            field("left", choice($.expr, listExpressionRecovery($))),
            continuedMember($, $._lc_before_comma, field("separator", ",")),
            choice(
              requiredAfterOptionalNewline(
                $,
                $._expression_target_guard,
                continuedExpression($, "right", $.expr),
                continuedRequiredExpressionWith(
                  $,
                  "right",
                  $.expr,
                  rangeRightExpressionRecovery,
                ),
              ),
              seq(
                repeat($.line_continuation),
                $._action_target_guard,
                $.newline_opt,
                continuedRequiredExpressionWith(
                  $,
                  "right",
                  $.expr,
                  rangeRightExpressionRecovery,
                ),
              ),
            ),
          ),
        ),
      ),

    special_pattern: ($) => choice($.begin_keyword, $.end_keyword),

    begin_keyword: ($) => prec(10, logicalWord($, $._begin_word)),

    end_keyword: ($) => prec(10, logicalWord($, $._end_word)),

    function_keyword: ($) => prec(10, logicalWord($, $._function_word)),

    _action_opening_layout: ($) => actionOpeningLayout($),

    _action_body: ($) =>
      actionBody(
        $,
        choice($.terminated_statement_list, $.unterminated_statement_list),
      ),

    _boundary_action_body: ($) =>
      actionBody(
        $,
        choice(
          $.unterminated_statement_list,
          alias(
            $._boundary_recovered_terminated_statement_list,
            $.terminated_statement_list,
          ),
        ),
      ),

    _boundary_action_prefix: ($) =>
      seq($._action_opening_layout, optional($._boundary_action_body)),

    _boundary_recovered_terminated_statement: ($) =>
      choice($.action, $._self_terminating_statement),

    _boundary_recovered_terminated_statement_list: ($) =>
      choice(
        alias(
          $._boundary_recovered_terminated_statement,
          $.terminated_statement,
        ),
        withLineContinuations(
          $,
          terminatedStatements($),
          alias(
            $._boundary_recovered_terminated_statement,
            $.terminated_statement,
          ),
        ),
      ),

    _boundary_recovered_action: ($) =>
      seq($._boundary_action_prefix, actionItemBoundaryEnd($)),

    action: ($) =>
      choice(
        seq(
          $._action_opening_layout,
          actionEnd($, $._action_empty_semicolon_item_boundary_guard),
        ),
        seq(
          $._action_opening_layout,
          $._action_body,
          actionEnd($, $._action_close_item_boundary_guard),
        ),
        $._boundary_recovered_action,
      ),

    terminated_statement_list: ($) => terminatedStatements($),

    unterminated_statement_list: ($) =>
      choice(
        $.unterminated_statement,
        withLineContinuations(
          $,
          terminatedStatements($),
          $.unterminated_statement,
        ),
      ),

    _parenthesized_condition: ($) =>
      seq(
        "(",
        continuedRequiredExpression($, "condition", $.expr),
        $._continued_close_parenthesis,
      ),

    _if_header: ($) => conditionalHeader($, $.if_keyword),

    _else_header: ($) => keywordHeader($, $.else_keyword),

    _while_header: ($) => conditionalHeader($, $.while_keyword),

    _do_header: ($) => keywordHeader($, $.do_keyword),

    _recovered_do_body: ($) =>
      prec.dynamic(-1, alias($._while_word, $.statement_recovery)),

    _while_keyword_body: ($) => $._word_spelling,

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
        continuedMember($, $._lc_before_expression, field("array", $.name)),
      ),

    _for_header: ($) =>
      seq(
        $.for_keyword,
        continuedMember($, $._lc_before_expression, "("),
        repeat($.line_continuation),
        choice($._for_classic_clause, $._for_in_clause),
        $._continued_close_parenthesis,
        optionalNewlineLayout($),
      ),

    _terminated_statement_or_recovery: ($) =>
      choice($.terminated_statement, statementRecovery($)),

    _unterminated_statement_or_recovery: ($) =>
      choice($.unterminated_statement, statementRecovery($)),

    _self_terminating_statement: ($) =>
      choice(...controlStatements($, $._terminated_statement_or_recovery)),

    terminated_statement: ($) =>
      choice(
        seq($.action, optionalNewlineLayout($)),
        $._self_terminating_statement,
        seq(field("terminator", ";"), optionalNewlineLayout($)),
        statementTerminatedBy($, $.newline),
        statementTerminatedBy($, ";"),
        seq(
          field("statement", $.terminatable_statement),
          continuedMember(
            $,
            $._lc_before_terminator_recovery,
            field("terminator", terminatorRecovery($)),
          ),
        ),
      ),

    unterminated_statement: ($) =>
      choice(
        field("statement", $.terminatable_statement),
        ...controlStatements($, $._unterminated_statement_or_recovery),
      ),

    terminatable_statement: ($) =>
      choice(
        $.simple_statement,
        $.break_keyword,
        $.continue_keyword,
        $.next_keyword,
        $.nextfile_keyword,
        seq(
          $.exit_keyword,
          optional(continuedMember($, $._lc_before_expression, $.expr)),
        ),
        seq(
          $.return_keyword,
          optional(continuedMember($, $._lc_before_expression, $.expr)),
        ),
        seq(
          $._do_header,
          field("body", $._terminated_statement_or_recovery),
          continuedDoTail($),
        ),
        seq(
          $._do_header,
          field("body", $._recovered_do_body),
          doWhileTail($, alias($._while_keyword_body, $.while_keyword)),
        ),
      ),

    simple_statement: ($) =>
      choice(
        seq(
          $.delete_keyword,
          continuedMember($, $._lc_before_expression, field("array", $.name)),
          optional(
            seq(
              continuedMember($, $._lc_before_open_bracket, "["),
              repeat($.line_continuation),
              field(
                "subscripts",
                choice($.expr_list, alias($._recovered_expr_list, $.expr_list)),
              ),
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
              continuedMember(
                $,
                $._lc_before_expression,
                field("arguments", $.print_expr_list),
              ),
            ),
          ),
        ),
        parenthesizedPrintStatement($, $.print_keyword),
        prec.right(
          seq(
            $.printf_keyword,
            choice(
              continuedMember(
                $,
                $._lc_before_expression,
                field("arguments", $.print_expr_list),
              ),
              field(
                "arguments",
                alias($._recovered_print_expr_list, $.print_expr_list),
              ),
              seq(
                repeat1($.line_continuation),
                field(
                  "arguments",
                  alias($._recovered_print_expr_list, $.print_expr_list),
                ),
              ),
            ),
          ),
        ),
        parenthesizedPrintStatement($, $.printf_keyword),
      ),

    output_redirection: ($) =>
      seq(
        choice(seq($._output_greater_guard, choice(">", $.append)), "|"),
        continuedRequiredMember($, $.expr),
      ),

    print_keyword: ($) => prec(10, logicalWord($, $._print_word)),

    printf_keyword: ($) => prec(10, logicalWord($, $._printf_word)),

    break_keyword: ($) => logicalWord($, $._break_word),

    continue_keyword: ($) => logicalWord($, $._continue_word),

    delete_keyword: ($) => logicalWord($, $._delete_word),

    do_keyword: ($) => logicalWord($, $._do_word),

    else_keyword: ($) => logicalWord($, $._else_word),

    exit_keyword: ($) => logicalWord($, $._exit_word),

    for_keyword: ($) => logicalWord($, $._for_word),

    if_keyword: ($) => logicalWord($, $._if_word),

    next_keyword: ($) => logicalWord($, $._next_word),

    nextfile_keyword: ($) => logicalWord($, $._nextfile_word),

    return_keyword: ($) => logicalWord($, $._return_word),

    while_keyword: ($) => logicalWord($, $._while_word),

    _recovered_print_expr_list: ($) => printListExpressionRecovery($),

    print_expr_list: ($) =>
      prec.left(
        choice(
          seq($.print_expr, repeat(continuedPrintListElement($, $.print_expr))),
          seq(
            listExpressionRecovery($),
            continuedPrintListElement($, $.print_expr),
            repeat(continuedPrintListElement($, $.print_expr)),
          ),
        ),
      ),

    expr_list: ($) => choice($.expr, $.multiple_expr_list),

    multiple_expr_list: ($) =>
      prec.left(
        seq(
          choice($.expr, listExpressionRecovery($)),
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
          $._normal_prefix_update_expr,
        ),
      ),

    _parenthesized_expression: ($) =>
      choice(
        seq(
          "(",
          repeat($.line_continuation),
          $.expr,
          $._continued_close_parenthesis,
        ),
        seq(
          "(",
          repeat($.line_continuation),
          expressionRecovery($),
          $._continued_close_parenthesis,
        ),
      ),

    _user_function_call: ($) => seq($.func_name, callArguments($)),

    _builtin_function_call: ($) =>
      prec.right(PRECEDENCE.field, seq($.builtin_func_name, callArguments($))),

    lvalue: ($) =>
      choice(
        $.name,
        prec.right(
          PRECEDENCE.field,
          choice(
            subscriptedName($, $.expr_list),
            subscriptedName($, alias($._recovered_expr_list, $.expr_list)),
          ),
        ),
        prec(
          PRECEDENCE.field,
          seq(
            field("operator", "$"),
            continuedRequiredExpression(
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
            continuedRequiredExpression($, "source", $.expr),
          ),
        ),
        prec.right(
          PRECEDENCE.field,
          seq(
            field("source", $.non_unary_expr),
            $._continued_input_pipe,
            continuedMember(
              $,
              $._lc_before_expression,
              field("get", $.simple_get),
            ),
          ),
        ),
      ),

    unary_input_function: ($) =>
      prec.right(
        PRECEDENCE.field,
        seq(
          field("source", $.unary_expr),
          $._continued_input_pipe,
          continuedMember(
            $,
            $._lc_before_expression,
            field("get", $.simple_get),
          ),
        ),
      ),

    simple_get: ($) =>
      prec.right(
        PRECEDENCE.field,
        seq(
          $.getline_keyword,
          optional(
            continuedMember(
              $,
              $._lc_before_expression,
              field("target", $.lvalue),
            ),
          ),
        ),
      ),

    _recovered_expr_list: ($) => expressionRecovery($),

    getline_keyword: ($) => logicalWord($, $._getline_word),

    in_keyword: ($) => logicalWord($, $._in_word),

    func_name: ($) => logicalWord($, $._func_name_word),

    builtin_func_name: ($) => logicalWord($, $._builtin_func_name_word),

    name: ($) => logicalWord($, $._name_word),

    number: ($) =>
      choice(
        seq($._number_integer, $._number_digit_chunk),
        seq($._number_fraction, numberFraction($)),
        seq($._number_exponent, numberBase($), numberExponent($)),
      ),

    string: ($) =>
      seq(
        field("opening", '"'),
        repeat(choice($.string_content, $.escape_sequence)),
        choice(field("closing", token.immediate('"')), $.string_end_recovery),
      ),

    string_content: () => token.immediate(prec(1, /[^"\\\n]+/)),

    escape_sequence: ($) =>
      seq(
        $._escape_introducer,
        choice($._escape_character, $._escape_octal_digits),
      ),

    string_end_recovery: ($) =>
      choice(
        $._string_end_boundary,
        seq(
          $._string_lone_escape,
          $._escape_introducer,
          $._string_end_boundary,
        ),
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

    _division_operator: ($) => alias($._division_slash, "/"),

    ere: ($) =>
      seq(
        field("opening", alias($._ere_opening_slash, "/")),
        choice(
          seq(
            field("expression", $.extended_reg_exp),
            field("closing", alias($._ere_closing, "/")),
          ),
          $.ere_end_recovery,
          seq(field("expression", $.extended_reg_exp), $.ere_end_recovery),
        ),
      ),

    ere_end_recovery: ($) =>
      choice(
        $._ere_end_boundary,
        seq($._ere_lone_escape, $._escape_introducer, $._ere_end_boundary),
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
          choice(
            seq(
              field("expression", $.extended_reg_exp),
              ereRecoverableMember(
                $,
                field("closing", $._ere_close_parenthesis),
              ),
            ),
            seq(
              field(
                "expression",
                alias($._ere_group_expression_recovery, $.expression_recovery),
              ),
              choice(
                field("closing", $._ere_close_parenthesis),
                ereRecoveredMember($),
              ),
            ),
          ),
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
        choice(
          seq(
            $.dup_count,
            optional(seq(token.immediate(","), optional($.dup_count))),
            ereRecoverableMember($, $._ere_close_brace),
          ),
          ereRecoveredMember($),
        ),
      ),

    dup_count: ($) => $._number_digit_chunk,

    bracket_expression: ($) =>
      prec(
        2,
        seq(
          token.immediate("["),
          choice(
            seq(
              choice($.matching_list, $.nonmatching_list),
              ereRecoverableMember($, $._ere_close_bracket),
            ),
            ereRecoveredMember($),
          ),
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
      prec(
        3,
        seq(
          $._ere_open_dot,
          choice(
            seq(
              choice(
                alias($._ere_compound_collating_element, $.collating_element),
                $.meta_character,
              ),
              choice($._ere_dot_close, ereCompoundBoundary($)),
            ),
            ereCompoundBoundary($),
          ),
        ),
      ),

    equivalence_class: ($) =>
      prec(
        3,
        seq(
          $._ere_open_equal,
          choice(
            seq(
              alias($._ere_compound_collating_element, $.collating_element),
              choice($._ere_equal_close, ereCompoundBoundary($)),
            ),
            ereCompoundBoundary($),
          ),
        ),
      ),

    character_class: ($) =>
      prec(
        3,
        seq(
          $._ere_open_colon,
          choice(
            seq(
              $.class_name,
              choice($._ere_colon_close, ereCompoundBoundary($)),
            ),
            ereCompoundBoundary($),
          ),
        ),
      ),

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

    _ere_open_dot: ($) =>
      seq(
        $._ere_compound_open_guard,
        token.immediate("["),
        token.immediate("."),
      ),

    _ere_dot_close: ($) =>
      seq($._ere_dot_close_guard, token.immediate("."), token.immediate("]")),

    _ere_open_equal: ($) =>
      seq(
        $._ere_compound_open_guard,
        token.immediate("["),
        token.immediate("="),
      ),

    _ere_equal_close: ($) =>
      seq($._ere_equal_close_guard, token.immediate("="), token.immediate("]")),

    _ere_open_colon: ($) =>
      seq(
        $._ere_compound_open_guard,
        token.immediate("["),
        token.immediate(":"),
      ),

    _ere_colon_close: ($) =>
      seq($._ere_colon_close_guard, token.immediate(":"), token.immediate("]")),

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

    _ere_octal_escape_sequence: ($) => ereEscapeWithOctal($),

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
      choice(
        token.immediate(/\\/),
        token.immediate(/[().*+?{}|^$]/),
        token.immediate(/\[/),
        token.immediate("]"),
      ),

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

    _word_spelling: () => token.immediate(/[A-Za-z_][A-Za-z0-9_]*/),

    _number_digit_chunk: () => token.immediate(/[0-9]+/),

    _number_dot: () => token.immediate(/\./),

    _number_exponent_character: () => token.immediate(/[eE]/),

    _number_sign: () => token.immediate(/[+-]/),

    _escape_introducer: () => token.immediate(/\\/),

    _escape_character: () =>
      choice(token.immediate(/\\/), token.immediate(prec(1, /[^0-7\\\n]/))),

    _escape_octal_digits: () => token.immediate(/[0-7]{1,3}/),
  },
});
