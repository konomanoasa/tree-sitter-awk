#include "tree_sitter/parser.h"

#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define ARRAY_LENGTH(array) (sizeof(array) / sizeof((array)[0]))

enum TokenType {
  BEGIN_WORD,
  END_WORD,
  FUNCTION_WORD,
  PRINT_WORD,
  BREAK_WORD,
  CONTINUE_WORD,
  DELETE_WORD,
  DO_WORD,
  ELSE_WORD,
  EXIT_WORD,
  FOR_WORD,
  IF_WORD,
  NEXT_WORD,
  NEXTFILE_WORD,
  PRINTF_WORD,
  RETURN_WORD,
  WHILE_WORD,
  NAME_WORD,
  GETLINE_WORD,
  IN_WORD,
  BUILTIN_FUNC_NAME_WORD,
  FUNC_NAME_WORD,
  NUMBER_INTEGER,
  NUMBER_FRACTION,
  NUMBER_EXPONENT,
  DIVISION_SLASH,
  ERE_OPENING_SLASH,
  DIV_ASSIGN_OPERATOR,
  ADD_ASSIGN_OPERATOR,
  SUB_ASSIGN_OPERATOR,
  MUL_ASSIGN_OPERATOR,
  MOD_ASSIGN_OPERATOR,
  POW_ASSIGN_OPERATOR,
  OR_OPERATOR,
  AND_OPERATOR,
  NO_MATCH_OPERATOR,
  EQ_OPERATOR,
  LE_OPERATOR,
  GE_OPERATOR,
  NE_OPERATOR,
  INCR_OPERATOR,
  DECR_OPERATOR,
  APPEND_OPERATOR,
  OUTPUT_GREATER_GUARD,
  LC_BEFORE_OPERATOR,
  LC_BEFORE_ADDITIVE_OPERATOR,
  LC_BEFORE_MULTIPLICATIVE_OPERATOR,
  LC_BEFORE_EXPONENTIATION_OPERATOR,
  LC_BEFORE_COMPARISON_OPERATOR,
  LC_BEFORE_MATCH_OPERATOR,
  LC_BEFORE_MEMBERSHIP_OPERATOR,
  LC_BEFORE_LOGICAL_AND_OPERATOR,
  LC_BEFORE_LOGICAL_OR_OPERATOR,
  LC_BEFORE_CONDITIONAL_QUESTION,
  LC_BEFORE_CONDITIONAL_COLON,
  LC_BEFORE_LESS_THAN,
  LC_BEFORE_INPUT_PIPE,
  LC_BEFORE_OUTPUT_REDIRECTION,
  LC_BEFORE_ELSE,
  LC_BEFORE_DO_TAIL,
  LC_BEFORE_FOR_SEMICOLON,
  LC_BEFORE_FOR_UPDATE,
  LC_BEFORE_EXPRESSION,
  LC_BEFORE_COMMA,
  LC_BEFORE_OPEN_BRACKET,
  LC_BEFORE_CALL_PARENTHESIS,
  LC_BEFORE_CLOSE_PARENTHESIS,
  LC_BEFORE_CLOSE_BRACKET,
  CLOSED_ITEM_BOUNDARY,
  NORMAL_PATTERN_ITEM_BOUNDARY,
  ERE_COMPOUND_OPEN_GUARD,
  ERE_DOT_CLOSE_GUARD,
  ERE_EQUAL_CLOSE_GUARD,
  ERE_COLON_CLOSE_GUARD,
  ERE_ESCAPE_START,
  ERE_ESCAPED_DELIMITER_START,
  ERE_ESCAPED_DELIMITER_END,
  ERE_LEXICAL_END,
  ERE_CLOSING,
  EXPRESSION_TARGET_GUARD,
  PRINT_EXPRESSION_TARGET_GUARD,
  ACTION_TARGET_GUARD,
  PARAMETER_TARGET_GUARD,
  ERROR_SENTINEL,
  TOKEN_TYPE_COUNT,
};

enum {
  MAX_RESERVED_WORD_LENGTH = 8,
  SERIALIZED_SCANNER_STATE_SIZE = 1,
};

typedef char SerializedScannerStateFitsTreeSitterBuffer
  [SERIALIZED_SCANNER_STATE_SIZE <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE ? 1
                                                                          : -1];

typedef enum {
  WORD_KIND_NONE,
  WORD_KIND_BEGIN,
  WORD_KIND_END,
  WORD_KIND_FUNCTION,
  WORD_KIND_BREAK,
  WORD_KIND_CONTINUE,
  WORD_KIND_DELETE,
  WORD_KIND_DO,
  WORD_KIND_ELSE,
  WORD_KIND_EXIT,
  WORD_KIND_FOR,
  WORD_KIND_IF,
  WORD_KIND_NEXT,
  WORD_KIND_NEXTFILE,
  WORD_KIND_PRINT,
  WORD_KIND_PRINTF,
  WORD_KIND_RETURN,
  WORD_KIND_WHILE,
  WORD_KIND_GETLINE,
  WORD_KIND_IN,
  WORD_KIND_BUILTIN_FUNC_NAME,
  WORD_KIND_FUNC_NAME,
  WORD_KIND_NAME,
} WordKind;

typedef struct {
  const char *spelling;
  WordKind kind;
} WordEntry;

typedef enum {
  WORD_ROLE_EXPRESSION_START = 1U << 0,
  WORD_ROLE_ITEM_START = 1U << 1,
  WORD_ROLE_RESERVED_ITEM_START = 1U << 2,
} WordRole;

