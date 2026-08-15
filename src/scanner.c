#include "tree_sitter/parser.h"

#include <stddef.h>
#include <stdlib.h>
#include <string.h>

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
  NUMBER_FRACTION_DIGITS,
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
  LC_BEFORE_CLOSER_RECOVERY,
  LC_BEFORE_TERMINATOR_RECOVERY,
  LC_BEFORE_EXPRESSION,
  LC_BEFORE_COMMA,
  LC_BEFORE_OPEN_BRACKET,
  LC_BEFORE_CLOSE_PARENTHESIS,
  LC_BEFORE_CLOSE_BRACKET,
  LC_BEFORE_ACTION_EOF,
  EXPRESSION_RECOVERY,
  RANGE_RIGHT_EXPRESSION_RECOVERY,
  LIST_EXPRESSION_RECOVERY,
  PRINT_EXPRESSION_RECOVERY,
  PARAMETER_RECOVERY,
  FUNCTION_BODY_RECOVERY,
  STATEMENT_RECOVERY,
  TERMINATOR_RECOVERY,
  CLOSED_ITEM_TERMINATOR_RECOVERY,
  NORMAL_ITEM_TERMINATOR_RECOVERY,
  ACTION_EMPTY_SEMICOLON_ITEM_BOUNDARY_GUARD,
  ACTION_CLOSE_ITEM_BOUNDARY_GUARD,
  ACTION_ITEM_BOUNDARY_RECOVERY,
  STRING_LONE_ESCAPE,
  STRING_END_BOUNDARY,
  ERE_COMPOUND_OPEN_GUARD,
  ERE_DOT_CLOSE_GUARD,
  ERE_EQUAL_CLOSE_GUARD,
  ERE_COLON_CLOSE_GUARD,
  ERE_GROUP_EXPRESSION_RECOVERY,
  ERE_ESCAPE_START,
  ERE_ESCAPED_DELIMITER_START,
  ERE_ESCAPED_DELIMITER_END,
  ERE_LONE_ESCAPE,
  ERE_COMPOUND_BOUNDARY,
  ERE_INNER_SLASH_BOUNDARY,
  ERE_INNER_END_BOUNDARY,
  ERE_END_BOUNDARY,
  ERE_CLOSING,
  CLOSE_PARENTHESIS_RECOVERY,
  CLOSE_BRACKET_RECOVERY,
  ACTION_EOF_RECOVERY,
  EXPRESSION_TARGET_GUARD,
  PRINT_EXPRESSION_TARGET_GUARD,
  ACTION_TARGET_GUARD,
  PARAMETER_TARGET_GUARD,
  ERROR_SENTINEL,
  DO_TAIL_RECOVERY,
  TOKEN_TYPE_COUNT,
};

enum {
  MAX_RESERVED_WORD_LENGTH = 8,
  SERIALIZED_SCANNER_STATE_SIZE = 1,
};

_Static_assert(
  SERIALIZED_SCANNER_STATE_SIZE <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE,
  "serialized scanner state must fit in Tree-sitter's buffer"
);

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
  WORD_ROLE_STATEMENT_START = 1U << 1,
  WORD_ROLE_STATEMENT_RECOVERY_BOUNDARY = 1U << 2,
  WORD_ROLE_ITEM_START = 1U << 3,
  WORD_ROLE_RESERVED_ITEM_START = 1U << 4,
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
  {WORD_KIND_PRINT, PRINT_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_BREAK, BREAK_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_CONTINUE, CONTINUE_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_DELETE, DELETE_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_DO, DO_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_ELSE, ELSE_WORD, WORD_ROLE_STATEMENT_RECOVERY_BOUNDARY},
  {WORD_KIND_EXIT, EXIT_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_FOR, FOR_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_IF, IF_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_NEXT, NEXT_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_NEXTFILE, NEXTFILE_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_PRINTF, PRINTF_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_RETURN, RETURN_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_WHILE, WHILE_WORD, WORD_ROLE_STATEMENT_START},
  {WORD_KIND_NAME,
    NAME_WORD,
    WORD_ROLE_EXPRESSION_START |
      WORD_ROLE_STATEMENT_START |
      WORD_ROLE_ITEM_START},
  {WORD_KIND_GETLINE,
    GETLINE_WORD,
    WORD_ROLE_EXPRESSION_START |
      WORD_ROLE_STATEMENT_START |
      WORD_ROLE_ITEM_START},
  {WORD_KIND_IN, IN_WORD, 0},
  {WORD_KIND_BUILTIN_FUNC_NAME,
    BUILTIN_FUNC_NAME_WORD,
    WORD_ROLE_EXPRESSION_START |
      WORD_ROLE_STATEMENT_START |
      WORD_ROLE_ITEM_START},
  {WORD_KIND_FUNC_NAME,
    FUNC_NAME_WORD,
    WORD_ROLE_EXPRESSION_START |
      WORD_ROLE_STATEMENT_START |
      WORD_ROLE_ITEM_START},
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
  return character ==
    '"' ||
    character ==
    '(' ||
    character ==
    '$' ||
    character ==
    '+' ||
    character ==
    '-' ||
    character ==
    '/' ||
    character == '!';
}

