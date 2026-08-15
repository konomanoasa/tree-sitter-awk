#include <stdio.h>

// Keep serialization state private while exercising it in the same translation
// unit.
#include "../src/scanner.c"

typedef struct {
  TSLexer lexer;
  const char *source;
  size_t offset;
  size_t token_end;
  size_t advance_count;
} MockLexer;

static MockLexer *mock_lexer(TSLexer *lexer) {
  return (MockLexer *)lexer;
}

static const MockLexer *const_mock_lexer(const TSLexer *lexer) {
  return (const MockLexer *)lexer;
}

static void mock_advance(TSLexer *lexer, bool skip) {
  MockLexer *mock = mock_lexer(lexer);
  (void)skip;
  mock->advance_count++;
  if (mock->source[mock->offset] != '\0') {
    mock->offset++;
  }
  lexer->lookahead = (unsigned char)mock->source[mock->offset];
}

static void mock_mark_end(TSLexer *lexer) {
  MockLexer *mock = mock_lexer(lexer);
  mock->token_end = mock->offset;
}

static bool mock_eof(const TSLexer *lexer) {
  const MockLexer *mock = const_mock_lexer(lexer);
  return mock->source[mock->offset] == '\0';
}

static MockLexer make_mock_lexer(const char *source) {
  return (MockLexer){
    .lexer =
      {
        .lookahead = (unsigned char)source[0],
        .advance = mock_advance,
        .mark_end = mock_mark_end,
        .eof = mock_eof,
      },
    .source = source,
  };
}

static int check_line_continuation_run(
  const char *test_name,
  size_t continuation_count,
  char target
) {
  char *source = malloc((continuation_count * 2U) + 2U);
  if (source == NULL) {
    fprintf(stderr, "%s: allocation failed\n", test_name);
    return 1;
  }
  for (size_t i = 0; i < continuation_count; i++) {
    source[i * 2U] = '\\';
    source[(i * 2U) + 1U] = '\n';
  }
  source[continuation_count * 2U] = target;
  source[(continuation_count * 2U) + 1U] = '\0';

  MockLexer mock = make_mock_lexer(source);
  ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
  bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
  valid_symbols[LC_BEFORE_EXPRESSION] = true;

  int failed = 0;
  const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
    &state,
    &mock.lexer,
    valid_symbols
  );
  if (
    !scanned ||
    mock.lexer.result_symbol !=
    LC_BEFORE_EXPRESSION ||
    mock.token_end !=
    0 ||
    mock.advance_count >
    continuation_count *
    4U
  ) {
    fprintf(
      stderr,
      "%s: scanned=%u symbol=%u advances=%zu end=%zu\n",
      test_name,
      scanned,
      mock.lexer.result_symbol,
      mock.advance_count,
      mock.token_end
    );
    failed = 1;
  }

  free(source);
  return failed;
}

static int check_line_continuation_lookahead(void) {
  return check_line_continuation_run("linear lookahead", 32768, 'a');
}

static int check_required_target_leading_dot_number(void) {
  static const struct {
    const char *name;
    const char *source;
    enum TokenType guard;
    bool recovery_valid;
    enum TokenType expected;
  } cases[] = {
    {"direct leading-dot number",
      "\n.5",
      EXPRESSION_TARGET_GUARD,
      false,
      EXPRESSION_TARGET_GUARD},
    {"direct leading-dot print number",
      "\n.5",
      PRINT_EXPRESSION_TARGET_GUARD,
      false,
      PRINT_EXPRESSION_TARGET_GUARD},
    {"dot without a digit",
      "\n.",
      EXPRESSION_TARGET_GUARD,
      true,
      EXPRESSION_RECOVERY},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    MockLexer mock = make_mock_lexer(cases[i].source);
    ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[cases[i].guard] = true;
    valid_symbols[EXPRESSION_RECOVERY] = cases[i].recovery_valid;

    const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
      &state,
      &mock.lexer,
      valid_symbols
    );
    if (
      !scanned ||
      mock.lexer.result_symbol !=
      cases[i].expected ||
      mock.token_end != 0
    ) {
      fprintf(
        stderr,
        "%s: scanned=%u symbol=%u end=%zu\n",
        cases[i].name,
        scanned,
        mock.lexer.result_symbol,
        mock.token_end
      );
      failed = 1;
    }
  }
  return failed;
}

