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

static void reset_mock_token(MockLexer *mock) {
  mock->offset = mock->token_end;
  mock->advance_count = 0;
  mock->lexer.lookahead = (unsigned char)mock->source[mock->offset];
  mock->lexer.result_symbol = 0;
}

static int check_ere_line_continuation_run(
  const char *test_name,
  size_t continuation_count,
  char target,
  enum TokenType run_guard
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
  ScannerState state = {.ere_mode = ERE_MODE_BODY};
  bool valid_symbols[ERROR_SENTINEL + 1] = {false};
  valid_symbols[run_guard] = true;
  if (run_guard == ERE_RUN_GUARD) {
    valid_symbols[ERE_DIGIT_RUN_GUARD] = true;
  }

  int failed = 0;
  const bool scanned = tree_sitter_posix_awk_external_scanner_scan(
    &state,
    &mock.lexer,
    valid_symbols
  );
  size_t total_advances = mock.advance_count;
  if (
    !scanned ||
    mock.lexer.result_symbol !=
    run_guard ||
    mock.advance_count !=
    continuation_count *
    2U ||
    mock.token_end != 0
  ) {
    fprintf(
      stderr,
      "%s guard: scanned=%u symbol=%u advances=%zu end=%zu\n",
      test_name,
      scanned,
      mock.lexer.result_symbol,
      mock.advance_count,
      mock.token_end
    );
    failed = 1;
  }

  reset_mock_token(&mock);
  valid_symbols[run_guard] = false;
  valid_symbols[ERE_DIGIT_RUN_GUARD] = false;
  valid_symbols[ERE_LINE_CONTINUATION] = true;
  for (size_t i = 0; i < continuation_count; i++) {
    const bool continuation_scanned =
      tree_sitter_posix_awk_external_scanner_scan(
        &state,
        &mock.lexer,
        valid_symbols
      );
    total_advances += mock.advance_count;
    if (
      !continuation_scanned ||
      mock.lexer.result_symbol !=
      ERE_LINE_CONTINUATION ||
      mock.advance_count !=
      2U ||
      mock.token_end !=
      (i + 1U) *
      2U
    ) {
      fprintf(
        stderr,
        "%s continuation %zu: scanned=%u symbol=%u advances=%zu "
        "end=%zu\n",
        test_name,
        i,
        continuation_scanned,
        mock.lexer.result_symbol,
        mock.advance_count,
        mock.token_end
      );
      failed = 1;
      break;
    }
    reset_mock_token(&mock);
  }
  if (total_advances > continuation_count * 4U) {
    fprintf(
      stderr,
      "%s: total advances=%zu for %zu continuations\n",
      test_name,
      total_advances,
      continuation_count
    );
    failed = 1;
  }

  free(source);
  return failed;
}

static int check_ere_line_continuation_lookahead(void) {
  return check_ere_line_continuation_run(
    "ERE linear lookahead",
    32768,
    'a',
    ERE_EXPRESSION_RUN_GUARD
  );
}

static int check_ere_line_continuation_owners(void) {
  static const struct {
    const char *name;
    size_t continuation_count;
    char target;
    enum TokenType owner;
  } cases[] = {
    {"generic owner", 2, ',', ERE_RUN_GUARD},
    {"expression owner", 2, 'b', ERE_EXPRESSION_RUN_GUARD},
    {"alternation owner", 3, '|', ERE_ALTERNATION_RUN_GUARD},
    {"duplication owner", 2, '*', ERE_DUPLICATION_RUN_GUARD},
    {"modifier owner", 3, '?', ERE_MODIFIER_RUN_GUARD},
    {"group-close owner", 3, ')', ERE_GROUP_CLOSE_RUN_GUARD},
    {"group-recovery owner", 2, '/', ERE_GROUP_RECOVERY_RUN_GUARD},
    {"bracket-close owner", 2, ']', ERE_BRACKET_CLOSE_RUN_GUARD},
    {"end owner", 3, '/', ERE_END_RUN_GUARD},
    {"escape owner", 2, 'q', ERE_ESCAPE_RUN_GUARD},
    {"octal owner", 3, '7', ERE_OCTAL_RUN_GUARD},
    {"digit owner", 2, '9', ERE_DIGIT_RUN_GUARD},
    {"class owner", 3, 'a', ERE_CLASS_RUN_GUARD},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    failed |= check_ere_line_continuation_run(
      cases[i].name,
      cases[i].continuation_count,
      cases[i].target,
      cases[i].owner
    );
  }
  return failed;
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
    {"continued leading-dot number",
      "\n.\\\n5",
      EXPRESSION_TARGET_GUARD,
      false,
      EXPRESSION_TARGET_GUARD},
    {"multiply continued print leading-dot number",
      "\n.\\\n\\\n5",
      PRINT_EXPRESSION_TARGET_GUARD,
      false,
      PRINT_EXPRESSION_TARGET_GUARD},
    {"continued dot without a digit",
      "\n.\\\n+",
      EXPRESSION_TARGET_GUARD,
      true,
      EXPRESSION_RECOVERY},
  };

  int failed = 0;
  for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    MockLexer mock = make_mock_lexer(cases[i].source);
    ScannerState state = {.ere_mode = ERE_MODE_OUTSIDE};
    bool valid_symbols[ERROR_SENTINEL + 1] = {false};
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
    bool valid_symbols[ERROR_SENTINEL + 1] = {false};
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
    {".\\\n5", false, ERROR_SENTINEL},
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
    bool valid_symbols[ERROR_SENTINEL + 1] = {false};
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
    {".\\\n5", true},
    {".", false},
    {".\\\nx", false},
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
    bool valid_symbols[ERROR_SENTINEL + 1] = {false};
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

  failed |= check_ere_line_continuation_lookahead();
  failed |= check_ere_line_continuation_owners();
  failed |= check_required_target_leading_dot_number();
  failed |= check_required_target_invalid_layout_recovery();
  failed |= check_parameter_recovery_boundaries();
  failed |= check_function_body_recovery_boundaries();

  return failed;
}
