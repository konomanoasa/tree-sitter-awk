/**
 * @author konomanoasa
 * @license MIT
 */

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

const actionOpeningLayout = ($) =>
  seq(
    field("opening", "{"),
    repeat($.line_continuation),
    optional(seq($.newline_opt, repeat($.line_continuation))),
  );

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

const immediateLineContinuations = ($) =>
  repeat1(alias($._immediate_line_continuation, $.line_continuation));

const namedOperator = ($, first, second) =>
  seq(
    first,
    repeat(alias($._immediate_line_continuation, $.line_continuation)),
    second,
  );

const erePhysicalLineContinuations = ($) =>
  repeat1(alias($._ere_line_continuation, $.line_continuation));

const ereLineContinuations = ($) =>
  seq($._ere_run_guard, erePhysicalLineContinuations($));

const ereOwnedLineContinuations = ($, ownerGuard) =>
  seq(ownerGuard, erePhysicalLineContinuations($));

const ereEndLineContinuations = ($) =>
  ereOwnedLineContinuations($, $._ere_end_run_guard);

const ereOctalLineContinuations = ($) =>
  ereOwnedLineContinuations($, $._ere_octal_run_guard);

const ereDigitLineContinuations = ($) =>
  ereOwnedLineContinuations($, $._ere_digit_run_guard);

const ereClassLineContinuations = ($) =>
  ereOwnedLineContinuations($, $._ere_class_run_guard);

const ereBracketCloseLineContinuations = ($) =>
  ereOwnedLineContinuations($, $._ere_bracket_close_run_guard);

const optionalEreExpressionLineContinuations = ($) =>
  optional(ereOwnedLineContinuations($, $._ere_expression_run_guard));

const optionalEreGroupRecoveryLineContinuations = ($) =>
  optional(ereOwnedLineContinuations($, $._ere_group_recovery_run_guard));

const optionalEreEscapeLineContinuations = ($) =>
  optional(ereOwnedLineContinuations($, $._ere_escape_run_guard));

const ereContinuedMember = ($, member) =>
  choice(member, seq(ereLineContinuations($), member));

const ereContinuedOwnedMember = ($, ownerGuard, member) =>
  choice(member, seq(ereOwnedLineContinuations($, ownerGuard), member));

const ereRecoveryBoundary = ($, continuations, boundary) =>
  prec.dynamic(
    -1,
    seq(optional(continuations), alias(boundary, $.ere_inner_recovery)),
  );

const ereInnerSlashBoundary = ($, continuations) =>
  ereRecoveryBoundary($, continuations, $._ere_inner_slash_boundary);

const ereInnerEndBoundary = ($, continuations) =>
  ereRecoveryBoundary($, continuations, $._ere_inner_end_boundary);

const ereRecoveredMemberWith = ($, continuations) =>
  choice(
    ereInnerSlashBoundary($, continuations),
    ereInnerEndBoundary($, continuations),
  );

const ereRecoveredOwnedMember = ($, ownerGuard) =>
  ereRecoveredMemberWith($, ereOwnedLineContinuations($, ownerGuard));

const ereRecoveredMember = ($) =>
  ereRecoveredMemberWith($, ereLineContinuations($));

const ereRecoverableOwnedMember = ($, ownerGuard, member) =>
  choice(
    ereContinuedOwnedMember($, ownerGuard, member),
    ereRecoveredOwnedMember($, ownerGuard),
  );

const ereCompoundBoundary = ($) =>
  ereRecoveryBoundary($, ereLineContinuations($), $._ere_compound_boundary);

const ereRecoverableMember = ($, member) =>
  choice(ereContinuedMember($, member), ereRecoveredMember($));

const ereRecoverableBracketClose = ($, member) =>
  choice(
    member,
    seq(ereBracketCloseLineContinuations($), member),
    ereRecoveredMember($),
  );

const continuedStringFragment = ($, marker, fragment) =>
  choice(fragment, seq(marker, immediateLineContinuations($), fragment));