typedef struct {
  WordKind kind;
  enum TokenType token;
  unsigned roles;
} WordToken;

typedef struct {
  int32_t first;
  int32_t second;
  enum TokenType token;
} CompositeOperator;

typedef enum {
  NUMBER_KIND_NONE,
  NUMBER_KIND_INTEGER,
  NUMBER_KIND_FRACTION,
  NUMBER_KIND_EXPONENT,
} NumberKind;

typedef enum {
  ERE_MODE_OUTSIDE,
  ERE_MODE_BODY,
  ERE_MODE_ESCAPED_DELIMITER,
} EreMode;

typedef struct {
  EreMode ere_mode;
} ScannerState;

static const WordEntry WORDS[] = {
  {"BEGIN", WORD_KIND_BEGIN},
  {"break", WORD_KIND_BREAK},
  {"continue", WORD_KIND_CONTINUE},
  {"delete", WORD_KIND_DELETE},
  {"do", WORD_KIND_DO},
  {"else", WORD_KIND_ELSE},
  {"END", WORD_KIND_END},
  {"exit", WORD_KIND_EXIT},
  {"for", WORD_KIND_FOR},
  {"function", WORD_KIND_FUNCTION},
  {"getline", WORD_KIND_GETLINE},
  {"if", WORD_KIND_IF},
  {"in", WORD_KIND_IN},
  {"next", WORD_KIND_NEXT},
  {"nextfile", WORD_KIND_NEXTFILE},
  {"print", WORD_KIND_PRINT},
  {"printf", WORD_KIND_PRINTF},
  {"return", WORD_KIND_RETURN},
  {"while", WORD_KIND_WHILE},
  {"atan2", WORD_KIND_BUILTIN_FUNC_NAME},
  {"close", WORD_KIND_BUILTIN_FUNC_NAME},
  {"cos", WORD_KIND_BUILTIN_FUNC_NAME},
  {"exp", WORD_KIND_BUILTIN_FUNC_NAME},
  {"fflush", WORD_KIND_BUILTIN_FUNC_NAME},
  {"gsub", WORD_KIND_BUILTIN_FUNC_NAME},
  {"index", WORD_KIND_BUILTIN_FUNC_NAME},
  {"int", WORD_KIND_BUILTIN_FUNC_NAME},
  {"length", WORD_KIND_BUILTIN_FUNC_NAME},
  {"log", WORD_KIND_BUILTIN_FUNC_NAME},
  {"match", WORD_KIND_BUILTIN_FUNC_NAME},
  {"rand", WORD_KIND_BUILTIN_FUNC_NAME},
  {"sin", WORD_KIND_BUILTIN_FUNC_NAME},
  {"split", WORD_KIND_BUILTIN_FUNC_NAME},
  {"sprintf", WORD_KIND_BUILTIN_FUNC_NAME},
  {"sqrt", WORD_KIND_BUILTIN_FUNC_NAME},
  {"srand", WORD_KIND_BUILTIN_FUNC_NAME},
  {"sub", WORD_KIND_BUILTIN_FUNC_NAME},
  {"substr", WORD_KIND_BUILTIN_FUNC_NAME},
  {"system", WORD_KIND_BUILTIN_FUNC_NAME},
  {"tolower", WORD_KIND_BUILTIN_FUNC_NAME},
  {"toupper", WORD_KIND_BUILTIN_FUNC_NAME},
};

static const WordToken WORD_TOKENS[] = {
  {WORD_KIND_BEGIN,
    BEGIN_WORD,
    WORD_ROLE_ITEM_START | WORD_ROLE_RESERVED_ITEM_START},
  {WORD_KIND_END,
    END_WORD,
    WORD_ROLE_ITEM_START | WORD_ROLE_RESERVED_ITEM_START},
  {WORD_KIND_FUNCTION,
    FUNCTION_WORD,
    WORD_ROLE_ITEM_START | WORD_ROLE_RESERVED_ITEM_START},
  {WORD_KIND_PRINT, PRINT_WORD, 0},
  {WORD_KIND_BREAK, BREAK_WORD, 0},
  {WORD_KIND_CONTINUE, CONTINUE_WORD, 0},
  {WORD_KIND_DELETE, DELETE_WORD, 0},
  {WORD_KIND_DO, DO_WORD, 0},
  {WORD_KIND_ELSE, ELSE_WORD, 0},
  {WORD_KIND_EXIT, EXIT_WORD, 0},
  {WORD_KIND_FOR, FOR_WORD, 0},
  {WORD_KIND_IF, IF_WORD, 0},
  {WORD_KIND_NEXT, NEXT_WORD, 0},
  {WORD_KIND_NEXTFILE, NEXTFILE_WORD, 0},
  {WORD_KIND_PRINTF, PRINTF_WORD, 0},
  {WORD_KIND_RETURN, RETURN_WORD, 0},
  {WORD_KIND_WHILE, WHILE_WORD, 0},
  {WORD_KIND_NAME,
    NAME_WORD,
    WORD_ROLE_EXPRESSION_START | WORD_ROLE_ITEM_START},
  {WORD_KIND_GETLINE,
    GETLINE_WORD,
    WORD_ROLE_EXPRESSION_START | WORD_ROLE_ITEM_START},
  {WORD_KIND_IN, IN_WORD, 0},
  {WORD_KIND_BUILTIN_FUNC_NAME,
    BUILTIN_FUNC_NAME_WORD,
    WORD_ROLE_EXPRESSION_START | WORD_ROLE_ITEM_START},
  {WORD_KIND_FUNC_NAME,
    FUNC_NAME_WORD,
    WORD_ROLE_EXPRESSION_START | WORD_ROLE_ITEM_START},
};

