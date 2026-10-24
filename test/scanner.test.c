#include "../src/scanner.c"

#include <assert.h>
#include <stdio.h>

enum {
  SCANNER_LIFECYCLE_ITERATIONS = 1024,
  DESERIALIZATION_POISON_BYTE = 0xff,
};

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static size_t live_allocations;

static void *reuse_calloc(size_t count, size_t size) {
  void *result = calloc(count, size);
  if (result != NULL) ++live_allocations;
  return result;
}

static void reuse_free(void *allocation) {
  if (allocation != NULL) {
    assert(live_allocations > 0);
    --live_allocations;
  }
  free(allocation);
}

void *(*ts_current_calloc)(size_t, size_t) = reuse_calloc;
void (*ts_current_free)(void *) = reuse_free;
#endif

typedef struct {
  TSLexer lexer;
  const char *source;
  size_t length;
  size_t position;
  size_t end;
} Input;

static void advance(TSLexer *lexer, bool skip) {
  (void)skip;
  Input *input = (Input *)lexer;
  if (input->position < input->length) ++input->position;
  lexer->lookahead = input->position < input->length
    ? (unsigned char)input->source[input->position]
    : 0;
}

static void mark_end(TSLexer *lexer) {
  Input *input = (Input *)lexer;
  input->end = input->position;
}

static bool eof(const TSLexer *lexer) {
  const Input *input = (const Input *)lexer;
  return input->position == input->length;
}

static Input input_for(const char *source, size_t length) {
  Input input = {
    .lexer =
      {.lookahead = (unsigned char)source[0],
        .advance = advance,
        .mark_end = mark_end,
        .eof = eof},
    .source = source,
    .length = length,
  };
  return input;
}

static void restore_position(Input *input) {
  input->position = input->end;
  input->lexer.lookahead = input->position < input->length
    ? (unsigned char)input->source[input->position]
    : 0;
}

static unsigned save(Scanner *scanner, char *buffer) {
  unsigned length = tree_sitter_awk_external_scanner_serialize(scanner, buffer);
  assert(length <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE);
  return length;
}