static int check_required_target_invalid_layout_recovery(void) {
  static const struct {
    const char *name;
    enum TokenType guard;
    bool parameter_recovery;
    bool function_body_recovery;
    bool expression_recovery;
    enum TokenType expected;
  } cases[] = {
    {"invalid parameter layout",
      PARAMETER_TARGET_GUARD,
      true,
      true,
      true,
      PARAMETER_RECOVERY},
    {"invalid function-body layout",
      ACTION_TARGET_GUARD,
      false,
      true,
      true,
      FUNCTION_BODY_RECOVERY},
    {"invalid expression layout",
      EXPRESSION_TARGET_GUARD,
      false,
      false,
      true,
      EXPRESSION_RECOVERY},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    MockLexer mock = make_mock_lexer("\n\\q\nEND");
    ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[cases[i].guard] = true;
    valid_symbols[PARAMETER_RECOVERY] = cases[i].parameter_recovery;
    valid_symbols[FUNCTION_BODY_RECOVERY] = cases[i].function_body_recovery;
    valid_symbols[EXPRESSION_RECOVERY] = cases[i].expression_recovery;

    const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
      &state,
      &mock.lexer,
      valid_symbols
    );
    if (
      !scanned ||
      mock.lexer.result_symbol !=
      cases[i].expected ||
      mock.token_end != 0
    ) {
      fprintf(
        stderr,
        "%s: scanned=%u symbol=%u end=%zu\n",
        cases[i].name,
        scanned,
        mock.lexer.result_symbol,
        mock.token_end
      );
      failed = 1;
    }
  }
  return failed;
}

static int check_parameter_recovery_boundaries(void) {
  static const struct {
    const char *source;
    bool scanned;
    enum TokenType expected;
  } cases[] = {
    {"name", true, NAME_WORD},
    {")", true, PARAMETER_RECOVERY},
    {"\n", true, PARAMETER_RECOVERY},
    {"", true, PARAMETER_RECOVERY},
    {"{", true, PARAMETER_RECOVERY},
    {"}", true, PARAMETER_RECOVERY},
    {";", true, PARAMETER_RECOVERY},
    {"BEGIN", true, PARAMETER_RECOVERY},
    {"END", true, PARAMETER_RECOVERY},
    {"function", true, PARAMETER_RECOVERY},
    {"42", false, ERROR_SENTINEL},
    {".5", false, ERROR_SENTINEL},
    {"\"", false, ERROR_SENTINEL},
    {"/", false, ERROR_SENTINEL},
    {"$", false, ERROR_SENTINEL},
    {"+", false, ERROR_SENTINEL},
    {"!", false, ERROR_SENTINEL},
    {"print", false, ERROR_SENTINEL},
    {"in", false, ERROR_SENTINEL},
    {"else", false, ERROR_SENTINEL},
    {"length", false, ERROR_SENTINEL},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    MockLexer mock = make_mock_lexer(cases[i].source);
    ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[PARAMETER_RECOVERY] = true;
    valid_symbols[NAME_WORD] = true;

    const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
      &state,
      &mock.lexer,
      valid_symbols
    );
    if (
      scanned !=
      cases[i].scanned ||
      (scanned && mock.lexer.result_symbol != cases[i].expected)
    ) {
      fprintf(
        stderr,
        "parameter boundary %zu: scanned=%u symbol=%u\n",
        i,
        scanned,
        mock.lexer.result_symbol
      );
      failed = 1;
    }
  }
  return failed;
}

static int check_function_body_recovery_boundaries(void) {
  static const struct {
    const char *source;
    bool recovered;
  } cases[] = {
    {"42", true},
    {".5", true},
    {".", false},
    {")", false},
    {"]", false},
    {",", false},
    {":", false},
    {";", true},
    {"}", true},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    MockLexer mock = make_mock_lexer(cases[i].source);
    ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[FUNCTION_BODY_RECOVERY] = true;

    const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
      &state,
      &mock.lexer,
      valid_symbols
    );
    if (
      scanned !=
      cases[i].recovered ||
      (scanned && mock.lexer.result_symbol != FUNCTION_BODY_RECOVERY)
    ) {
      fprintf(
        stderr,
        "function-body boundary %zu: scanned=%u symbol=%u\n",
        i,
        scanned,
        mock.lexer.result_symbol
      );
      failed = 1;
    }
  }
  return failed;
}