static const CompositeOperator COMPOSITE_OPERATORS[] = {
  {'/', '=', DIV_ASSIGN_OPERATOR},
  {'+', '=', ADD_ASSIGN_OPERATOR},
  {'-', '=', SUB_ASSIGN_OPERATOR},
  {'*', '=', MUL_ASSIGN_OPERATOR},
  {'%', '=', MOD_ASSIGN_OPERATOR},
  {'^', '=', POW_ASSIGN_OPERATOR},
  {'|', '|', OR_OPERATOR},
  {'&', '&', AND_OPERATOR},
  {'!', '~', NO_MATCH_OPERATOR},
  {'=', '=', EQ_OPERATOR},
  {'<', '=', LE_OPERATOR},
  {'>', '=', GE_OPERATOR},
  {'!', '=', NE_OPERATOR},
  {'+', '+', INCR_OPERATOR},
  {'-', '-', DECR_OPERATOR},
  {'>', '>', APPEND_OPERATOR},
};

static bool is_ascii_blank(int32_t character) {
  return character == ' ' || character == '\t';
}

static bool is_ascii_digit(int32_t character) {
  return character >= '0' && character <= '9';
}

static bool is_ascii_letter(int32_t character) {
  return (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z');
}

static bool is_word_start(int32_t character) {
  return is_ascii_letter(character) || character == '_';
}

static bool is_word_continue(int32_t character) {
  return is_word_start(character) || is_ascii_digit(character);
}

static bool character_starts_expression(int32_t character) {
  switch (character) {
  case '"':
  case '(':
  case '$':
  case '+':
  case '-':
  case '/':
  case '!':
    return true;
  default:
    return false;
  }
}

static bool character_starts_item(int32_t character) {
  return character == '{' || character_starts_expression(character);
}

static bool advance_line_continuations(TSLexer *lexer) {
  bool found = false;

  while (lexer->lookahead == '\\') {
    lexer->advance(lexer, false);
    if (lexer->lookahead != '\n') {
      return false;
    }

    lexer->advance(lexer, false);
    found = true;
  }

  return found;
}

static void skip_ascii_blanks(TSLexer *lexer) {
  while (is_ascii_blank(lexer->lookahead)) {
    lexer->advance(lexer, true);
  }
}

static bool advance_comment_to_boundary(TSLexer *lexer);

static bool advance_layout_gap(TSLexer *lexer) {
  for (;;) {
    skip_ascii_blanks(lexer);
    (void)advance_comment_to_boundary(lexer);
    if (lexer->lookahead == '\n') {
      lexer->advance(lexer, false);
      continue;
    }
    if (lexer->lookahead != '\\') {
      return true;
    }
    if (!advance_line_continuations(lexer)) {
      return false;
    }
  }
}

static WordKind classify_word(const char *word, size_t length) {
  if (length > MAX_RESERVED_WORD_LENGTH) {
    return WORD_KIND_NAME;
  }

  for (size_t i = 0; i < ARRAY_LENGTH(WORDS); i++) {
    if (strcmp(WORDS[i].spelling, word) == 0) {
      return WORDS[i].kind;
    }
  }

  return WORD_KIND_NAME;
}

static WordKind scan_word_spelling(TSLexer *lexer) {
  char word[MAX_RESERVED_WORD_LENGTH + 1] = {0};
  size_t length = 0;

  if (!is_word_start(lexer->lookahead)) {
    return WORD_KIND_NONE;
  }

  while (is_word_continue(lexer->lookahead)) {
    if (length < MAX_RESERVED_WORD_LENGTH) {
      word[length] = (char)lexer->lookahead;
    }
    if (length <= MAX_RESERVED_WORD_LENGTH) {
      length++;
    }
    lexer->advance(lexer, false);
  }

  return classify_word(word, length);
}

static WordKind scan_func_name_suffix(TSLexer *lexer, WordKind kind) {
  if (kind != WORD_KIND_NAME) {
    return kind;
  }

  if (lexer->lookahead == '\\' && !advance_line_continuations(lexer)) {
    return kind;
  }
  return lexer->lookahead == '(' ? WORD_KIND_FUNC_NAME : kind;
}

static WordKind scan_word_kind(TSLexer *lexer) {
  return scan_func_name_suffix(lexer, scan_word_spelling(lexer));
}

static bool
emit_word_kind(TSLexer *lexer, const bool *valid_symbols, WordKind kind) {
  for (size_t i = 0; i < ARRAY_LENGTH(WORD_TOKENS); i++) {
    if (WORD_TOKENS[i].kind == kind && valid_symbols[WORD_TOKENS[i].token]) {
      lexer->result_symbol = WORD_TOKENS[i].token;
      return true;
    }
  }

  return false;
}

static bool word_token_is_valid(const bool *valid_symbols, WordKind kind) {
  if (kind == WORD_KIND_NAME && valid_symbols[FUNC_NAME_WORD]) {
    return true;
  }
  for (size_t i = 0; i < ARRAY_LENGTH(WORD_TOKENS); i++) {
    if (WORD_TOKENS[i].kind == kind && valid_symbols[WORD_TOKENS[i].token]) {
      return true;
    }
  }
  return false;
}

static bool
scan_word_token(TSLexer *lexer, const bool *valid_symbols, WordKind kind) {
  if (!word_token_is_valid(valid_symbols, kind)) {
    return false;
  }

  lexer->mark_end(lexer);
  return emit_word_kind(
    lexer,
    valid_symbols,
    scan_func_name_suffix(lexer, kind)
  );
}

static bool has_word_marker(const bool *valid_symbols) {
  for (size_t i = 0; i < ARRAY_LENGTH(WORD_TOKENS); i++) {
    if (valid_symbols[WORD_TOKENS[i].token]) {
      return true;
    }
  }
  return false;
}

static unsigned word_roles(WordKind kind) {
  for (size_t i = 0; i < ARRAY_LENGTH(WORD_TOKENS); i++) {
    if (WORD_TOKENS[i].kind == kind) {
      return WORD_TOKENS[i].roles;
    }
  }
  return 0;
}

static bool word_has_role(WordKind kind, unsigned roles) {
  return (word_roles(kind) & roles) != 0;
}

static bool word_starts_expression(WordKind kind) {
  return word_has_role(kind, WORD_ROLE_EXPRESSION_START);
}

static bool word_starts_print_expression(WordKind kind) {
  return kind != WORD_KIND_GETLINE && word_starts_expression(kind);
}

static enum TokenType number_kind_token(NumberKind kind) {
  switch (kind) {
  case NUMBER_KIND_FRACTION:
    return NUMBER_FRACTION;
  case NUMBER_KIND_EXPONENT:
    return NUMBER_EXPONENT;
  default:
    return NUMBER_INTEGER;
  }
}

static void accept_number(
  TSLexer *lexer,
  const bool *valid_symbols,
  NumberKind kind,
  NumberKind *accepted,
  NumberKind *token_kind
) {
  *accepted = kind;
  if (valid_symbols != NULL && valid_symbols[number_kind_token(kind)]) {
    lexer->mark_end(lexer);
    *token_kind = kind;
  }
}

// Scans one NUMBER spelling. Returns the longest kind present in the source
// while *token_kind tracks the longest kind that is currently valid, whose
// end position is marked: "1.2" with only NUMBER_INTEGER valid scans as a
// fraction but tokenizes the integer prefix "1".
static NumberKind scan_number_kind_with_end(
  TSLexer *lexer,
  const bool *valid_symbols,
  NumberKind *token_kind
) {
  NumberKind accepted = NUMBER_KIND_NONE;

  while (is_ascii_digit(lexer->lookahead)) {
    lexer->advance(lexer, false);
    accept_number(
      lexer,
      valid_symbols,
      NUMBER_KIND_INTEGER,
      &accepted,
      token_kind
    );
  }
  if (lexer->lookahead == '.') {
    lexer->advance(lexer, false);
    if (accepted != NUMBER_KIND_NONE) {
      accept_number(
        lexer,
        valid_symbols,
        NUMBER_KIND_FRACTION,
        &accepted,
        token_kind
      );
    }
    while (is_ascii_digit(lexer->lookahead)) {
      lexer->advance(lexer, false);
      accept_number(
        lexer,
        valid_symbols,
        NUMBER_KIND_FRACTION,
        &accepted,
        token_kind
      );
    }
  }
  if (accepted == NUMBER_KIND_NONE) {
    return accepted;
  }

  if (lexer->lookahead == 'e' || lexer->lookahead == 'E') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '+' || lexer->lookahead == '-') {
      lexer->advance(lexer, false);
    }
    while (is_ascii_digit(lexer->lookahead)) {
      lexer->advance(lexer, false);
      accept_number(
        lexer,
        valid_symbols,
        NUMBER_KIND_EXPONENT,
        &accepted,
        token_kind
      );
    }
  }
  return accepted;
}