const continuedOctalChunk = ($, chunk) =>
  seq($._lc_before_octal_digit, immediateLineContinuations($), chunk);

const ereContinuedOctalChunk = ($, chunk) =>
  seq(ereOctalLineContinuations($), chunk);

const octalEscapeBody = ($, continuedChunk) =>
  choice(
    $._escape_octal_chunk_3,
    prec.right(
      seq(
        $._escape_octal_chunk_2,
        optional(continuedChunk($, $._escape_octal_chunk_1)),
      ),
    ),
    prec.right(
      seq(
        $._escape_octal_chunk_1,
        optional(
          choice(
            continuedChunk($, $._escape_octal_chunk_2),
            prec.right(
              seq(
                continuedChunk($, $._escape_octal_chunk_1),
                optional(continuedChunk($, $._escape_octal_chunk_1)),
              ),
            ),
          ),
        ),
      ),
    ),
  );

const ereEscapeWithCharacter = ($, character) =>
  seq(
    $._ere_escape_start,
    $._escape_introducer,
    optionalEreEscapeLineContinuations($),
    character,
  );

const ereEscapeWithOctal = ($) =>
  seq(
    $._ere_escape_start,
    $._escape_introducer,
    optionalEreEscapeLineContinuations($),
    octalEscapeBody($, ereContinuedOctalChunk),
  );

const ereNumberDigits = ($) =>
  seq(
    $._number_digit_chunk,
    repeat(seq(ereDigitLineContinuations($), $._number_digit_chunk)),
  );

const logicalWordBody = ($) =>
  seq(
    $._word_head_chunk,
    repeat(
      seq($._word_continues, immediateLineContinuations($), $._word_tail_chunk),
    ),
  );

const logicalWord = ($, classification) =>
  seq(classification, logicalWordBody($));

const numberDigits = ($) =>
  seq(
    $._number_digit_chunk,
    repeat(
      seq(
        $._lc_before_digit,
        immediateLineContinuations($),
        $._number_digit_chunk,
      ),
    ),
  );

const numberDigitsAfterLineContinuations = ($) =>
  seq($._lc_before_digit, immediateLineContinuations($), numberDigits($));

const continuedNumberDigits = ($) =>
  choice(numberDigits($), numberDigitsAfterLineContinuations($));

const fractionalDigits = ($) =>
  choice(
    seq($._number_fraction_digits, numberDigits($)),
    numberDigitsAfterLineContinuations($),
  );

const continuedNumberCharacter = ($, marker, character) =>
  choice(character, seq(marker, immediateLineContinuations($), character));

const numberFraction = ($) =>
  choice(
    seq(
      numberDigits($),
      continuedNumberCharacter($, $._lc_before_dot, $._number_dot),
      fractionalDigits($),
    ),
    seq(
      numberDigits($),
      continuedNumberCharacter($, $._lc_before_dot, $._number_dot),
    ),
    seq($._number_dot, fractionalDigits($)),
  );

const numberBase = ($) => choice(numberDigits($), numberFraction($));