static void assert_resumed_step(
  Scanner *scanner,
  Input *input,
  const bool *valid,
  enum Token token
) {
  char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = save(scanner, before);
  Scanner resumed;
  memset(&resumed, DESERIALIZATION_POISON_BYTE, sizeof(resumed));
  tree_sitter_awk_external_scanner_deserialize(&resumed, before, length);
  Input copied = *input;
  assert(tree_sitter_awk_external_scanner_scan(scanner, &input->lexer, valid));
  assert(tree_sitter_awk_external_scanner_scan(&resumed, &copied.lexer, valid));
  assert(input->lexer.result_symbol == token);
  assert(copied.lexer.result_symbol == token);
  assert(input->end == copied.end);
  char left[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  char right[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  length = save(scanner, left);
  assert(length == save(&resumed, right));
  assert(memcmp(left, right, length) == 0);
  restore_position(input);
}

static void assert_resumed_tokens(
  const char *source,
  const enum Token *tokens,
  unsigned count
) {
  Scanner scanner = {0};
  Input input = input_for(source, strlen(source));
  for (unsigned i = 0; i < count; ++i) {
    bool valid[ERROR_SENTINEL + 1] = {0};
    valid[tokens[i]] = true;
    assert_resumed_step(&scanner, &input, valid, tokens[i]);
  }
  assert(input.position == input.length);
}

typedef struct {
  enum Token request;
  enum Token token;
  size_t end;
} RecoveryStep;

static void assert_recovery_steps(
  Scanner scanner,
  const char *source,
  const RecoveryStep *steps,
  unsigned count
) {
  scanner.shadows = 7;
  scanner.non_awk = true;
  Input input = input_for(source, strlen(source));
  for (unsigned i = 0; i < count; ++i) {
    bool valid[ERROR_SENTINEL + 1] = {0};
    for (unsigned token = 0; token <= ERROR_SENTINEL; ++token)
      valid[token] =
        steps[i].request == ERROR_SENTINEL || steps[i].request == token;
    assert_resumed_step(&scanner, &input, valid, steps[i].token);
    assert(input.position == steps[i].end);
  }
  assert(input.position == input.length);
  Scanner expected = {.shadows = 7, .non_awk = true};
  char left[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  char right[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = save(&scanner, left);
  assert(length == save(&expected, right));
  assert(memcmp(left, right, length) == 0);
}

static void recovery_retains_literal_boundaries_and_resumable_state(void) {
  const Scanner interval = {
    .literal = REGEXP,
    .regexp =
      {.interval = true, .interval_maximum = true, .interval_minimum = 2},
  };
  const RecoveryStep bracket[] = {
    {RX_COUNT, ERROR_SENTINEL, 0},
    {ERROR_SENTINEL, ERROR_SENTINEL, 6},
    {ERROR_SENTINEL, REGEXP_END, 7},
  };
  assert_recovery_steps(interval, "1}[/]b/", bracket, 3);
  const RecoveryStep escaped[] = {
    {RX_COUNT, ERROR_SENTINEL, 0},
    {ERROR_SENTINEL, ERROR_SENTINEL, 2},
    {ERROR_SENTINEL, ERROR_SENTINEL, 4},
    {ERROR_SENTINEL, ERROR_SENTINEL, 5},
    {ERROR_SENTINEL, REGEXP_END, 6},
  };
  assert_recovery_steps(interval, "1}\\/b/", escaped, 5);
  const RecoveryStep first_bracket[] = {
    {RX_COUNT, ERROR_SENTINEL, 0},
    {ERROR_SENTINEL, ERROR_SENTINEL, 5},
    {ERROR_SENTINEL, REGEXP_END, 6},
  };
  assert_recovery_steps(interval, "[/]}b/", first_bracket, 3);
  const RecoveryStep continuation[] = {
    {RX_COUNT, ERROR_SENTINEL, 0},
    {ERROR_SENTINEL, ERROR_SENTINEL, 3},
    {ERROR_SENTINEL, LINE_CONTINUATION, 5},
    {ERROR_SENTINEL, ERROR_SENTINEL, 7},
    {ERROR_SENTINEL, REGEXP_END, 8},
  };
  assert_recovery_steps(interval, "1}[\\\n/]/", continuation, 5);
  const Scanner class = {
    .literal = REGEXP,
    .regexp = {
      .host_depth = 2,
      .bracket = true,
      .form = ':',
      .form_phase = FORM_PAYLOAD
    },
  };
  const RecoveryStep class_steps[] = {
    {RX_PAYLOAD, ERROR_SENTINEL, 0},
    {ERROR_SENTINEL, ERROR_SENTINEL, 10},
    {ERROR_SENTINEL, REGEXP_END, 11},
  };
  assert_recovery_steps(class, "bogus:]/]b/", class_steps, 3);
  const Scanner paired = {.literal = REGEXP, .regexp = {.host_escaped = true}};
  const RecoveryStep paired_steps[] = {
    {ERROR_SENTINEL, ERROR_SENTINEL, 1},
    {ERROR_SENTINEL, REGEXP_END, 2},
  };
  assert_recovery_steps(paired, "\\/", paired_steps, 2);
  const RecoveryStep string_steps[] = {
    {ERROR_SENTINEL, STRING_CONTENT, 1},
    {ERROR_SENTINEL, ESCAPE_PREPARE, 1},
    {ERROR_SENTINEL, ESCAPE, 3},
    {ERROR_SENTINEL, STRING_CONTENT, 4},
    {ERROR_SENTINEL, STRING_END, 5},
  };
  assert_recovery_steps(
    (Scanner){.literal = STRING},
    "a\\\"b\"",
    string_steps,
    5
  );
  const RecoveryStep directive_steps[] = {
    {ERROR_SENTINEL, DIRECTIVE_TEXT, 1},
    {ERROR_SENTINEL, ESCAPE_PREPARE, 1},
    {ERROR_SENTINEL, ESCAPE, 3},
    {ERROR_SENTINEL, DIRECTIVE_TEXT, 4},
    {ERROR_SENTINEL, DIRECTIVE_END, 5},
  };
  assert_recovery_steps(
    (Scanner){.literal = DIRECTIVE},
    "a\\\"b\"",
    directive_steps,
    5
  );
  const RecoveryStep opening_steps[] = {
    {ERROR_SENTINEL, STRING_START, 1},
    {ERROR_SENTINEL, STRING_CONTENT, 3},
    {ERROR_SENTINEL, STRING_END, 4},
    {ERROR_SENTINEL, LINE_CONTINUATION, 6},
    {ERROR_SENTINEL, TYPED_REGEXP_MARKER, 7},
    {ERROR_SENTINEL, REGEXP_START, 8},
    {ERROR_SENTINEL, ERROR_SENTINEL, 10},
    {ERROR_SENTINEL, REGEXP_END, 11},
  };
  assert_recovery_steps((Scanner){0}, "\"}#\"\\\n@/}#/", opening_steps, 8);
  const RecoveryStep rejected_steps[] = {
    {IDENTIFIER, TYPED_REGEXP_MARKER, 1},
    {DIVIDE, REGEXP_START, 2},
    {ERROR_SENTINEL, ERROR_SENTINEL, 3},
    {ERROR_SENTINEL, REGEXP_END, 4},
  };
  assert_recovery_steps((Scanner){0}, "@/}/", rejected_steps, 4);
  bool valid[ERROR_SENTINEL + 1];
  for (unsigned token = 0; token <= ERROR_SENTINEL; ++token)
    valid[token] = true;
  for (unsigned i = 0; i < 2; ++i) {
    const char *source = i ? "@}" : "/}/";
    Input input = input_for(source, strlen(source));
    Scanner scanner = {0};
    assert(
      !tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
    );
  }
}

static void resumed_tokens_match_uninterrupted_scanning(void) {
  const enum Token escape[] = {
    REGEXP_START,
    RX_CHARACTER,
    REGEX_RAW,
    RX_PLUS,
    ESCAPE_PREPARE,
    ESCAPE_START,
    LINE_CONTINUATION,
    ESCAPE_FRAGMENT,
    ESCAPE_END,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/a\\x2\\\nb/",
    escape,
    sizeof(escape) / sizeof(*escape)
  );
  const enum Token interval[] = {
    REGEXP_START,
    RX_CHARACTER,
    REGEX_RAW,
    RX_INTERVAL_OPEN,
    REGEX_RAW,
    RX_COUNT,
    REGEX_RAW,
    RX_COMMA,
    REGEX_RAW,
    RX_COUNT,
    REGEX_RAW,
    RX_INTERVAL_CLOSE,
    REGEX_RAW,
    RX_MODIFIER,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/a{1,2}?/",
    interval,
    sizeof(interval) / sizeof(*interval)
  );
  const enum Token bracket[] = {
    REGEXP_START,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_NEGATION,
    REGEX_RAW,
    RX_CLASS_OPEN,
    REGEX_RAW,
    RX_CLASS_MARKER,
    REGEX_RAW,
    RX_PAYLOAD,
    REGEX_RAW,
    RX_CLASS_CLOSE,
    REGEX_RAW,
    RX_FORM_END,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/[^[:alpha:]/]/",
    bracket,
    sizeof(bracket) / sizeof(*bracket)
  );
  const enum Token escaped_class_marker[] = {
    REGEXP_START,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_CLASS_OPEN,
    REGEX_RAW,
    RX_CLASS_MARKER,
    REGEX_RAW,
    RX_PAYLOAD,
    REGEX_RAW,
    RX_CLASS_CLOSE,
    ESCAPE_PREPARE,
    ESCAPE,
    RX_FORM_END,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/[[:alpha\\x3a]/]/",
    escaped_class_marker,
    sizeof(escaped_class_marker) / sizeof(*escaped_class_marker)
  );
  const enum Token left_backslash[] = {
    REGEXP_START,
    RX_CHARACTER,
    ESCAPE_PREPARE,
    ESCAPE,
    REGEX_TEXT,
    RX_CHARACTER,
    REGEX_TEXT,
    REGEX_TEXT,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/\\x5c\\\\./",
    left_backslash,
    sizeof(left_backslash) / sizeof(*left_backslash)
  );
  const enum Token range[] = {
    REGEXP_START,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_RANGE,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens("/[a-z]/", range, sizeof(range) / sizeof(*range));
  const enum Token byte_range[] = {
    REGEXP_START,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_CHARACTER,
    ESCAPE_PREPARE,
    ESCAPE,
    RX_RANGE,
    REGEX_RAW,
    RX_CHARACTER,
    ESCAPE_PREPARE,
    ESCAPE,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/[\\x80-\\200]/",
    byte_range,
    sizeof(byte_range) / sizeof(*byte_range)
  );
  const enum Token unmatched_bracket[] = {
    REGEXP_START,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/]x[a]/",
    unmatched_bracket,
    sizeof(unmatched_bracket) / sizeof(*unmatched_bracket)
  );
  const enum Token restored_bracket[] = {
    REGEXP_START,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/]x[:[a/]/",
    restored_bracket,
    sizeof(restored_bracket) / sizeof(*restored_bracket)
  );
  const enum Token nested_host_class[] = {
    REGEXP_START,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_CHARACTER,
    ESCAPE_PREPARE,
    ESCAPE,
    REGEX_TEXT,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    ESCAPE_PREPARE,
    ESCAPE,
    REGEX_TEXT,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    REGEXP_END
  };
  assert_resumed_tokens(
    "/[\\x5c[:\\x5c[:a]]]/",
    nested_host_class,
    sizeof(nested_host_class) / sizeof(*nested_host_class)
  );
}

static void literal_break_preserves_name_context_without_consuming_lf(void) {
  const enum Literal literals[] = {STRING, DIRECTIVE, REGEXP};
  for (unsigned recovering = 0; recovering < 2; ++recovering) {
    for (unsigned i = 0; i < sizeof(literals) / sizeof(*literals); ++i) {
      Scanner expected = {.shadows = 7, .non_awk = true};
      Scanner scanner = expected;
      scanner.literal = literals[i];
      scanner.escape = (Escape){.left = 3, .open = true, .started = true};
      scanner.regexp =
        (Regexp){.host_depth = 3, .bracket = true, .group_depth = 2};
      Input input = input_for("\n", 1);
      bool valid[ERROR_SENTINEL + 1] = {0};
      char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      unsigned length = save(&scanner, before);
      assert(
        !tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
      );
      assert(
        save(&scanner, after) == length && memcmp(before, after, length) == 0
      );
      valid[LITERAL_BREAK] = true;
      valid[ERROR_SENTINEL] = recovering != 0;
      assert(
        tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
      );
      assert(input.lexer.result_symbol == LITERAL_BREAK);
      assert(input.position == 0 && input.end == 0);
      length = save(&expected, before);
      assert(
        save(&scanner, after) == length && memcmp(before, after, length) == 0
      );
      assert(
        !tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
      );
      Scanner resumed;
      tree_sitter_awk_external_scanner_deserialize(&resumed, after, length);
      assert(
        save(&resumed, after) == length && memcmp(before, after, length) == 0
      );

      scanner = expected;
      scanner.literal = literals[i];
      input = input_for("\\\n", 2);
      valid[LINE_CONTINUATION] = true;
      length = save(&scanner, before);
      assert(
        tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
      );
      assert(input.lexer.result_symbol == LINE_CONTINUATION && input.end == 2);
      assert(
        save(&scanner, after) == length && memcmp(before, after, length) == 0
      );
    }
  }
}

static void recovery_never_synthesizes_a_literal_closing_at_nul_or_eof(void) {
  const enum Literal literals[] = {STRING, DIRECTIVE, REGEXP};
  const char source[] = {'\0', 'x'};
  bool valid[ERROR_SENTINEL + 1];
  for (unsigned token = 0; token <= ERROR_SENTINEL; ++token)
    valid[token] = true;
  for (unsigned i = 0; i < sizeof(literals) / sizeof(*literals); ++i) {
    Scanner scanner = {.literal = literals[i], .shadows = 7, .non_awk = true};
    char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned length = save(&scanner, before);
    for (unsigned end = 0; end < 2; ++end) {
      Input input = input_for(source, end ? 0 : sizeof(source));
      assert(
        !tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
      );
      assert(input.position == 0);
      assert(
        save(&scanner, after) == length && memcmp(before, after, length) == 0
      );
    }
  }
}

static void failed_scan_preserves_saved_context(void) {
  const uint32_t shadowed_keywords = (1U << 0) | (1U << 1) | (1U << 2);
  Scanner scanner = {.shadows = shadowed_keywords, .non_awk = true};
  char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = save(&scanner, before);
  const char source[] = "function";
  Input input = input_for(source, sizeof(source) - 1);
  bool valid[ERROR_SENTINEL + 1] = {0};
  valid[IDENTIFIER] = true;
  assert(!tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid));
  assert(save(&scanner, after) == length);
  assert(memcmp(before, after, length) == 0);
  valid[ERROR_SENTINEL] = true;
  assert(!tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid));
  assert(save(&scanner, after) == length);
  assert(memcmp(before, after, length) == 0);
  tree_sitter_awk_external_scanner_deserialize(&scanner, NULL, 0);
  assert(scanner.shadows == 0 && !scanner.non_awk && scanner.literal == NONE);
}

static void assert_no_state_after(
  const char *source,
  const enum Token *tokens,
  unsigned count
) {
  Scanner scanner = {0};
  Input input = input_for(source, strlen(source));
  for (unsigned i = 0; i < count; ++i) {
    bool valid[ERROR_SENTINEL + 1] = {0};
    valid[tokens[i]] = true;
    assert(
      tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid)
    );
    assert(input.lexer.result_symbol == tokens[i]);
    restore_position(&input);
  }
  assert(input.position == input.length);
  Scanner empty = {0};
  char expected[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  char actual[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = save(&empty, expected);
  assert(save(&scanner, actual) == length);
  assert(memcmp(expected, actual, length) == 0);
}

static void completed_constructs_leave_no_scanner_state(void) {
  const enum Token regexp[] = {
    REGEXP_START,
    RX_BRACKET_OPEN,
    REGEX_RAW,
    RX_NEGATION,
    REGEX_RAW,
    RX_CHARACTER,
    REGEX_RAW,
    RX_BRACKET_CLOSE,
    REGEX_RAW,
    RX_INTERVAL_OPEN,
    REGEX_RAW,
    RX_COUNT,
    REGEX_RAW,
    RX_INTERVAL_CLOSE,
    REGEX_RAW,
    REGEXP_END
  };
  assert_no_state_after("/[^a]{3}/", regexp, sizeof(regexp) / sizeof(*regexp));
  const enum Token split_escape[] = {
    STRING_START,
    ESCAPE_PREPARE,
    ESCAPE_START,
    LINE_CONTINUATION,
    ESCAPE_FRAGMENT,
    ESCAPE_END,
    STRING_END
  };
  assert_no_state_after(
    "\"\\1\\\n2\"",
    split_escape,
    sizeof(split_escape) / sizeof(*split_escape)
  );
  const enum Token qualified[] =
    {QUALIFIER, QUALIFIED_SEPARATOR, QUALIFIED_IDENTIFIER};
  assert_no_state_after(
    "awk::x",
    qualified,
    sizeof(qualified) / sizeof(*qualified)
  );
}

static void actual_nul_is_not_end_of_input(void) {
  const char source[] = {'\0', 'x'};
  Input input = input_for(source, sizeof(source));
  Scanner scanner = {0};
  bool valid[ERROR_SENTINEL + 1] = {0};
  valid[END_OF_INPUT] = true;
  assert(!tree_sitter_awk_external_scanner_scan(&scanner, &input.lexer, valid));
}

static void scanner_lifecycle_releases_allocations(void) {
  for (unsigned i = 0; i < SCANNER_LIFECYCLE_ITERATIONS; ++i) {
    Scanner *scanner = tree_sitter_awk_external_scanner_create();
    assert(scanner && scanner->literal == NONE && scanner->shadows == 0);
    tree_sitter_awk_external_scanner_destroy(scanner);
  }
#ifdef TREE_SITTER_REUSE_ALLOCATOR
  assert(live_allocations == 0);
#endif
}

static void failed_creation_payload_is_inert(void) {
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE] = {0};
  assert(tree_sitter_awk_external_scanner_serialize(NULL, buffer) == 0);
  tree_sitter_awk_external_scanner_deserialize(NULL, buffer, 1);
  tree_sitter_awk_external_scanner_deserialize(NULL, NULL, 0);
  const char source[] = "x";
  Input input = input_for(source, sizeof(source) - 1);
  bool valid[ERROR_SENTINEL + 1] = {0};
  valid[IDENTIFIER] = true;
  assert(!tree_sitter_awk_external_scanner_scan(NULL, &input.lexer, valid));
  assert(input.position == 0);
  tree_sitter_awk_external_scanner_destroy(NULL);
}

int main(void) {
  resumed_tokens_match_uninterrupted_scanning();
  recovery_retains_literal_boundaries_and_resumable_state();
  literal_break_preserves_name_context_without_consuming_lf();
  recovery_never_synthesizes_a_literal_closing_at_nul_or_eof();
  failed_scan_preserves_saved_context();
  completed_constructs_leave_no_scanner_state();
  actual_nul_is_not_end_of_input();
  scanner_lifecycle_releases_allocations();
  failed_creation_payload_is_inert();
  puts(
    "scanner: resume, failed scan, reset, completed state, NUL/EOF, and failed creation checks passed"
  );
  return 0;
}