static NumberKind scan_number_kind(TSLexer *lexer) {
  NumberKind token_kind = NUMBER_KIND_NONE;
  return scan_number_kind_with_end(lexer, NULL, &token_kind);
}

static bool scan_number_start(TSLexer *lexer) {
  if (is_ascii_digit(lexer->lookahead)) {
    return true;
  }
  return lexer->lookahead == '.' && scan_number_kind(lexer) != NUMBER_KIND_NONE;
}

static bool
emit_number_kind(TSLexer *lexer, const bool *valid_symbols, NumberKind kind) {
  if (kind == NUMBER_KIND_NONE || !valid_symbols[number_kind_token(kind)]) {
    return false;
  }
  lexer->result_symbol = number_kind_token(kind);
  return true;
}

static bool
has_valid_composite_operator_start(int32_t first, const bool *valid_symbols) {
  for (size_t i = 0; i < ARRAY_LENGTH(COMPOSITE_OPERATORS); i++) {
    if (
      COMPOSITE_OPERATORS[i].first ==
      first &&
      valid_symbols[COMPOSITE_OPERATORS[i].token]
    ) {
      return true;
    }
  }
  return false;
}

static const CompositeOperator *
find_composite_operator(int32_t first, int32_t second) {
  for (size_t i = 0; i < ARRAY_LENGTH(COMPOSITE_OPERATORS); i++) {
    if (
      COMPOSITE_OPERATORS[i].first ==
      first &&
      COMPOSITE_OPERATORS[i].second == second
    ) {
      return &COMPOSITE_OPERATORS[i];
    }
  }
  return NULL;
}

static bool is_composite_operator_start(int32_t first) {
  for (size_t i = 0; i < ARRAY_LENGTH(COMPOSITE_OPERATORS); i++) {
    if (COMPOSITE_OPERATORS[i].first == first) {
      return true;
    }
  }
  return false;
}

static bool
scan_composite_operator_start(TSLexer *lexer, const bool *valid_symbols) {
  const int32_t first = lexer->lookahead;
  lexer->advance(lexer, false);
  const CompositeOperator *composite =
    find_composite_operator(first, lexer->lookahead);
  if (composite == NULL || !valid_symbols[composite->token]) {
    return false;
  }

  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  lexer->result_symbol = composite->token;
  return true;
}