const numberExponent = ($) =>
  seq(
    continuedNumberCharacter(
      $,
      $._lc_before_exponent,
      $._number_exponent_character,
    ),
    optional(continuedNumberCharacter($, $._lc_before_sign, $._number_sign)),
    continuedNumberDigits($),
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

const terminatedItems = ($) => $._terminated_items;

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
    $._word_continues,
    $._number_integer,
    $._number_fraction,
    $._number_exponent,
    $._number_fraction_digits,
    $._division_slash,
    $._ere_opening_slash,
    $._div_assign_operator_slash,
    $._add_assign_operator_plus,
    $._sub_assign_operator_minus,
    $._mul_assign_operator_star,
    $._mod_assign_operator_percent,
    $._pow_assign_operator_caret,
    $._or_operator_bar,
    $._and_operator_ampersand,
    $._no_match_operator_bang,
    $._eq_operator_equals,
    $._le_operator_less,
    $._ge_operator_greater,
    $._ne_operator_bang,
    $._incr_operator_plus,
    $._decr_operator_minus,
    $._append_operator_greater,
    $._operator_equals,
    $._operator_plus,
    $._operator_minus,
    $._operator_bar,
    $._operator_ampersand,
    $._operator_tilde,
    $._operator_greater,
    $._output_greater_guard,
    $._lc_before_digit,
    $._lc_before_dot,
    $._lc_before_exponent,
    $._lc_before_sign,
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
    $._lc_before_do_while,
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
    $._lc_before_escape_character,
    $._lc_before_octal_digit,
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
    $._ere_line_continuation,
    $._ere_run_guard,
    $._ere_expression_run_guard,
    $._ere_alternation_run_guard,
    $._ere_duplication_run_guard,
    $._ere_modifier_run_guard,
    $._ere_group_close_run_guard,
    $._ere_group_recovery_run_guard,
    $._ere_bracket_close_run_guard,
    $._ere_compound_boundary,
    $._ere_inner_slash_boundary,
    $._ere_inner_end_boundary,
    $._ere_end_run_guard,
    $._ere_escape_run_guard,
    $._ere_octal_run_guard,
    $._ere_digit_run_guard,
    $._ere_class_run_guard,
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
    [$.bracket_list, $.follow_list],
    [$.meta_character, $._ere_compound_atom],
    [$._ere_compound_collating_element, $._ere_compound_atom],
    [$._ere_compound_collating_element],
    [$.single_expression, $.start_range],
    [$.bracket_list, $.collating_element],
    [$.range_expression, $.collating_element],
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
        terminatedItems($),
        withLineContinuations(
          $,
          field("leading", $.newline_opt),
          terminatedItems($),
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
          seq(repeat($.line_continuation), parameterRecovery($)),
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

    _if_header: ($) =>
      seq(
        $.if_keyword,
        continuedMember($, $._lc_before_expression, $._parenthesized_condition),
        repeat($.line_continuation),
        optional(seq($.newline_opt, repeat($.line_continuation))),
      ),

    _else_header: ($) =>
      seq(
        $.else_keyword,
        repeat($.line_continuation),
        optional(seq($.newline_opt, repeat($.line_continuation))),
      ),

    _while_header: ($) =>
      seq(
        $.while_keyword,
        continuedMember($, $._lc_before_expression, $._parenthesized_condition),
        repeat($.line_continuation),
        optional(seq($.newline_opt, repeat($.line_continuation))),
      ),

    _do_header: ($) =>
      seq(
        $.do_keyword,
        repeat($.line_continuation),
        optional(seq($.newline_opt, repeat($.line_continuation))),
      ),

    _recovered_do_body: ($) =>
      prec.dynamic(-1, alias($._while_word, $.statement_recovery)),

    _while_keyword_body: ($) => logicalWordBody($),

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
        repeat($.line_continuation),
        optional(seq($.newline_opt, repeat($.line_continuation))),
      ),

    _terminated_statement_or_recovery: ($) =>
      choice($.terminated_statement, statementRecovery($)),

    _unterminated_statement_or_recovery: ($) =>
      choice($.unterminated_statement, statementRecovery($)),

    _self_terminating_statement: ($) =>
      choice(
        seq(
          $._if_header,
          field("consequence", $._terminated_statement_or_recovery),
        ),
        seq(
          $._if_header,
          field("consequence", $._terminated_statement_or_recovery),
          continuedMember($, $._lc_before_else, $._else_header),
          field("alternative", $._terminated_statement_or_recovery),
        ),
        seq(
          $._while_header,
          field("body", $._terminated_statement_or_recovery),
        ),
        seq($._for_header, field("body", $._terminated_statement_or_recovery)),
      ),

    terminated_statement: ($) =>
      choice(
        seq(
          $.action,
          repeat($.line_continuation),
          optional(seq($.newline_opt, repeat($.line_continuation))),
        ),
        $._self_terminating_statement,
        seq(
          field("terminator", ";"),
          repeat($.line_continuation),
          optional(seq($.newline_opt, repeat($.line_continuation))),
        ),
        withLineContinuations(
          $,
          field("statement", $.terminatable_statement),
          field("terminator", $.newline),
        ),
        withLineContinuations(
          $,
          field("statement", $.terminatable_statement),
          field("terminator", $.newline),
          $.newline_opt,
        ),
        withLineContinuations(
          $,
          field("statement", $.terminatable_statement),
          field("terminator", ";"),
        ),
        withLineContinuations(
          $,
          field("statement", $.terminatable_statement),
          field("terminator", ";"),
          $.newline_opt,
        ),
        seq(
          field("statement", $.terminatable_statement),
          choice(
            field("terminator", terminatorRecovery($)),
            seq(
              $._lc_before_terminator_recovery,
              repeat1($.line_continuation),
              field("terminator", terminatorRecovery($)),
            ),
          ),
        ),
      ),

    unterminated_statement: ($) =>
      choice(
        field("statement", $.terminatable_statement),
        seq(
          $._if_header,
          field("consequence", $._unterminated_statement_or_recovery),
        ),
        seq(
          $._if_header,
          field("consequence", $._terminated_statement_or_recovery),
          continuedMember($, $._lc_before_else, $._else_header),
          field("alternative", $._unterminated_statement_or_recovery),
        ),
        seq(
          $._while_header,
          field("body", $._unterminated_statement_or_recovery),
        ),
        seq(
          $._for_header,
          field("body", $._unterminated_statement_or_recovery),
        ),
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
          continuedMember($, $._lc_before_do_while, $.while_keyword),
          continuedMember(
            $,
            $._lc_before_expression,
            $._parenthesized_condition,
          ),
        ),
        seq(
          $._do_header,
          field("body", $._recovered_do_body),
          alias($._while_keyword_body, $.while_keyword),
          continuedMember(
            $,
            $._lc_before_expression,
            $._parenthesized_condition,
          ),
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
        seq(
          $.print_keyword,
          continuedMember($, $._lc_before_expression, "("),
          repeat($.line_continuation),
          field("arguments", $.multiple_expr_list),
          $._continued_close_parenthesis,
        ),
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
        seq(
          $.printf_keyword,
          continuedMember($, $._lc_before_expression, "("),
          repeat($.line_continuation),
          field("arguments", $.multiple_expr_list),
          $._continued_close_parenthesis,
        ),
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

    _recovered_print_expr_list: ($) =>
      choice(expressionRecovery($), printExpressionRecovery($)),

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

    _user_function_call: ($) =>
      seq(
        $.func_name,
        continuedMember($, $._lc_before_expression, "("),
        choice(
          $._continued_close_parenthesis,
          seq(
            repeat($.line_continuation),
            $.expr_list,
            $._continued_close_parenthesis,
          ),
        ),
      ),

    _builtin_function_call: ($) =>
      prec.right(
        PRECEDENCE.field,
        seq(
          $.builtin_func_name,
          continuedMember($, $._lc_before_expression, "("),
          choice(
            $._continued_close_parenthesis,
            seq(
              repeat($.line_continuation),
              $.expr_list,
              $._continued_close_parenthesis,
            ),
          ),
        ),
      ),

    lvalue: ($) =>
      choice(
        $.name,
        prec.right(
          PRECEDENCE.field,
          choice(
            seq(
              $.name,
              continuedMember($, $._lc_before_open_bracket, "["),
              repeat($.line_continuation),
              $.expr_list,
              $._continued_close_bracket,
            ),
            seq(
              $.name,
              continuedMember($, $._lc_before_open_bracket, "["),
              repeat($.line_continuation),
              alias($._recovered_expr_list, $.expr_list),
              $._continued_close_bracket,
            ),
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
        seq($._number_integer, numberDigits($)),
        seq($._number_fraction, numberFraction($)),
        seq($._number_exponent, numberBase($), numberExponent($)),
      ),

    string: ($) =>
      seq(
        field("opening", '"'),
        repeat(
          choice(
            $.string_content,
            $.escape_sequence,
            alias($._immediate_line_continuation, $.line_continuation),
          ),
        ),
        choice(field("closing", token.immediate('"')), $.string_end_recovery),
      ),

    string_content: () => token.immediate(prec(1, /[^"\\\n]+/)),

    escape_sequence: ($) =>
      prec.right(
        1,
        seq(
          $._escape_introducer,
          choice(
            continuedStringFragment(
              $,
              $._lc_before_escape_character,
              $._escape_character,
            ),
            octalEscapeBody($, continuedOctalChunk),
            seq(
              $._lc_before_octal_digit,
              immediateLineContinuations($),
              octalEscapeBody($, continuedOctalChunk),
            ),
          ),
        ),
      ),

    string_end_recovery: ($) =>
      choice(
        $._string_end_boundary,
        seq(
          $._string_lone_escape,
          $._escape_introducer,
          repeat(alias($._immediate_line_continuation, $.line_continuation)),
          $._string_end_boundary,
        ),
      ),

    add_assign: ($) =>
      namedOperator($, $._add_assign_operator_plus, $._operator_equals),

    sub_assign: ($) =>
      namedOperator($, $._sub_assign_operator_minus, $._operator_equals),

    mul_assign: ($) =>
      namedOperator($, $._mul_assign_operator_star, $._operator_equals),

    div_assign: ($) =>
      namedOperator($, $._div_assign_operator_slash, $._operator_equals),

    mod_assign: ($) =>
      namedOperator($, $._mod_assign_operator_percent, $._operator_equals),

    pow_assign: ($) =>
      namedOperator($, $._pow_assign_operator_caret, $._operator_equals),

    or: ($) => namedOperator($, $._or_operator_bar, $._operator_bar),

    and: ($) =>
      namedOperator($, $._and_operator_ampersand, $._operator_ampersand),

    no_match: ($) =>
      namedOperator($, $._no_match_operator_bang, $._operator_tilde),

    eq: ($) => namedOperator($, $._eq_operator_equals, $._operator_equals),

    le: ($) => namedOperator($, $._le_operator_less, $._operator_equals),

    ge: ($) => namedOperator($, $._ge_operator_greater, $._operator_equals),

    ne: ($) => namedOperator($, $._ne_operator_bang, $._operator_equals),

    incr: ($) => namedOperator($, $._incr_operator_plus, $._operator_plus),

    decr: ($) => namedOperator($, $._decr_operator_minus, $._operator_minus),

    append: ($) =>
      namedOperator($, $._append_operator_greater, $._operator_greater),

    _division_operator: ($) => alias($._division_slash, "/"),

    ere: ($) =>
      seq(
        field("opening", alias($._ere_opening_slash, "/")),
        choice(
          seq(
            optionalEreExpressionLineContinuations($),
            field("expression", $.extended_reg_exp),
            choice(
              field("closing", alias($._ere_closing, "/")),
              seq(
                ereEndLineContinuations($),
                field("closing", alias($._ere_closing, "/")),
              ),
            ),
          ),
          seq(optionalEreExpressionLineContinuations($), $.ere_end_recovery),
          seq(
            optionalEreExpressionLineContinuations($),
            field("expression", $.extended_reg_exp),
            choice(
              $.ere_end_recovery,
              seq(ereEndLineContinuations($), $.ere_end_recovery),
            ),
          ),
        ),
      ),

    ere_end_recovery: ($) =>
      choice(
        $._ere_end_boundary,
        seq(
          $._ere_lone_escape,
          $._escape_introducer,
          optionalEreEscapeLineContinuations($),
          $._ere_end_boundary,
        ),
      ),

    extended_reg_exp: ($) =>
      choice(
        $.ere_branch,
        prec.left(
          1,
          seq(
            field("left", $.extended_reg_exp),
            ereContinuedOwnedMember(
              $,
              $._ere_alternation_run_guard,
              field("operator", token.immediate("|")),
            ),
            ereContinuedOwnedMember(
              $,
              $._ere_expression_run_guard,
              field("right", $.ere_branch),
            ),
          ),
        ),
      ),

    ere_branch: ($) =>
      choice(
        $.ere_expression,
        prec.left(
          seq(
            field("left", $.ere_branch),
            ereContinuedOwnedMember(
              $,
              $._ere_expression_run_guard,
              field("right", $.ere_expression),
            ),
          ),
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
              ereContinuedOwnedMember(
                $,
                $._ere_expression_run_guard,
                field("expression", $.extended_reg_exp),
              ),
              ereRecoverableOwnedMember(
                $,
                $._ere_group_close_run_guard,
                field("closing", $._ere_close_parenthesis),
              ),
            ),
            seq(
              optionalEreGroupRecoveryLineContinuations($),
              field(
                "expression",
                alias($._ere_group_expression_recovery, $.expression_recovery),
              ),
              choice(
                field("closing", $._ere_close_parenthesis),
                ereRecoveredOwnedMember($, $._ere_group_close_run_guard),
              ),
            ),
          ),
        ),
        prec.left(
          2,
          seq(
            field("operand", $.ere_expression),
            ereContinuedOwnedMember(
              $,
              $._ere_duplication_run_guard,
              field("operator", $.ere_dupl_symbol),
            ),
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
          optional(
            ereContinuedOwnedMember(
              $,
              $._ere_modifier_run_guard,
              field("modifier", $.repetition_modifier),
            ),
          ),
        ),
      ),

    repetition_modifier: () => token.immediate("?"),

    _ere_interval: ($) =>
      seq(
        token.immediate("{"),
        choice(
          seq(
            ereContinuedMember($, $.dup_count),
            optional(
              seq(
                ereContinuedMember($, token.immediate(",")),
                optional(ereContinuedMember($, $.dup_count)),
              ),
            ),
            ereRecoverableMember($, $._ere_close_brace),
          ),
          ereRecoveredMember($),
        ),
      ),

    dup_count: ($) => ereNumberDigits($),

    bracket_expression: ($) =>
      prec(
        2,
        seq(
          token.immediate("["),
          choice(
            seq(
              ereContinuedMember(
                $,
                choice($.matching_list, $.nonmatching_list),
              ),
              ereRecoverableBracketClose($, $._ere_close_bracket),
            ),
            ereRecoveredMember($),
          ),
        ),
      ),

    matching_list: ($) => $.bracket_list,

    nonmatching_list: ($) =>
      seq(token.immediate(prec(3, "^")), ereContinuedMember($, $.bracket_list)),

    bracket_list: ($) =>
      choice(
        $.follow_list,
        prec.dynamic(
          2,
          seq($.follow_list, ereContinuedMember($, $._ere_bracket_hyphen)),
        ),
      ),

    follow_list: ($) =>
      choice(
        $.expression_term,
        prec.left(seq($.follow_list, ereContinuedMember($, $.expression_term))),
      ),

    expression_term: ($) => choice($.single_expression, $.range_expression),

    single_expression: ($) =>
      choice($.end_range, $.character_class, $.equivalence_class),

    range_expression: ($) =>
      prec.dynamic(
        3,
        choice(
          seq($.start_range, ereContinuedMember($, $.end_range)),
          seq($.start_range, ereContinuedMember($, $._ere_bracket_hyphen)),
        ),
      ),

    start_range: ($) =>
      seq($.end_range, ereContinuedMember($, $._ere_bracket_hyphen)),

    end_range: ($) => choice($.collating_element, $.collating_symbol),

    collating_element: ($) =>
      choice(
        $._ere_bracket_character,
        $._ere_bracket_open_character,
        $._ere_bracket_close_character,
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
              ereContinuedMember(
                $,
                choice(
                  alias($._ere_compound_collating_element, $.collating_element),
                  $.meta_character,
                ),
              ),
              choice(
                ereContinuedMember($, $._ere_dot_close),
                ereCompoundBoundary($),
              ),
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
              ereContinuedMember(
                $,
                alias($._ere_compound_collating_element, $.collating_element),
              ),
              choice(
                ereContinuedMember($, $._ere_equal_close),
                ereCompoundBoundary($),
              ),
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
              ereContinuedMember($, $.class_name),
              choice(
                ereContinuedMember($, $._ere_colon_close),
                ereCompoundBoundary($),
              ),
            ),
            ereCompoundBoundary($),
          ),
        ),
      ),

    class_name: ($) =>
      seq(
        $._ere_class_name_head_chunk,
        repeat(seq(ereClassLineContinuations($), $._ere_class_name_tail_chunk)),
      ),

    meta_character: ($) => $._ere_compound_meta_character,

    _ere_compound_collating_element: ($) =>
      choice(
        $._ere_compound_nonmeta_atom,
        seq(
          $._ere_compound_atom,
          ereContinuedMember($, $._ere_compound_atom),
          repeat(ereContinuedMember($, $._ere_compound_atom)),
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
        ereContinuedMember($, token.immediate(".")),
      ),

    _ere_dot_close: ($) =>
      seq(
        $._ere_dot_close_guard,
        token.immediate("."),
        ereContinuedMember($, token.immediate("]")),
      ),

    _ere_open_equal: ($) =>
      seq(
        $._ere_compound_open_guard,
        token.immediate("["),
        ereContinuedMember($, token.immediate("=")),
      ),

    _ere_equal_close: ($) =>
      seq(
        $._ere_equal_close_guard,
        token.immediate("="),
        ereContinuedMember($, token.immediate("]")),
      ),

    _ere_open_colon: ($) =>
      seq(
        $._ere_compound_open_guard,
        token.immediate("["),
        ereContinuedMember($, token.immediate(":")),
      ),

    _ere_colon_close: ($) =>
      seq(
        $._ere_colon_close_guard,
        token.immediate(":"),
        ereContinuedMember($, token.immediate("]")),
      ),

    escaped_delimiter: ($) =>
      seq(
        $._ere_escaped_delimiter_start,
        $._escape_introducer,
        optionalEreEscapeLineContinuations($),
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

    _ere_class_name_head_chunk: () => token.immediate(/[A-Za-z][A-Za-z0-9]*/),

    _ere_class_name_tail_chunk: () => token.immediate(/[A-Za-z0-9]+/),

    _ere_named_escape_character: () => token.immediate(/[abfnrtv]/),

    _ere_quoted_escape_character: () =>
      choice(
        token.immediate(/\\/),
        token.immediate(/[.(*+?{|^$]/),
        token.immediate(/\[/),
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

    _immediate_line_continuation: () => token.immediate(seq("\\", "\n")),

    _word_head_chunk: () => token.immediate(/[A-Za-z_][A-Za-z0-9_]*/),

    _word_tail_chunk: () => token.immediate(/[A-Za-z0-9_]+/),

    _number_digit_chunk: () => token.immediate(/[0-9]+/),

    _number_dot: () => token.immediate(/\./),

    _number_exponent_character: () => token.immediate(/[eE]/),

    _number_sign: () => token.immediate(/[+-]/),

    _escape_introducer: () => token.immediate(/\\/),

    _escape_character: () =>
      choice(token.immediate(/\\/), token.immediate(prec(1, /[^0-7\\\n]/))),

    _escape_octal_chunk_1: () => token.immediate(/[0-7]/),

    _escape_octal_chunk_2: () => token.immediate(/[0-7]{2}/),

    _escape_octal_chunk_3: () => token.immediate(/[0-7]{3}/),
  },
});