static int expect_scan_result(
  const char *test_name,
  const char *source,
  const bool *valid_symbols,
  bool expected_scanned,
  enum TokenType expected_symbol,
  size_t expected_token_end
) {
  MockLexer mock = make_mock_lexer(source);
  ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
  const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
    &state,
    &mock.lexer,
    valid_symbols
  );
  if (
    scanned ==
    expected_scanned &&
    (!scanned ||
      (mock.lexer.result_symbol ==
        expected_symbol &&
        mock.token_end == expected_token_end))
  ) {
    return 0;
  }

  fprintf(
    stderr,
    "%s: scanned=%u symbol=%u end=%zu\n",
    test_name,
    scanned,
    mock.lexer.result_symbol,
    mock.token_end
  );
  return 1;
}

static int check_statement_recovery_boundaries(void) {
  static const struct {
    const char *name;
    const char *source;
    bool recovered;
  } cases[] = {
    {"BEGIN item boundary", "BEGIN", true},
    {"END item boundary", "END", true},
    {"function item boundary", "function", true},
    {"else boundary", "else", true},
    {"print statement", "print", false},
    {"while statement", "while", false},
    {"name statement", "name", false},
    {"getline statement", "getline", false},
    {"builtin statement", "length", false},
    {"membership operator", "in", false},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[STATEMENT_RECOVERY] = true;
    failed |= expect_scan_result(
      cases[i].name,
      cases[i].source,
      valid_symbols,
      cases[i].recovered,
      STATEMENT_RECOVERY,
      0
    );
  }
  return failed;
}

static int check_do_tail_word_boundaries(void) {
  static const struct {
    const char *name;
    const char *source;
    enum TokenType expected;
    size_t expected_token_end;
  } cases[] = {
    {"BEGIN after do body", "BEGIN", DO_TAIL_RECOVERY, 0},
    {"END after do body", "END", DO_TAIL_RECOVERY, 0},
    {"function after do body", "function", DO_TAIL_RECOVERY, 0},
    {"else after do body", "else", DO_TAIL_RECOVERY, 0},
    {"print after do body", "print", DO_TAIL_RECOVERY, 0},
    {"if after do body", "if", DO_TAIL_RECOVERY, 0},
    {"name after do body", "name", DO_TAIL_RECOVERY, 0},
    {"getline after do body", "getline", DO_TAIL_RECOVERY, 0},
    {"builtin after do body", "length", DO_TAIL_RECOVERY, 0},
    {"function call after do body", "follow(", DO_TAIL_RECOVERY, 0},
    {"real do tail", "while", WHILE_WORD, 5},
    {"membership operator", "in", IN_WORD, 2},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[WHILE_WORD] = true;
    valid_symbols[IN_WORD] = true;
    valid_symbols[DO_TAIL_RECOVERY] = true;
    failed |= expect_scan_result(
      cases[i].name,
      cases[i].source,
      valid_symbols,
      true,
      cases[i].expected,
      cases[i].expected_token_end
    );
  }
  return failed;
}

static int check_word_recovery_prefers_valid_word(void) {
  static const struct {
    const char *name;
    enum TokenType recovery;
  } cases[] = {
    {"else beats do-tail recovery", DO_TAIL_RECOVERY},
    {"else beats statement recovery", STATEMENT_RECOVERY},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[ELSE_WORD] = true;
    valid_symbols[cases[i].recovery] = true;
    failed |= expect_scan_result(
      cases[i].name,
      "else",
      valid_symbols,
      true,
      ELSE_WORD,
      4
    );
  }
  return failed;
}