static bool
has_greater_start(const bool *valid_symbols, bool allow_zero_width_guard) {
  return valid_symbols[GE_OPERATOR] ||
    valid_symbols[APPEND_OPERATOR] ||
    (allow_zero_width_guard && valid_symbols[OUTPUT_GREATER_GUARD]);
}

// Dispatch together so an invalid two-character operator cannot block the
// zero-width redirection guard.
static bool scan_greater_start(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool allow_zero_width_guard
) {
  lexer->advance(lexer, false);
  if (lexer->lookahead == '=') {
    if (!valid_symbols[GE_OPERATOR]) {
      return false;
    }
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = GE_OPERATOR;
    return true;
  }
  if (lexer->lookahead == '>' && valid_symbols[APPEND_OPERATOR]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = APPEND_OPERATOR;
    return true;
  }
  if (!allow_zero_width_guard || !valid_symbols[OUTPUT_GREATER_GUARD]) {
    return false;
  }
  lexer->result_symbol = OUTPUT_GREATER_GUARD;
  return true;
}

static bool scan_slash_start(
  ScannerState *state,
  TSLexer *lexer,
  const bool *valid_symbols,
  bool prefer_ere
) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->lookahead == '=') {
    if (valid_symbols[DIV_ASSIGN_OPERATOR]) {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      lexer->result_symbol = DIV_ASSIGN_OPERATOR;
      return true;
    }
    if (valid_symbols[DIVISION_SLASH]) {
      return false;
    }
  }
  if (prefer_ere && valid_symbols[ERE_OPENING_SLASH]) {
    lexer->result_symbol = ERE_OPENING_SLASH;
    state->ere_mode = ERE_MODE_BODY;
    return true;
  }
  if (valid_symbols[DIVISION_SLASH]) {
    lexer->result_symbol = DIVISION_SLASH;
    return true;
  }
  if (valid_symbols[ERE_OPENING_SLASH]) {
    lexer->result_symbol = ERE_OPENING_SLASH;
    state->ere_mode = ERE_MODE_BODY;
    return true;
  }
  return false;
}

static bool emit_word_item_boundary(
  TSLexer *lexer,
  const bool *valid_symbols,
  WordKind kind
) {
  const bool reserved_item_start =
    word_has_role(kind, WORD_ROLE_RESERVED_ITEM_START);
  if (
    valid_symbols[CLOSED_ITEM_BOUNDARY] &&
    word_has_role(kind, WORD_ROLE_ITEM_START)
  ) {
    lexer->result_symbol = CLOSED_ITEM_BOUNDARY;
    return true;
  }
  if (reserved_item_start && valid_symbols[NORMAL_PATTERN_ITEM_BOUNDARY]) {
    lexer->result_symbol = NORMAL_PATTERN_ITEM_BOUNDARY;
    return true;
  }
  return false;
}

static bool
scan_required_target_guard(TSLexer *lexer, const bool *valid_symbols) {
  lexer->advance(lexer, false);
  if (!advance_layout_gap(lexer)) {
    return false;
  }

  if (valid_symbols[ACTION_TARGET_GUARD] && lexer->lookahead == '{') {
    lexer->result_symbol = ACTION_TARGET_GUARD;
    return true;
  }

  if (
    is_word_start(lexer->lookahead) &&
    (valid_symbols[EXPRESSION_TARGET_GUARD] ||
      valid_symbols[PRINT_EXPRESSION_TARGET_GUARD] ||
      valid_symbols[PARAMETER_TARGET_GUARD])
  ) {
    const WordKind kind = scan_word_kind(lexer);
    if (valid_symbols[PARAMETER_TARGET_GUARD] && kind == WORD_KIND_NAME) {
      lexer->result_symbol = PARAMETER_TARGET_GUARD;
      return true;
    }
    if (
      valid_symbols[PRINT_EXPRESSION_TARGET_GUARD] &&
      word_starts_print_expression(kind)
    ) {
      lexer->result_symbol = PRINT_EXPRESSION_TARGET_GUARD;
      return true;
    }
    if (
      valid_symbols[EXPRESSION_TARGET_GUARD] && word_starts_expression(kind)
    ) {
      lexer->result_symbol = EXPRESSION_TARGET_GUARD;
      return true;
    }
  } else if (
    valid_symbols[EXPRESSION_TARGET_GUARD] ||
    valid_symbols[PRINT_EXPRESSION_TARGET_GUARD]
  ) {
    const bool starts_expression =
      character_starts_expression(lexer->lookahead);
    const bool starts_number = scan_number_start(lexer);
    if (starts_expression || starts_number) {
      lexer->result_symbol = valid_symbols[PRINT_EXPRESSION_TARGET_GUARD]
        ? PRINT_EXPRESSION_TARGET_GUARD
        : EXPRESSION_TARGET_GUARD;
      return true;
    }
  }

  return false;
}

static bool scan_ere_backslash_context(
  ScannerState *state,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  if (lexer->lookahead != '\\') {
    return false;
  }

  lexer->advance(lexer, false);
  if (
    !valid_symbols[ERROR_SENTINEL] &&
    lexer->lookahead ==
    '/' &&
    valid_symbols[ERE_ESCAPED_DELIMITER_START]
  ) {
    lexer->result_symbol = ERE_ESCAPED_DELIMITER_START;
    state->ere_mode = ERE_MODE_ESCAPED_DELIMITER;
    return true;
  }
  if (
    lexer->lookahead !=
    '\n' &&
    !lexer->eof(lexer) &&
    !valid_symbols[ERROR_SENTINEL] &&
    valid_symbols[ERE_ESCAPE_START]
  ) {
    lexer->result_symbol = ERE_ESCAPE_START;
    return true;
  }
  return false;
}