static bool character_starts_statement(int32_t character) {
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

static bool skip_ascii_blanks(TSLexer *lexer) {
  bool found = false;

  while (is_ascii_blank(lexer->lookahead)) {
    lexer->advance(lexer, true);
    found = true;
  }

  return found;
}

static bool advance_comment_to_boundary(TSLexer *lexer);

static bool advance_layout_gap(TSLexer *lexer) {
  for (;;) {
    (void)skip_ascii_blanks(lexer);
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

  for (size_t i = 0; i < sizeof(WORDS) / sizeof(WORDS[0]); i++) {
    if (
      strlen(WORDS[i].spelling) ==
      length &&
      memcmp(WORDS[i].spelling, word, length) == 0
    ) {
      return WORDS[i].kind;
    }
  }

  return WORD_KIND_NAME;
}

static WordKind scan_word_kind(TSLexer *lexer) {
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

  const WordKind kind = classify_word(word, length);
  if (kind != WORD_KIND_NAME) {
    return kind;
  }

  if (lexer->lookahead == '\\' && !advance_line_continuations(lexer)) {
    return kind;
  }
  return lexer->lookahead == '(' ? WORD_KIND_FUNC_NAME : kind;
}

static bool
emit_word_kind(TSLexer *lexer, const bool *valid_symbols, WordKind kind) {
  for (size_t i = 0; i < sizeof(WORD_TOKENS) / sizeof(WORD_TOKENS[0]); i++) {
    if (WORD_TOKENS[i].kind == kind && valid_symbols[WORD_TOKENS[i].token]) {
      lexer->result_symbol = WORD_TOKENS[i].token;
      return true;
    }
  }

  return false;
}

static bool has_word_marker(const bool *valid_symbols) {
  for (size_t i = 0; i < sizeof(WORD_TOKENS) / sizeof(WORD_TOKENS[0]); i++) {
    if (valid_symbols[WORD_TOKENS[i].token]) {
      return true;
    }
  }
  return false;
}

static bool word_has_role(WordKind kind, WordRole role) {
  for (size_t i = 0; i < sizeof(WORD_TOKENS) / sizeof(WORD_TOKENS[0]); i++) {
    if (WORD_TOKENS[i].kind == kind && (WORD_TOKENS[i].roles & role) != 0) {
      return true;
    }
  }
  return false;
}

static bool word_starts_expression(WordKind kind) {
  return word_has_role(kind, WORD_ROLE_EXPRESSION_START);
}

static bool word_starts_print_expression(WordKind kind) {
  return kind != WORD_KIND_GETLINE && word_starts_expression(kind);
}

static bool word_is_statement_recovery_boundary(WordKind kind) {
  return word_has_role(kind, WORD_ROLE_STATEMENT_RECOVERY_BOUNDARY) ||
    word_has_role(kind, WORD_ROLE_RESERVED_ITEM_START);
}

static bool word_is_do_tail_recovery_boundary(WordKind kind) {
  return kind !=
    WORD_KIND_WHILE &&
    (word_has_role(kind, WORD_ROLE_STATEMENT_START) ||
      word_is_statement_recovery_boundary(kind));
}

static NumberKind scan_number_kind(TSLexer *lexer) {
  enum {
    STATE_START,
    STATE_INTEGER,
    STATE_LEADING_DOT,
    STATE_FRACTION,
    STATE_EXPONENT_MARK,
    STATE_EXPONENT_SIGN,
    STATE_EXPONENT_DIGITS,
  } state = STATE_START;
  NumberKind accepted = NUMBER_KIND_NONE;

  for (;;) {
    switch (state) {
    case STATE_START:
      if (is_ascii_digit(lexer->lookahead)) {
        lexer->advance(lexer, false);
        state = STATE_INTEGER;
        accepted = NUMBER_KIND_INTEGER;
        continue;
      }
      if (lexer->lookahead == '.') {
        lexer->advance(lexer, false);
        state = STATE_LEADING_DOT;
        continue;
      }
      return accepted;

    case STATE_INTEGER:
      if (is_ascii_digit(lexer->lookahead)) {
        lexer->advance(lexer, false);
        continue;
      }
      if (lexer->lookahead == '.') {
        lexer->advance(lexer, false);
        state = STATE_FRACTION;
        accepted = NUMBER_KIND_FRACTION;
        continue;
      }
      if (lexer->lookahead == 'e' || lexer->lookahead == 'E') {
        lexer->advance(lexer, false);
        state = STATE_EXPONENT_MARK;
        continue;
      }
      return accepted;

    case STATE_LEADING_DOT:
      if (!is_ascii_digit(lexer->lookahead)) {
        return accepted;
      }
      lexer->advance(lexer, false);
      state = STATE_FRACTION;
      accepted = NUMBER_KIND_FRACTION;
      continue;

    case STATE_FRACTION:
      if (is_ascii_digit(lexer->lookahead)) {
        lexer->advance(lexer, false);
        continue;
      }
      if (lexer->lookahead == 'e' || lexer->lookahead == 'E') {
        lexer->advance(lexer, false);
        state = STATE_EXPONENT_MARK;
        continue;
      }
      return accepted;

    case STATE_EXPONENT_MARK:
      if (lexer->lookahead == '+' || lexer->lookahead == '-') {
        lexer->advance(lexer, false);
        state = STATE_EXPONENT_SIGN;
        continue;
      }
      if (is_ascii_digit(lexer->lookahead)) {
        lexer->advance(lexer, false);
        state = STATE_EXPONENT_DIGITS;
        accepted = NUMBER_KIND_EXPONENT;
        continue;
      }
      return accepted;

    case STATE_EXPONENT_SIGN:
      if (!is_ascii_digit(lexer->lookahead)) {
        return accepted;
      }
      lexer->advance(lexer, false);
      state = STATE_EXPONENT_DIGITS;
      accepted = NUMBER_KIND_EXPONENT;
      continue;

    case STATE_EXPONENT_DIGITS:
      if (!is_ascii_digit(lexer->lookahead)) {
        return accepted;
      }
      lexer->advance(lexer, false);
      continue;
    }
  }
}

static bool scan_number_start(TSLexer *lexer) {
  if (is_ascii_digit(lexer->lookahead)) {
    return true;
  }
  return lexer->lookahead == '.' && scan_number_kind(lexer) != NUMBER_KIND_NONE;
}

static bool
emit_number_kind(TSLexer *lexer, const bool *valid_symbols, NumberKind kind) {
  switch (kind) {
  case NUMBER_KIND_INTEGER:
    if (valid_symbols[NUMBER_INTEGER]) {
      lexer->result_symbol = NUMBER_INTEGER;
      return true;
    }
    return false;

  case NUMBER_KIND_FRACTION:
    if (valid_symbols[NUMBER_FRACTION]) {
      lexer->result_symbol = NUMBER_FRACTION;
      return true;
    }
    return false;

  case NUMBER_KIND_EXPONENT:
    if (valid_symbols[NUMBER_EXPONENT]) {
      lexer->result_symbol = NUMBER_EXPONENT;
      return true;
    }
    return false;

  case NUMBER_KIND_NONE:
    return false;
  }

  return false;
}

static bool
has_valid_composite_operator_start(int32_t first, const bool *valid_symbols) {
  for (
    size_t i = 0;
    i < sizeof(COMPOSITE_OPERATORS) / sizeof(COMPOSITE_OPERATORS[0]);
    i++
  ) {
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
  for (
    size_t i = 0;
    i < sizeof(COMPOSITE_OPERATORS) / sizeof(COMPOSITE_OPERATORS[0]);
    i++
  ) {
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
  for (
    size_t i = 0;
    i < sizeof(COMPOSITE_OPERATORS) / sizeof(COMPOSITE_OPERATORS[0]);
    i++
  ) {
    if (COMPOSITE_OPERATORS[i].first == first) {
      return true;
    }
  }
  return false;
}

static bool
scan_composite_operator_start(TSLexer *lexer, const bool *valid_symbols) {
  const int32_t first = lexer->lookahead;
  if (!has_valid_composite_operator_start(first, valid_symbols)) {
    return false;
  }

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

static bool scan_output_greater_boundary(TSLexer *lexer) {
  if (lexer->lookahead != '>') {
    return false;
  }

  lexer->advance(lexer, false);
  const CompositeOperator *composite =
    find_composite_operator('>', lexer->lookahead);
  if (composite == NULL) {
    return true;
  }
  return composite->token == APPEND_OPERATOR;
}

static bool scan_print_output_boundary(TSLexer *lexer) {
  if (lexer->lookahead == '>') {
    return scan_output_greater_boundary(lexer);
  }
  if (lexer->lookahead != '|') {
    return false;
  }

  lexer->advance(lexer, false);
  return find_composite_operator('|', lexer->lookahead) == NULL;
}

static bool
scan_output_greater_guard(TSLexer *lexer, const bool *valid_symbols) {
  if (
    !valid_symbols[OUTPUT_GREATER_GUARD] ||
    lexer->lookahead !=
    '>' ||
    !scan_output_greater_boundary(lexer)
  ) {
    return false;
  }
  lexer->result_symbol = OUTPUT_GREATER_GUARD;
  return true;
}

static bool scan_slash_start(
  ScannerState *state,
  TSLexer *lexer,
  const bool *valid_symbols,
  bool allow_ere
) {
  if (lexer->lookahead != '/') {
    return false;
  }

  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->lookahead == '=' && valid_symbols[DIV_ASSIGN_OPERATOR]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = DIV_ASSIGN_OPERATOR;
    return true;
  }
  if (valid_symbols[DIVISION_SLASH]) {
    lexer->result_symbol = DIVISION_SLASH;
    return true;
  }
  if (allow_ere && valid_symbols[ERE_OPENING_SLASH]) {
    lexer->result_symbol = ERE_OPENING_SLASH;
    state->ere_mode = ERE_MODE_BODY;
    return true;
  }
  return false;
}

static bool
scan_expression_recovery(TSLexer *lexer, const bool *valid_symbols) {
  if (
    !valid_symbols[EXPRESSION_RECOVERY] &&
    !valid_symbols[LIST_EXPRESSION_RECOVERY]
  ) {
    return false;
  }

  if (valid_symbols[LIST_EXPRESSION_RECOVERY] && lexer->lookahead == ',') {
    lexer->result_symbol = LIST_EXPRESSION_RECOVERY;
    return true;
  }
  if (!valid_symbols[EXPRESSION_RECOVERY]) {
    return false;
  }

  switch (lexer->lookahead) {
  case ')':
  case ']':
  case ',':
  case ':':
  case ';':
  case '}':
  case '\n':
    lexer->result_symbol = EXPRESSION_RECOVERY;
    return true;
  default:
    if (lexer->eof(lexer)) {
      lexer->result_symbol = EXPRESSION_RECOVERY;
      return true;
    }
    return false;
  }
}

static bool emit_range_right_expression_recovery(
  TSLexer *lexer,
  const bool *valid_symbols
) {
  if (!valid_symbols[RANGE_RIGHT_EXPRESSION_RECOVERY]) {
    return false;
  }
  if (lexer->lookahead == '{') {
    lexer->result_symbol = RANGE_RIGHT_EXPRESSION_RECOVERY;
    return true;
  }
  return false;
}

static bool word_is_unambiguous_statement_boundary(WordKind kind) {
  return !word_has_role(kind, WORD_ROLE_EXPRESSION_START) &&
    (word_has_role(kind, WORD_ROLE_STATEMENT_START) ||
      word_is_statement_recovery_boundary(kind));
}

static bool character_is_do_tail_recovery_boundary(int32_t character) {
  return character ==
    ';' ||
    character ==
    '}' ||
    character_starts_statement(character);
}

static bool is_closer_recovery_punctuation(int32_t character) {
  switch (character) {
  case ';':
  case '\n':
  case '{':
  case '}':
    return true;
  default:
    return false;
  }
}

static bool emit_closer_recovery(TSLexer *lexer, const bool *valid_symbols) {
  const bool parenthesis_valid = valid_symbols[CLOSE_PARENTHESIS_RECOVERY];
  const bool bracket_valid = valid_symbols[CLOSE_BRACKET_RECOVERY];
  if (!parenthesis_valid && !bracket_valid) {
    return false;
  }

  enum TokenType recovery;
  if (lexer->lookahead == ')') {
    if (!bracket_valid || parenthesis_valid) {
      return false;
    }
    recovery = CLOSE_BRACKET_RECOVERY;
  } else if (lexer->lookahead == ']') {
    if (!parenthesis_valid || bracket_valid) {
      return false;
    }
    recovery = CLOSE_PARENTHESIS_RECOVERY;
  } else {
    if (
      !is_closer_recovery_punctuation(lexer->lookahead) && !lexer->eof(lexer)
    ) {
      return false;
    }
    recovery =
      parenthesis_valid ? CLOSE_PARENTHESIS_RECOVERY : CLOSE_BRACKET_RECOVERY;
  }

  lexer->result_symbol = recovery;
  return true;
}

static bool emit_word_closer_recovery(
  TSLexer *lexer,
  const bool *valid_symbols,
  WordKind kind
) {
  if (!word_is_unambiguous_statement_boundary(kind)) {
    return false;
  }
  if (valid_symbols[CLOSE_PARENTHESIS_RECOVERY]) {
    lexer->result_symbol = CLOSE_PARENTHESIS_RECOVERY;
    return true;
  }
  if (valid_symbols[CLOSE_BRACKET_RECOVERY]) {
    lexer->result_symbol = CLOSE_BRACKET_RECOVERY;
    return true;
  }
  return false;
}

static bool emit_word_required_recovery(
  TSLexer *lexer,
  const bool *valid_symbols,
  WordKind kind
) {
  if (
    valid_symbols[STATEMENT_RECOVERY] &&
    word_is_statement_recovery_boundary(kind)
  ) {
    lexer->result_symbol = STATEMENT_RECOVERY;
    return true;
  }
  if (
    valid_symbols[DO_TAIL_RECOVERY] && word_is_do_tail_recovery_boundary(kind)
  ) {
    lexer->result_symbol = DO_TAIL_RECOVERY;
    return true;
  }
  return false;
}

static bool emit_word_terminator_recovery(
  TSLexer *lexer,
  const bool *valid_symbols,
  WordKind kind
) {
  if (
    valid_symbols[TERMINATOR_RECOVERY] &&
    (word_has_role(kind, WORD_ROLE_STATEMENT_START) ||
      word_has_role(kind, WORD_ROLE_STATEMENT_RECOVERY_BOUNDARY))
  ) {
    lexer->result_symbol = TERMINATOR_RECOVERY;
    return true;
  }
  return false;
}

static bool
emit_terminator_recovery(TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[TERMINATOR_RECOVERY]) {
    lexer->result_symbol = TERMINATOR_RECOVERY;
    return true;
  }
  return false;
}

static bool emit_word_structural_boundary(
  TSLexer *lexer,
  const bool *valid_symbols,
  WordKind kind
) {
  const bool reserved_item_start =
    word_has_role(kind, WORD_ROLE_RESERVED_ITEM_START);
  if (reserved_item_start && valid_symbols[ACTION_ITEM_BOUNDARY_RECOVERY]) {
    lexer->result_symbol = ACTION_ITEM_BOUNDARY_RECOVERY;
    return true;
  }
  if (reserved_item_start && valid_symbols[RANGE_RIGHT_EXPRESSION_RECOVERY]) {
    lexer->result_symbol = RANGE_RIGHT_EXPRESSION_RECOVERY;
    return true;
  }
  if (
    valid_symbols[CLOSED_ITEM_TERMINATOR_RECOVERY] &&
    word_has_role(kind, WORD_ROLE_ITEM_START)
  ) {
    lexer->result_symbol = CLOSED_ITEM_TERMINATOR_RECOVERY;
    return true;
  }
  if (reserved_item_start && valid_symbols[NORMAL_ITEM_TERMINATOR_RECOVERY]) {
    lexer->result_symbol = NORMAL_ITEM_TERMINATOR_RECOVERY;
    return true;
  }
  return false;
}

static bool emit_closed_item_terminator_recovery(
  TSLexer *lexer,
  const bool *valid_symbols
) {
  if (!valid_symbols[CLOSED_ITEM_TERMINATOR_RECOVERY]) {
    return false;
  }
  lexer->result_symbol = CLOSED_ITEM_TERMINATOR_RECOVERY;
  return true;
}

static bool scan_action_item_terminator_boundary(
  TSLexer *lexer,
  const bool *valid_symbols
) {
  const bool empty_semicolon_guard_valid =
    valid_symbols[ACTION_EMPTY_SEMICOLON_ITEM_BOUNDARY_GUARD];
  const bool close_guard_valid =
    valid_symbols[ACTION_CLOSE_ITEM_BOUNDARY_GUARD];
  const bool at_semicolon = lexer->lookahead == ';';
  if (
    (at_semicolon && !empty_semicolon_guard_valid && !close_guard_valid) ||
    (lexer->lookahead == '\n' && !close_guard_valid) ||
    (!at_semicolon && lexer->lookahead != '\n')
  ) {
    return false;
  }

  lexer->advance(lexer, false);
  if (!advance_layout_gap(lexer)) {
    return false;
  }

  if (!is_word_start(lexer->lookahead)) {
    return false;
  }
  const WordKind kind = scan_word_kind(lexer);
  if (!word_has_role(kind, WORD_ROLE_RESERVED_ITEM_START)) {
    return false;
  }
  lexer->result_symbol = at_semicolon && empty_semicolon_guard_valid
    ? ACTION_EMPTY_SEMICOLON_ITEM_BOUNDARY_GUARD
    : ACTION_CLOSE_ITEM_BOUNDARY_GUARD;
  return true;
}

static bool
emit_required_target_recovery(TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[PARAMETER_RECOVERY] && !valid_symbols[ERROR_SENTINEL]) {
    lexer->result_symbol = PARAMETER_RECOVERY;
    return true;
  }
  if (valid_symbols[FUNCTION_BODY_RECOVERY]) {
    lexer->result_symbol = FUNCTION_BODY_RECOVERY;
    return true;
  }
  if (valid_symbols[EXPRESSION_RECOVERY]) {
    lexer->result_symbol = EXPRESSION_RECOVERY;
    return true;
  }
  return false;
}

static bool
scan_required_target_guard(TSLexer *lexer, const bool *valid_symbols) {
  const bool at_newline = lexer->lookahead == '\n';
  if (at_newline) {
    lexer->advance(lexer, false);
    if (!advance_layout_gap(lexer)) {
      return emit_required_target_recovery(lexer, valid_symbols);
    }
  }
  if (
    at_newline && valid_symbols[ACTION_TARGET_GUARD] && lexer->lookahead == '{'
  ) {
    lexer->result_symbol = ACTION_TARGET_GUARD;
    return true;
  }

  if (
    at_newline &&
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
    at_newline &&
    (valid_symbols[EXPRESSION_TARGET_GUARD] ||
      valid_symbols[PRINT_EXPRESSION_TARGET_GUARD])
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

  return at_newline && emit_required_target_recovery(lexer, valid_symbols);
}

static bool scan_function_body_recovery(TSLexer *lexer) {
  switch (lexer->lookahead) {
  case ';':
  case '}':
  case '\n':
    lexer->result_symbol = FUNCTION_BODY_RECOVERY;
    return true;
  case '{':
    return false;
  default:
    if (lexer->eof(lexer)) {
      lexer->result_symbol = FUNCTION_BODY_RECOVERY;
      return true;
    }
    break;
  }

  if (is_word_start(lexer->lookahead)) {
    const WordKind kind = scan_word_kind(lexer);
    if (word_has_role(kind, WORD_ROLE_ITEM_START)) {
      lexer->result_symbol = FUNCTION_BODY_RECOVERY;
      return true;
    }
    return false;
  }
  const bool starts_expression = character_starts_expression(lexer->lookahead);
  if (starts_expression || scan_number_start(lexer)) {
    lexer->result_symbol = FUNCTION_BODY_RECOVERY;
    return true;
  }
  return false;
}

static bool
scan_parameter_recovery_or_word(TSLexer *lexer, const bool *valid_symbols) {
  switch (lexer->lookahead) {
  case ',':
  case ')':
  case '\n':
  case '{':
  case '}':
  case ';':
    lexer->result_symbol = PARAMETER_RECOVERY;
    return true;
  default:
    if (lexer->eof(lexer)) {
      lexer->result_symbol = PARAMETER_RECOVERY;
      return true;
    }
    break;
  }

  if (is_word_start(lexer->lookahead)) {
    const WordKind kind = scan_word_kind(lexer);
    if (kind == WORD_KIND_NAME) {
      return emit_word_kind(lexer, valid_symbols, kind);
    }
    if (word_has_role(kind, WORD_ROLE_RESERVED_ITEM_START)) {
      lexer->result_symbol = PARAMETER_RECOVERY;
      return true;
    }
  }
  return false;
}

static bool scan_string_lone_escape(TSLexer *lexer, const bool *valid_symbols) {
  if (!valid_symbols[STRING_LONE_ESCAPE] || lexer->lookahead != '\\') {
    return false;
  }

  lexer->advance(lexer, false);
  if (lexer->lookahead != '\n' && !lexer->eof(lexer)) {
    return false;
  }
  lexer->result_symbol = STRING_LONE_ESCAPE;
  return true;
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
  if (lexer->lookahead == '/' && valid_symbols[ERE_ESCAPED_DELIMITER_START]) {
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
  if (lexer->lookahead == '\n' || lexer->eof(lexer)) {
    if (!valid_symbols[ERROR_SENTINEL]) {
      if (valid_symbols[ERE_GROUP_EXPRESSION_RECOVERY]) {
        lexer->result_symbol = ERE_GROUP_EXPRESSION_RECOVERY;
        return true;
      }
      if (valid_symbols[ERE_COMPOUND_BOUNDARY]) {
        lexer->result_symbol = ERE_COMPOUND_BOUNDARY;
        return true;
      }
      if (valid_symbols[ERE_INNER_END_BOUNDARY]) {
        lexer->result_symbol = ERE_INNER_END_BOUNDARY;
        return true;
      }
    }
    if (valid_symbols[ERE_LONE_ESCAPE]) {
      lexer->result_symbol = ERE_LONE_ESCAPE;
      return true;
    }
  }
  return false;
}

static bool scan_ere_compound_guard(TSLexer *lexer, enum TokenType guard) {
  const int32_t opening = guard == ERE_COMPOUND_OPEN_GUARD ? '['
    : guard == ERE_DOT_CLOSE_GUARD                         ? '.'
    : guard == ERE_EQUAL_CLOSE_GUARD                       ? '='
                                                           : ':';
  if (lexer->lookahead != opening) {
    return false;
  }

  lexer->advance(lexer, false);
  const bool matches = guard == ERE_COMPOUND_OPEN_GUARD
    ? lexer->lookahead ==
      '.' ||
      lexer->lookahead ==
      '=' ||
      lexer->lookahead == ':'
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
  return word_starts_expression(kind) ||
    kind ==
    WORD_KIND_PRINT ||
    kind ==
    WORD_KIND_PRINTF ||
    kind == WORD_KIND_DELETE;
}

static bool is_line_continued_closer_recovery_boundary(TSLexer *lexer) {
  switch (lexer->lookahead) {
  case ')':
  case ']':
  case ';':
  case '\n':
  case '{':
  case '}':
    return true;
  default:
    return lexer->eof(lexer);
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

static bool scan_line_continued_closer_recovery_comment_boundary(
  TSLexer *lexer,
  const bool *valid_symbols
) {
  if (
    !valid_symbols[LC_BEFORE_CLOSER_RECOVERY] ||
    !advance_comment_to_boundary(lexer)
  ) {
    return false;
  }
  lexer->result_symbol = LC_BEFORE_CLOSER_RECOVERY;
  return true;
}

static bool scan_boundary_target(TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[LC_BEFORE_ACTION_EOF]) {
    advance_comment_to_boundary(lexer);
    if (lexer->eof(lexer)) {
      lexer->result_symbol = LC_BEFORE_ACTION_EOF;
      return true;
    }
  }

  const bool expression_valid = valid_symbols[LC_BEFORE_EXPRESSION];
  enum TokenType delimiter;
  switch (lexer->lookahead) {
  case ',':
    delimiter = LC_BEFORE_COMMA;
    break;
  case '[':
    delimiter = LC_BEFORE_OPEN_BRACKET;
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

  if (
    valid_symbols[LC_BEFORE_CLOSER_RECOVERY] &&
    is_line_continued_closer_recovery_boundary(lexer)
  ) {
    lexer->result_symbol = LC_BEFORE_CLOSER_RECOVERY;
    return true;
  }

  if (is_word_start(lexer->lookahead)) {
    const WordKind kind = scan_word_kind(lexer);
    if (kind == WORD_KIND_ELSE && valid_symbols[LC_BEFORE_ELSE]) {
      lexer->result_symbol = LC_BEFORE_ELSE;
      return true;
    }
    if (
      valid_symbols[LC_BEFORE_DO_TAIL] &&
      (kind == WORD_KIND_WHILE || word_is_do_tail_recovery_boundary(kind))
    ) {
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
    if (
      valid_symbols[LC_BEFORE_CLOSER_RECOVERY] &&
      word_is_unambiguous_statement_boundary(kind)
    ) {
      lexer->result_symbol = LC_BEFORE_CLOSER_RECOVERY;
      return true;
    }
    if (
      valid_symbols[LC_BEFORE_TERMINATOR_RECOVERY] &&
      (word_has_role(kind, WORD_ROLE_STATEMENT_START) ||
        word_has_role(kind, WORD_ROLE_STATEMENT_RECOVERY_BOUNDARY))
    ) {
      lexer->result_symbol = LC_BEFORE_TERMINATOR_RECOVERY;
      return true;
    }
    return false;
  }

  if (is_ascii_digit(lexer->lookahead) || lexer->lookahead == '.') {
    const NumberKind kind = scan_number_kind(lexer);
    if (kind != NUMBER_KIND_NONE && valid_symbols[LC_BEFORE_DO_TAIL]) {
      lexer->result_symbol = LC_BEFORE_DO_TAIL;
      return true;
    }
    if (kind != NUMBER_KIND_NONE && valid_symbols[LC_BEFORE_FOR_UPDATE]) {
      lexer->result_symbol = LC_BEFORE_FOR_UPDATE;
      return true;
    }
    if (
      kind !=
      NUMBER_KIND_NONE &&
      (expression_valid || valid_symbols[LC_BEFORE_TERMINATOR_RECOVERY])
    ) {
      lexer->result_symbol =
        expression_valid ? LC_BEFORE_EXPRESSION : LC_BEFORE_TERMINATOR_RECOVERY;
      return true;
    }
    return false;
  }

  const int32_t first = lexer->lookahead;
  if (
    valid_symbols[LC_BEFORE_DO_TAIL] &&
    (character_is_do_tail_recovery_boundary(first) || lexer->eof(lexer))
  ) {
    lexer->result_symbol = LC_BEFORE_DO_TAIL;
    return true;
  }
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

  if (
    expression_valid &&
    (first ==
      '"' ||
      first ==
      '(' ||
      first ==
      '$' ||
      first ==
      '+' ||
      first ==
      '-' ||
      first ==
      '/' ||
      first == '!')
  ) {
    lexer->result_symbol = LC_BEFORE_EXPRESSION;
    return true;
  }

  if (
    valid_symbols[LC_BEFORE_TERMINATOR_RECOVERY] &&
    character_starts_statement(first)
  ) {
    lexer->result_symbol = LC_BEFORE_TERMINATOR_RECOVERY;
    return true;
  }

  return false;
}

static bool has_line_continuation_marker(const bool *valid_symbols) {
  // The LC_BEFORE_* tokens form one contiguous enum range.
  for (
    enum TokenType token = LC_BEFORE_OPERATOR; token <= LC_BEFORE_ACTION_EOF;
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

  if (
    scan_line_continued_closer_recovery_comment_boundary(lexer, valid_symbols)
  ) {
    return true;
  }

  return scan_boundary_target(lexer, valid_symbols);
}

void *tree_sitter_posix_awk_external_scanner_create(void) {
  return calloc(1, sizeof(ScannerState));
}

void tree_sitter_posix_awk_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned
tree_sitter_posix_awk_external_scanner_serialize(void *payload, char *buffer) {
  const ScannerState *state = payload;
  if (state->ere_mode == ERE_MODE_OUTSIDE) {
    return 0;
  }
  buffer[0] = (char)state->ere_mode;
  return SERIALIZED_SCANNER_STATE_SIZE;
}

void tree_sitter_posix_awk_external_scanner_deserialize(
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
    if (
      valid_symbols[ERE_GROUP_EXPRESSION_RECOVERY] &&
      (lexer->lookahead ==
        ')' ||
        lexer->lookahead ==
        '/' ||
        lexer->lookahead ==
        '\n' ||
        lexer->eof(lexer))
    ) {
      lexer->result_symbol = ERE_GROUP_EXPRESSION_RECOVERY;
      return true;
    }
    if (valid_symbols[ERE_COMPOUND_OPEN_GUARD] && lexer->lookahead == '[') {
      return scan_ere_compound_guard(lexer, ERE_COMPOUND_OPEN_GUARD);
    }
    if (valid_symbols[ERE_DOT_CLOSE_GUARD] && lexer->lookahead == '.') {
      return scan_ere_compound_guard(lexer, ERE_DOT_CLOSE_GUARD);
    }
    if (valid_symbols[ERE_EQUAL_CLOSE_GUARD] && lexer->lookahead == '=') {
      return scan_ere_compound_guard(lexer, ERE_EQUAL_CLOSE_GUARD);
    }
    if (valid_symbols[ERE_COLON_CLOSE_GUARD] && lexer->lookahead == ':') {
      return scan_ere_compound_guard(lexer, ERE_COLON_CLOSE_GUARD);
    }
  }

  if (
    (
      lexer->lookahead == '/' || lexer->lookahead == '\n' || lexer->eof(lexer)
    ) &&
    !valid_symbols[ERROR_SENTINEL] &&
    valid_symbols[ERE_COMPOUND_BOUNDARY]
  ) {
    lexer->result_symbol = ERE_COMPOUND_BOUNDARY;
    return true;
  }

  if (
    lexer->lookahead ==
    '/' &&
    !valid_symbols[ERROR_SENTINEL] &&
    valid_symbols[ERE_INNER_SLASH_BOUNDARY]
  ) {
    lexer->result_symbol = ERE_INNER_SLASH_BOUNDARY;
    return true;
  }

  if (lexer->lookahead == '/' && valid_symbols[ERE_CLOSING]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = ERE_CLOSING;
    state->ere_mode = ERE_MODE_OUTSIDE;
    return true;
  }

  if (
    (lexer->lookahead == '\n' || lexer->eof(lexer)) &&
    !valid_symbols[ERROR_SENTINEL] &&
    valid_symbols[ERE_INNER_END_BOUNDARY]
  ) {
    lexer->result_symbol = ERE_INNER_END_BOUNDARY;
    return true;
  }

  if (
    (lexer->lookahead == '\n' || lexer->eof(lexer)) &&
    valid_symbols[ERE_END_BOUNDARY]
  ) {
    lexer->result_symbol = ERE_END_BOUNDARY;
    state->ere_mode = ERE_MODE_OUTSIDE;
    return true;
  }

  return scan_ere_backslash_context(state, lexer, valid_symbols);
}

bool tree_sitter_posix_awk_external_scanner_scan(
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

  if (
    state->ere_mode ==
    ERE_MODE_OUTSIDE &&
    valid_symbols[PARAMETER_RECOVERY] &&
    !valid_symbols[ERROR_SENTINEL]
  ) {
    (void)skip_ascii_blanks(lexer);
    lexer->mark_end(lexer);
    if (lexer->lookahead == '\n' && valid_symbols[PARAMETER_TARGET_GUARD]) {
      return scan_required_target_guard(lexer, valid_symbols);
    }
    const bool at_word = is_word_start(lexer->lookahead);
    if (scan_parameter_recovery_or_word(lexer, valid_symbols)) {
      return true;
    }
    if (at_word) {
      return false;
    }
  }

  if (valid_symbols[ERROR_SENTINEL]) {
    if (state->ere_mode == ERE_MODE_OUTSIDE) {
      skip_ascii_blanks(lexer);
      lexer->mark_end(lexer);
      if (emit_range_right_expression_recovery(lexer, valid_symbols)) {
        return true;
      }
      if (lexer->eof(lexer) && emit_closer_recovery(lexer, valid_symbols)) {
        return true;
      }
      if (lexer->eof(lexer) && valid_symbols[ACTION_EOF_RECOVERY]) {
        lexer->result_symbol = ACTION_EOF_RECOVERY;
        return true;
      }
      if (valid_symbols[OUTPUT_GREATER_GUARD] && lexer->lookahead == '>') {
        return scan_output_greater_guard(lexer, valid_symbols);
      }
      if (lexer->lookahead == '/') {
        return scan_slash_start(state, lexer, valid_symbols, false);
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

  if (valid_symbols[STRING_END_BOUNDARY] || valid_symbols[STRING_LONE_ESCAPE]) {
    lexer->mark_end(lexer);
    if (
      valid_symbols[STRING_END_BOUNDARY] &&
      (lexer->lookahead == '\n' || lexer->eof(lexer))
    ) {
      lexer->result_symbol = STRING_END_BOUNDARY;
      return true;
    }
    return scan_string_lone_escape(lexer, valid_symbols);
  }

  const bool had_leading_blank = skip_ascii_blanks(lexer);
  lexer->mark_end(lexer);

  const bool at_required_target_newline = lexer->lookahead == '\n';
  if (
    valid_symbols[ACTION_TARGET_GUARD] ||
    (at_required_target_newline &&
      (valid_symbols[EXPRESSION_TARGET_GUARD] ||
        valid_symbols[PRINT_EXPRESSION_TARGET_GUARD] ||
        valid_symbols[PARAMETER_TARGET_GUARD]))
  ) {
    if (scan_required_target_guard(lexer, valid_symbols)) {
      return true;
    }
    if (at_required_target_newline) {
      return false;
    }
  }

  if (valid_symbols[FUNCTION_BODY_RECOVERY]) {
    const bool reset_on_miss =
      is_word_start(lexer->lookahead) || lexer->lookahead == '.';
    if (scan_function_body_recovery(lexer)) {
      return true;
    }
    if (reset_on_miss) {
      return false;
    }
  }

  if (
    (valid_symbols[ACTION_EMPTY_SEMICOLON_ITEM_BOUNDARY_GUARD] ||
      valid_symbols[ACTION_CLOSE_ITEM_BOUNDARY_GUARD]) &&
    (lexer->lookahead == ';' || lexer->lookahead == '\n')
  ) {
    return scan_action_item_terminator_boundary(lexer, valid_symbols);
  }

  if (emit_closer_recovery(lexer, valid_symbols)) {
    return true;
  }

  if (valid_symbols[ACTION_EOF_RECOVERY] && lexer->eof(lexer)) {
    lexer->result_symbol = ACTION_EOF_RECOVERY;
    return true;
  }

  if (
    valid_symbols[PRINT_EXPRESSION_RECOVERY] &&
    (lexer->lookahead == '>' || lexer->lookahead == '|')
  ) {
    if (!scan_print_output_boundary(lexer)) {
      return false;
    }
    lexer->result_symbol = PRINT_EXPRESSION_RECOVERY;
    return true;
  }

  if (
    valid_symbols[STATEMENT_RECOVERY] &&
    (lexer->lookahead == '}' || lexer->eof(lexer))
  ) {
    lexer->result_symbol = STATEMENT_RECOVERY;
    return true;
  }

  if (scan_expression_recovery(lexer, valid_symbols)) {
    return true;
  }

  if (emit_range_right_expression_recovery(lexer, valid_symbols)) {
    return true;
  }

  if (
    valid_symbols[DO_TAIL_RECOVERY] &&
    (character_is_do_tail_recovery_boundary(lexer->lookahead) ||
      lexer->eof(lexer))
  ) {
    lexer->result_symbol = DO_TAIL_RECOVERY;
    return true;
  }

  if (
    valid_symbols[CLOSED_ITEM_TERMINATOR_RECOVERY] &&
    character_starts_statement(lexer->lookahead) &&
    !is_word_start(lexer->lookahead)
  ) {
    return emit_closed_item_terminator_recovery(lexer, valid_symbols);
  }

  if (
    !had_leading_blank &&
    valid_symbols[NUMBER_FRACTION_DIGITS] &&
    is_ascii_digit(lexer->lookahead)
  ) {
    lexer->result_symbol = NUMBER_FRACTION_DIGITS;
    return true;
  }

  if (lexer->lookahead == '\\' && has_line_continuation_marker(valid_symbols)) {
    return scan_line_continuation_marker(lexer, valid_symbols);
  }

  const bool word_marker_is_valid = has_word_marker(valid_symbols);
  const bool has_number_marker = valid_symbols[NUMBER_INTEGER] ||
    valid_symbols[NUMBER_FRACTION] ||
    valid_symbols[NUMBER_EXPONENT];
  if (
    is_word_start(lexer->lookahead) &&
    (word_marker_is_valid ||
      valid_symbols[STATEMENT_RECOVERY] ||
      valid_symbols[DO_TAIL_RECOVERY] ||
      valid_symbols[TERMINATOR_RECOVERY] ||
      valid_symbols[CLOSED_ITEM_TERMINATOR_RECOVERY] ||
      valid_symbols[NORMAL_ITEM_TERMINATOR_RECOVERY] ||
      valid_symbols[ACTION_EMPTY_SEMICOLON_ITEM_BOUNDARY_GUARD] ||
      valid_symbols[ACTION_CLOSE_ITEM_BOUNDARY_GUARD] ||
      valid_symbols[ACTION_ITEM_BOUNDARY_RECOVERY] ||
      valid_symbols[RANGE_RIGHT_EXPRESSION_RECOVERY] ||
      valid_symbols[CLOSE_PARENTHESIS_RECOVERY] ||
      valid_symbols[CLOSE_BRACKET_RECOVERY])
  ) {
    const WordKind kind = scan_word_kind(lexer);
    if (emit_word_required_recovery(lexer, valid_symbols, kind)) {
      return true;
    }
    if (emit_word_structural_boundary(lexer, valid_symbols, kind)) {
      return true;
    }
    if (word_marker_is_valid && emit_word_kind(lexer, valid_symbols, kind)) {
      return true;
    }
    if (emit_word_closer_recovery(lexer, valid_symbols, kind)) {
      return true;
    }
    return emit_word_terminator_recovery(lexer, valid_symbols, kind);
  }

  if (
    (is_ascii_digit(lexer->lookahead) || lexer->lookahead == '.') &&
    (has_number_marker ||
      valid_symbols[DO_TAIL_RECOVERY] ||
      valid_symbols[TERMINATOR_RECOVERY] ||
      valid_symbols[CLOSED_ITEM_TERMINATOR_RECOVERY])
  ) {
    const NumberKind kind = scan_number_kind(lexer);
    if (kind != NUMBER_KIND_NONE && valid_symbols[DO_TAIL_RECOVERY]) {
      lexer->result_symbol = DO_TAIL_RECOVERY;
      return true;
    }
    if (
      kind !=
      NUMBER_KIND_NONE &&
      emit_closed_item_terminator_recovery(lexer, valid_symbols)
    ) {
      return true;
    }
    if (has_number_marker && emit_number_kind(lexer, valid_symbols, kind)) {
      return true;
    }
    if (kind != NUMBER_KIND_NONE) {
      return emit_terminator_recovery(lexer, valid_symbols);
    }
    return false;
  }

  if (
    lexer->lookahead ==
    '/' &&
    (valid_symbols[DIVISION_SLASH] ||
      valid_symbols[ERE_OPENING_SLASH] ||
      valid_symbols[DIV_ASSIGN_OPERATOR])
  ) {
    return scan_slash_start(state, lexer, valid_symbols, true);
  }

  if (has_valid_composite_operator_start(lexer->lookahead, valid_symbols)) {
    return scan_composite_operator_start(lexer, valid_symbols);
  }

  if (valid_symbols[OUTPUT_GREATER_GUARD] && lexer->lookahead == '>') {
    return scan_output_greater_guard(lexer, valid_symbols);
  }

  if (
    valid_symbols[TERMINATOR_RECOVERY] &&
    character_starts_statement(lexer->lookahead) &&
    !(valid_symbols[LC_BEFORE_EXPRESSION] &&
      character_starts_expression(lexer->lookahead))
  ) {
    return emit_terminator_recovery(lexer, valid_symbols);
  }

  return false;
}