static int check_greater_dispatch(void) {
  static const struct {
    const char *name;
    const char *source;
    bool guard_valid;
    bool ge_valid;
    bool append_valid;
    bool scanned;
    enum TokenType expected;
    size_t expected_token_end;
  } cases[] = {
    {"plain redirection beside GE branch",
      ">f",
      true,
      true,
      false,
      true,
      OUTPUT_GREATER_GUARD,
      0},
    {"append redirection beside GE branch",
      ">>f",
      true,
      true,
      false,
      true,
      OUTPUT_GREATER_GUARD,
      0},
    {"GE beside redirection guard",
      ">=1",
      true,
      true,
      false,
      true,
      GE_OPERATOR,
      2},
    {"GE without comparison context",
      ">=1",
      true,
      false,
      false,
      false,
      GE_OPERATOR,
      0},
    {"append after the guard",
      ">>f",
      false,
      false,
      true,
      true,
      APPEND_OPERATOR,
      2},
    {"plain comparison stays internal",
      ">x",
      false,
      true,
      false,
      false,
      GE_OPERATOR,
      0},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[OUTPUT_GREATER_GUARD] = cases[i].guard_valid;
    valid_symbols[GE_OPERATOR] = cases[i].ge_valid;
    valid_symbols[APPEND_OPERATOR] = cases[i].append_valid;
    failed |= expect_scan_result(
      cases[i].name,
      cases[i].source,
      valid_symbols,
      cases[i].scanned,
      cases[i].expected,
      cases[i].expected_token_end
    );
  }
  return failed;
}

static int check_do_tail_character_boundaries(void) {
  static const struct {
    const char *name;
    const char *source;
    bool recovered;
  } cases[] = {
    {"block statement", "{", true},
    {"string expression", "\"", true},
    {"group expression", "(", true},
    {"field expression", "$", true},
    {"positive expression", "+", true},
    {"negative expression", "-", true},
    {"ERE expression", "/", true},
    {"negated expression", "!", true},
    {"integer expression", "42", true},
    {"fraction expression", ".5", true},
    {"semicolon terminator", ";", true},
    {"action closer", "}", true},
    {"physical EOF", "", true},
    {"raw newline", "\n", false},
    {"lone dot", ".", false},
    {"close parenthesis", ")", false},
    {"close bracket", "]", false},
    {"comma", ",", false},
    {"colon", ":", false},
    {"multiplication operator", "*", false},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[DO_TAIL_RECOVERY] = true;
    failed |= expect_scan_result(
      cases[i].name,
      cases[i].source,
      valid_symbols,
      cases[i].recovered,
      DO_TAIL_RECOVERY,
      0
    );
  }
  return failed;
}

static int check_required_recovery_priority(void) {
  static const struct {
    const char *name;
    bool statement_recovery;
    bool do_tail_recovery;
    enum TokenType expected;
  } cases[] = {
    {"statement before do tail", true, true, STATEMENT_RECOVERY},
    {"do tail before action boundary", false, true, DO_TAIL_RECOVERY},
    {"action boundary fallback", false, false, ACTION_ITEM_BOUNDARY_RECOVERY},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[STATEMENT_RECOVERY] = cases[i].statement_recovery;
    valid_symbols[DO_TAIL_RECOVERY] = cases[i].do_tail_recovery;
    valid_symbols[ACTION_ITEM_BOUNDARY_RECOVERY] = true;
    failed |= expect_scan_result(
      cases[i].name,
      "END",
      valid_symbols,
      true,
      cases[i].expected,
      0
    );
  }

  bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
  valid_symbols[LC_BEFORE_DO_TAIL] = true;
  valid_symbols[DO_TAIL_RECOVERY] = true;
  failed |= expect_scan_result(
    "continued do tail boundary",
    "\\\nEND",
    valid_symbols,
    true,
    LC_BEFORE_DO_TAIL,
    0
  );
  return failed;
}

static int check_source_token_ranges(void) {
  static const struct {
    const char *name;
    const char *source;
    enum TokenType token;
    size_t expected_token_end;
  } cases[] = {
    {"keyword spelling", "END", END_WORD, 3},
    {"name spelling", "value", NAME_WORD, 5},
    {"function name excludes parenthesis", "follow(", FUNC_NAME_WORD, 6},
    {"continued function name excludes continuation",
      "follow\\\n(",
      FUNC_NAME_WORD,
      6},
    {"integer spelling", "123", NUMBER_INTEGER, 3},
    {"fraction spelling", ".5", NUMBER_FRACTION, 2},
    {"exponent spelling", "1.5e+2", NUMBER_EXPONENT, 6},
    {"incomplete exponent keeps integer", "1e+", NUMBER_INTEGER, 1},
    {"integer prefix remains available", "1.2", NUMBER_INTEGER, 1},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
    valid_symbols[cases[i].token] = true;
    failed |= expect_scan_result(
      cases[i].name,
      cases[i].source,
      valid_symbols,
      true,
      cases[i].token,
      cases[i].expected_token_end
    );
  }
  return failed;
}