static bool is_ere_compound_punctuation(int32_t character) {
  switch (character) {
  case '.':
  case '=':
  case ':':
    return true;
  default:
    return false;
  }
}

typedef struct {
  enum TokenType guard;
  int32_t opening;
} EreCompoundGuard;

static const EreCompoundGuard ERE_COMPOUND_GUARDS[] = {
  {ERE_COMPOUND_OPEN_GUARD, '['},
  {ERE_DOT_CLOSE_GUARD, '.'},
  {ERE_EQUAL_CLOSE_GUARD, '='},
  {ERE_COLON_CLOSE_GUARD, ':'},
};

static bool scan_ere_compound_guard(TSLexer *lexer, enum TokenType guard) {
  lexer->advance(lexer, false);
  const bool matches = guard == ERE_COMPOUND_OPEN_GUARD
    ? is_ere_compound_punctuation(lexer->lookahead)
    : lexer->lookahead == ']';
  if (!matches) {
    return false;
  }
  lexer->result_symbol = guard;
  return true;
}

static bool advance_boundary_gap_remainder(TSLexer *lexer) {
  for (;;) {
    while (is_ascii_blank(lexer->lookahead)) {
      lexer->advance(lexer, false);
    }

    if (lexer->lookahead != '\\') {
      return true;
    }
    if (!advance_line_continuations(lexer)) {
      return false;
    }
  }
}

static bool word_starts_simple_statement(WordKind kind) {
  switch (kind) {
  case WORD_KIND_PRINT:
  case WORD_KIND_PRINTF:
  case WORD_KIND_DELETE:
    return true;
  default:
    return word_starts_expression(kind);
  }
}

static bool advance_comment_to_boundary(TSLexer *lexer) {
  if (lexer->lookahead != '#') {
    return false;
  }
  do {
    lexer->advance(lexer, false);
  } while (lexer->lookahead != '\n' && !lexer->eof(lexer));
  return true;
}

static bool scan_boundary_target(TSLexer *lexer, const bool *valid_symbols) {
  const bool expression_valid = valid_symbols[LC_BEFORE_EXPRESSION];
  enum TokenType delimiter;
  switch (lexer->lookahead) {
  case ',':
    delimiter = LC_BEFORE_COMMA;
    break;
  case '[':
    delimiter = LC_BEFORE_OPEN_BRACKET;
    break;
  case '(':
    delimiter = LC_BEFORE_CALL_PARENTHESIS;
    break;
  case ')':
    delimiter = LC_BEFORE_CLOSE_PARENTHESIS;
    break;
  case ']':
    delimiter = LC_BEFORE_CLOSE_BRACKET;
    break;
  case ';':
    delimiter = LC_BEFORE_FOR_SEMICOLON;
    break;
  default:
    delimiter = ERROR_SENTINEL;
    break;
  }
  if (delimiter != ERROR_SENTINEL && valid_symbols[delimiter]) {
    lexer->result_symbol = delimiter;
    return true;
  }

  if (is_word_start(lexer->lookahead)) {
    const WordKind kind = scan_word_kind(lexer);
    if (kind == WORD_KIND_ELSE && valid_symbols[LC_BEFORE_ELSE]) {
      lexer->result_symbol = LC_BEFORE_ELSE;
      return true;
    }
    if (valid_symbols[LC_BEFORE_DO_TAIL] && kind == WORD_KIND_WHILE) {
      lexer->result_symbol = LC_BEFORE_DO_TAIL;
      return true;
    }
    if (kind == WORD_KIND_IN && valid_symbols[LC_BEFORE_MEMBERSHIP_OPERATOR]) {
      lexer->result_symbol = LC_BEFORE_MEMBERSHIP_OPERATOR;
      return true;
    }
    if (
      valid_symbols[LC_BEFORE_FOR_UPDATE] && word_starts_simple_statement(kind)
    ) {
      lexer->result_symbol = LC_BEFORE_FOR_UPDATE;
      return true;
    }
    if (word_starts_expression(kind) && expression_valid) {
      lexer->result_symbol = LC_BEFORE_EXPRESSION;
      return true;
    }
    return false;
  }

  if (is_ascii_digit(lexer->lookahead) || lexer->lookahead == '.') {
    if (scan_number_kind(lexer) == NUMBER_KIND_NONE) {
      return false;
    }
    if (valid_symbols[LC_BEFORE_FOR_UPDATE]) {
      lexer->result_symbol = LC_BEFORE_FOR_UPDATE;
      return true;
    }
    if (expression_valid) {
      lexer->result_symbol = LC_BEFORE_EXPRESSION;
      return true;
    }
    return false;
  }

  const int32_t first = lexer->lookahead;
  int32_t second = 0;
  if (is_composite_operator_start(first)) {
    lexer->advance(lexer, false);
    second = lexer->lookahead;
  }

  enum TokenType marker = ERROR_SENTINEL;
  switch (first) {
  case '/':
    marker =
      second == '=' ? LC_BEFORE_OPERATOR : LC_BEFORE_MULTIPLICATIVE_OPERATOR;
    break;
  case '+':
    marker = second == '=' || second == '+' ? LC_BEFORE_OPERATOR
                                            : LC_BEFORE_ADDITIVE_OPERATOR;
    break;
  case '-':
    marker = second == '=' || second == '-' ? LC_BEFORE_OPERATOR
                                            : LC_BEFORE_ADDITIVE_OPERATOR;
    break;
  case '*':
  case '%':
    marker =
      second == '=' ? LC_BEFORE_OPERATOR : LC_BEFORE_MULTIPLICATIVE_OPERATOR;
    break;
  case '^':
    marker =
      second == '=' ? LC_BEFORE_OPERATOR : LC_BEFORE_EXPONENTIATION_OPERATOR;
    break;
  case '!':
    if (second == '=') {
      marker = LC_BEFORE_COMPARISON_OPERATOR;
    } else if (second == '~') {
      marker = LC_BEFORE_MATCH_OPERATOR;
    }
    break;
  case '=':
    marker = second == '=' ? LC_BEFORE_COMPARISON_OPERATOR : LC_BEFORE_OPERATOR;
    break;
  case '<':
    marker =
      second == '=' ? LC_BEFORE_COMPARISON_OPERATOR : LC_BEFORE_LESS_THAN;
    break;
  case '>':
    if (second == '>') {
      marker = LC_BEFORE_OUTPUT_REDIRECTION;
    } else if (second == '=') {
      marker = LC_BEFORE_COMPARISON_OPERATOR;
    } else {
      marker = valid_symbols[LC_BEFORE_OUTPUT_REDIRECTION]
        ? LC_BEFORE_OUTPUT_REDIRECTION
        : LC_BEFORE_COMPARISON_OPERATOR;
    }
    break;
  case '~':
    marker = LC_BEFORE_MATCH_OPERATOR;
    break;
  case '|':
    marker = second == '|' ? LC_BEFORE_LOGICAL_OR_OPERATOR
      : valid_symbols[LC_BEFORE_OUTPUT_REDIRECTION]
      ? LC_BEFORE_OUTPUT_REDIRECTION
      : LC_BEFORE_INPUT_PIPE;
    break;
  case '&':
    if (second == '&') {
      marker = LC_BEFORE_LOGICAL_AND_OPERATOR;
    }
    break;
  case '?':
    marker = LC_BEFORE_CONDITIONAL_QUESTION;
    break;
  case ':':
    marker = LC_BEFORE_CONDITIONAL_COLON;
    break;
  default:
    break;
  }

  if (marker != ERROR_SENTINEL && valid_symbols[marker]) {
    lexer->result_symbol = marker;
    return true;
  }

  if (
    valid_symbols[LC_BEFORE_FOR_UPDATE] && character_starts_expression(first)
  ) {
    lexer->result_symbol = LC_BEFORE_FOR_UPDATE;
    return true;
  }

  if (expression_valid && character_starts_expression(first)) {
    lexer->result_symbol = LC_BEFORE_EXPRESSION;
    return true;
  }

  return false;
}

static bool has_line_continuation_marker(const bool *valid_symbols) {
  for (
    enum TokenType token = LC_BEFORE_OPERATOR; token <= LC_BEFORE_CLOSE_BRACKET;
    token++
  ) {
    if (valid_symbols[token]) {
      return true;
    }
  }
  return false;
}

static bool
scan_line_continuation_marker(TSLexer *lexer, const bool *valid_symbols) {
  if (
    !advance_line_continuations(lexer) || !advance_boundary_gap_remainder(lexer)
  ) {
    return false;
  }

  return scan_boundary_target(lexer, valid_symbols);
}

void *tree_sitter_awk_external_scanner_create(void) {
  return calloc(1, sizeof(ScannerState));
}

void tree_sitter_awk_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned
tree_sitter_awk_external_scanner_serialize(void *payload, char *buffer) {
  const ScannerState *state = payload;
  if (state->ere_mode == ERE_MODE_OUTSIDE) {
    return 0;
  }
  buffer[0] = (char)state->ere_mode;
  return SERIALIZED_SCANNER_STATE_SIZE;
}

void tree_sitter_awk_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  ScannerState *state = payload;
  state->ere_mode = ERE_MODE_OUTSIDE;
  if (length == SERIALIZED_SCANNER_STATE_SIZE) {
    const unsigned char mode = (unsigned char)buffer[0];
    if (mode <= ERE_MODE_ESCAPED_DELIMITER) {
      state->ere_mode = (EreMode)mode;
    }
  }
}

static bool scan_ere_context(
  ScannerState *state,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  lexer->mark_end(lexer);

  const bool at_ere_end = lexer->lookahead == '\n' || lexer->eof(lexer);
  if (at_ere_end && valid_symbols[ERE_LEXICAL_END]) {
    lexer->result_symbol = ERE_LEXICAL_END;
    state->ere_mode = ERE_MODE_OUTSIDE;
    return true;
  }

  if (state->ere_mode == ERE_MODE_ESCAPED_DELIMITER) {
    if (lexer->lookahead == '/' && valid_symbols[ERE_ESCAPED_DELIMITER_END]) {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      lexer->result_symbol = ERE_ESCAPED_DELIMITER_END;
      state->ere_mode = ERE_MODE_BODY;
      return true;
    }
    return scan_ere_backslash_context(state, lexer, valid_symbols);
  }

  if (!valid_symbols[ERROR_SENTINEL]) {
    for (size_t i = 0; i < ARRAY_LENGTH(ERE_COMPOUND_GUARDS); i++) {
      if (
        valid_symbols[ERE_COMPOUND_GUARDS[i].guard] &&
        lexer->lookahead == ERE_COMPOUND_GUARDS[i].opening
      ) {
        return scan_ere_compound_guard(lexer, ERE_COMPOUND_GUARDS[i].guard);
      }
    }
  }

  if (lexer->lookahead == '/' && valid_symbols[ERE_CLOSING]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = ERE_CLOSING;
    state->ere_mode = ERE_MODE_OUTSIDE;
    return true;
  }

  return scan_ere_backslash_context(state, lexer, valid_symbols);
}