static int check_do_body_recovery_guard_range(void) {
  bool valid_symbols[TOKEN_TYPE_COUNT] = {false};
  valid_symbols[DO_BODY_RECOVERY_GUARD] = true;
  return expect_scan_result(
    "do body recovery guard",
    "while",
    valid_symbols,
    true,
    DO_BODY_RECOVERY_GUARD,
    0
  );
}

static int
expect_mode(const char *test_name, EreMode expected, EreMode actual) {
  if (actual == expected) {
    return 0;
  }

  fprintf(
    stderr,
    "%s: expected mode %u, received %u\n",
    test_name,
    (unsigned)expected,
    (unsigned)actual
  );
  return 1;
}

static int
expect_length(const char *test_name, unsigned expected, unsigned actual) {
  if (actual == expected) {
    return 0;
  }

  fprintf(
    stderr,
    "%s: expected serialized length %u, received %u\n",
    test_name,
    expected,
    actual
  );
  return 1;
}

static int check_round_trip(
  const char *test_name,
  EreMode mode,
  unsigned expected_length
) {
  ScannerState source = {.ere_mode = mode};
  ScannerState destination = {.ere_mode = ERE_MODE_ESCAPED_DELIMITER};
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE] = {0};
  const unsigned length =
    tree_sitter_posix_awk_external_scanner_serialize(&source, buffer);

  int failed = expect_length(test_name, expected_length, length);
  tree_sitter_posix_awk_external_scanner_deserialize(
    &destination,
    buffer,
    length
  );
  failed |= expect_mode(test_name, mode, destination.ere_mode);
  return failed;
}

int main(void) {
  int failed = 0;
  failed |= check_round_trip("outside mode round trip", ERE_MODE_OUTSIDE, 0);
  failed |= check_round_trip(
    "ERE body mode round trip",
    ERE_MODE_BODY,
    SERIALIZED_SCANNER_STATE_SIZE
  );
  failed |= check_round_trip(
    "escaped delimiter mode round trip",
    ERE_MODE_ESCAPED_DELIMITER,
    SERIALIZED_SCANNER_STATE_SIZE
  );

  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE] = {
    (char)ERE_MODE_BODY,
    0,
  };
  ScannerState destination = {.ere_mode = ERE_MODE_BODY};
  tree_sitter_posix_awk_external_scanner_deserialize(&destination, buffer, 0);
  failed |= expect_mode(
    "empty serialized state resets to outside",
    ERE_MODE_OUTSIDE,
    destination.ere_mode
  );

  destination.ere_mode = ERE_MODE_BODY;
  tree_sitter_posix_awk_external_scanner_deserialize(
    &destination,
    buffer,
    SERIALIZED_SCANNER_STATE_SIZE + 1
  );
  failed |= expect_mode(
    "oversized serialized state resets to outside",
    ERE_MODE_OUTSIDE,
    destination.ere_mode
  );

  buffer[0] = (char)(ERE_MODE_ESCAPED_DELIMITER + 1);
  destination.ere_mode = ERE_MODE_BODY;
  tree_sitter_posix_awk_external_scanner_deserialize(
    &destination,
    buffer,
    SERIALIZED_SCANNER_STATE_SIZE
  );
  failed |= expect_mode(
    "invalid serialized mode resets to outside",
    ERE_MODE_OUTSIDE,
    destination.ere_mode
  );

  failed |= check_line_continuation_lookahead();
  failed |= check_required_target_leading_dot_number();
  failed |= check_required_target_invalid_layout_recovery();
  failed |= check_parameter_recovery_boundaries();
  failed |= check_function_body_recovery_boundaries();
  failed |= check_statement_recovery_boundaries();
  failed |= check_do_tail_word_boundaries();
  failed |= check_word_recovery_prefers_valid_word();
  failed |= check_greater_dispatch();
  failed |= check_do_tail_character_boundaries();
  failed |= check_required_recovery_priority();
  failed |= check_source_token_ranges();
  failed |= check_do_body_recovery_guard_range();

  return failed;
}