static bool has_number_marker(const bool *valid_symbols) {
  return valid_symbols[NUMBER_INTEGER] ||
    valid_symbols[NUMBER_FRACTION] ||
    valid_symbols[NUMBER_EXPONENT];
}

static bool scan_word_or_item_boundary(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool allow_item_boundary
) {
  const bool word_marker_is_valid = has_word_marker(valid_symbols);
  if (
    !is_word_start(lexer->lookahead) ||
    (!word_marker_is_valid &&
      (!allow_item_boundary ||
        (!valid_symbols[CLOSED_ITEM_BOUNDARY] &&
          !valid_symbols[NORMAL_PATTERN_ITEM_BOUNDARY])))
  ) {
    return false;
  }

  const WordKind kind = scan_word_spelling(lexer);
  if (
    allow_item_boundary && emit_word_item_boundary(lexer, valid_symbols, kind)
  ) {
    return true;
  }
  if (!word_marker_is_valid) {
    return false;
  }

  return scan_word_token(lexer, valid_symbols, kind);
}

static bool scan_number_or_item_boundary(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool allow_item_boundary
) {
  const bool number_marker_is_valid = has_number_marker(valid_symbols);
  const bool item_boundary_is_valid =
    allow_item_boundary && valid_symbols[CLOSED_ITEM_BOUNDARY];
  if (
    (!is_ascii_digit(lexer->lookahead) && lexer->lookahead != '.') ||
    (!number_marker_is_valid && !item_boundary_is_valid)
  ) {
    return false;
  }

  NumberKind token_kind = NUMBER_KIND_NONE;
  const NumberKind kind = scan_number_kind_with_end(
    lexer,
    item_boundary_is_valid ? NULL : valid_symbols,
    &token_kind
  );
  if (kind == NUMBER_KIND_NONE) {
    return false;
  }
  if (item_boundary_is_valid) {
    lexer->result_symbol = CLOSED_ITEM_BOUNDARY;
    return true;
  }
  return emit_number_kind(lexer, valid_symbols, token_kind);
}

bool tree_sitter_awk_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  ScannerState *state = payload;

  if (
    state->ere_mode !=
    ERE_MODE_OUTSIDE &&
    scan_ere_context(state, lexer, valid_symbols)
  ) {
    return true;
  }

  if (valid_symbols[ERROR_SENTINEL]) {
    if (state->ere_mode == ERE_MODE_OUTSIDE) {
      skip_ascii_blanks(lexer);
      lexer->mark_end(lexer);
      if (is_word_start(lexer->lookahead)) {
        return scan_word_or_item_boundary(lexer, valid_symbols, false);
      }
      if (is_ascii_digit(lexer->lookahead) || lexer->lookahead == '.') {
        return scan_number_or_item_boundary(lexer, valid_symbols, false);
      }
      if (lexer->lookahead == '/') {
        return scan_slash_start(state, lexer, valid_symbols, true);
      }
      if (lexer->lookahead == '>' && has_greater_start(valid_symbols, false)) {
        return scan_greater_start(lexer, valid_symbols, false);
      }
      if (has_valid_composite_operator_start(lexer->lookahead, valid_symbols)) {
        return scan_composite_operator_start(lexer, valid_symbols);
      }
    }
    return false;
  }

  if (state->ere_mode != ERE_MODE_OUTSIDE) {
    return false;
  }

  skip_ascii_blanks(lexer);
  lexer->mark_end(lexer);

  if (
    lexer->lookahead ==
    '\n' &&
    (valid_symbols[ACTION_TARGET_GUARD] ||
      valid_symbols[EXPRESSION_TARGET_GUARD] ||
      valid_symbols[PRINT_EXPRESSION_TARGET_GUARD] ||
      valid_symbols[PARAMETER_TARGET_GUARD])
  ) {
    return scan_required_target_guard(lexer, valid_symbols);
  }

  if (
    valid_symbols[CLOSED_ITEM_BOUNDARY] &&
    character_starts_item(lexer->lookahead)
  ) {
    lexer->result_symbol = CLOSED_ITEM_BOUNDARY;
    return true;
  }

  if (lexer->lookahead == '\\' && has_line_continuation_marker(valid_symbols)) {
    return scan_line_continuation_marker(lexer, valid_symbols);
  }

  if (is_word_start(lexer->lookahead)) {
    return scan_word_or_item_boundary(lexer, valid_symbols, true);
  }

  if (is_ascii_digit(lexer->lookahead) || lexer->lookahead == '.') {
    return scan_number_or_item_boundary(lexer, valid_symbols, true);
  }

  if (
    lexer->lookahead ==
    '/' &&
    (valid_symbols[DIVISION_SLASH] ||
      valid_symbols[ERE_OPENING_SLASH] ||
      valid_symbols[DIV_ASSIGN_OPERATOR])
  ) {
    return scan_slash_start(state, lexer, valid_symbols, false);
  }

  if (lexer->lookahead == '>' && has_greater_start(valid_symbols, true)) {
    return scan_greater_start(lexer, valid_symbols, true);
  }

  if (has_valid_composite_operator_start(lexer->lookahead, valid_symbols)) {
    return scan_composite_operator_start(lexer, valid_symbols);
  }

  return false;
}
