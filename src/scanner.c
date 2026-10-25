#include "tokens.h"
#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdint.h>
#include <string.h>

enum Literal { NONE, STRING, DIRECTIVE, REGEXP };

enum FormPhase { FORM_NONE, FORM_MARKER, FORM_PAYLOAD, FORM_CLOSE, FORM_END };

typedef struct {
  uint32_t left;
  uint32_t first_fragment;
  bool open;
  bool started;
} Escape;

typedef struct {
  uint32_t unit_left;
  bool unit_raw;
  bool unit_backslash;
  bool host_escaped;
  uint32_t group_depth;
  bool bracket;
  bool bracket_first;
  bool bracket_negated;
  bool after_class;
  bool range_pending;
  uint32_t range_start;
  bool range_byte;
  bool after_quantifier;
  bool interval;
  bool interval_maximum;
  uint32_t interval_minimum;
  unsigned char form;
  enum FormPhase form_phase;
} Regexp;

typedef struct {
  uint32_t shadows;
  enum Literal literal;
  bool non_awk;
  bool qualified_awk;
  bool typed_slash;
  Escape escape;
  Regexp regexp;
} Scanner;

typedef struct {
  TSLexer *lexer;
  int32_t queue[2];
  unsigned size;
  uint32_t offset;
} Reader;

typedef struct {
  int32_t value;
  uint32_t length;
  uint32_t first_fragment;
  bool escaped;
  bool quoted;
  bool byte_escape;
  bool paired;
} Character;

static int32_t peek(Reader *reader, unsigned index) {
  while (reader->size <= index) {
    int32_t value =
      reader->lexer->eof(reader->lexer) ? -1 : reader->lexer->lookahead;
    reader->queue[reader->size++] = value;
    if (value != -1) reader->lexer->advance(reader->lexer, false);
  }
  return reader->queue[index];
}

static int32_t take(Reader *reader) {
  int32_t result = peek(reader, 0);
  --reader->size;
  if (reader->size) reader->queue[0] = reader->queue[1];
  if (result != -1) ++reader->offset;
  return result;
}

static bool continuation(Reader *reader) {
  return peek(reader, 0) == '\\' && peek(reader, 1) == '\n';
}

static void skip_continuations(Reader *reader) {
  while (continuation(reader)) {
    take(reader);
    take(reader);
  }
}

static bool ascii_in(int32_t value, const char *set) {
  return value > 0 && value < 128 && strchr(set, value);
}

static int digit(int32_t value, unsigned base) {
  int result = value >= '0' && value <= '9' ? value - '0'
    : value >= 'a' && value <= 'f'          ? value - 'a' + 10
    : value >= 'A' && value <= 'F'          ? value - 'A' + 10
                                            : -1;
  return result >= 0 && (unsigned)result < base ? result : -1;
}

static bool name_start(int32_t value) {
  return (value >= 'a' && value <= 'z') ||
    (value >= 'A' && value <= 'Z') ||
    value == '_';
}

static bool name_part(int32_t value) {
  return name_start(value) || (value >= '0' && value <= '9');
}

static bool emit(TSLexer *lexer, const bool *valid, enum Token token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}

static bool mark(TSLexer *lexer, const bool *valid, enum Token token) {
  lexer->mark_end(lexer);
  return emit(lexer, valid, token);
}

static bool end_literal(
  Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  enum Token token
) {
  scanner->literal = NONE;
  scanner->escape = (Escape){0};
  scanner->regexp = (Regexp){0};
  return mark(lexer, valid, token);
}

static bool scalar_value(uint32_t value) {
  return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

static void numeric_escape(
  Reader *reader,
  Character *result,
  int32_t code,
  uint32_t start
) {
  bool octal = code >= '0' && code <= '7';
  unsigned base = octal ? 8 : 16;
  unsigned limit = octal ? 3 : code == 'x' ? 2 : 8;
  unsigned count = octal;
  uint32_t value = octal ? (uint32_t)(code - '0') : 0;
  uint32_t first_break = 0;
  while (count < limit) {
    if (!first_break && continuation(reader))
      first_break = reader->offset - start;
    skip_continuations(reader);
    int next = digit(peek(reader, 0), base);
    if (next < 0) break;
    take(reader);
    value = value * base + (unsigned)next;
    ++count;
    result->length = reader->offset - start;
    result->first_fragment = first_break;
  }
  if (!count) return;
  result->byte_escape = code != 'u';
  if (code == 'u' && !scalar_value(value)) {
    result->value = '?';
    result->quoted = true;
  } else {
    result->value = (int32_t)(octal ? value & 255 : value);
  }
}

static Character decode(Reader *reader) {
  static const char controls[] = "abfnrtv";
  uint32_t start = reader->offset;
  Character result = {.value = take(reader)};
  result.length = reader->offset - start;
  if (result.value != '\\') return result;
  result.escaped = true;
  int32_t code = take(reader);
  result.value = code;
  result.length = reader->offset - start;
  if (code <= 0) {
    result.value = -1;
  } else if (ascii_in(code, "01234567xu")) {
    numeric_escape(reader, &result, code, start);
  } else if (ascii_in(code, controls)) {
    result.value = "\a\b\f\n\r\t\v"[strchr(controls, code) - controls];
  } else {
    result.quoted = true;
  }
  return result;
}

static void
open_escape(Scanner *scanner, uint32_t length, uint32_t first_fragment) {
  scanner->escape = (Escape){
    .left = length,
    .first_fragment = first_fragment,
    .open = true,
  };
}

static void advance_escape(Scanner *scanner, uint32_t length) {
  scanner->escape.left -= length;
  if (scanner->literal == REGEXP) scanner->regexp.unit_left -= length;
}

static bool escape_start(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  Escape *escape = &scanner->escape;
  bool split = escape->first_fragment != 0;
  uint32_t length = split ? escape->first_fragment : escape->left;
  for (uint32_t i = 0; i < length; ++i) lexer->advance(lexer, false);
  advance_escape(scanner, length);
  escape->started = true;
  if (!split) scanner->escape = (Escape){0};
  return mark(lexer, valid, split ? ESCAPE_START : ESCAPE);
}

static uint32_t advance_text(TSLexer *lexer, uint32_t limit) {
  uint32_t length = 0;
  while (length < limit && lexer->lookahead != '\\' && !lexer->eof(lexer)) {
    lexer->advance(lexer, false);
    ++length;
  }
  return length;
}

static bool
escape_fragment(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  advance_escape(scanner, advance_text(lexer, scanner->escape.left));
  return mark(lexer, valid, ESCAPE_FRAGMENT);
}

enum { NAME_SIZE = 32 };

typedef struct {
  char text[NAME_SIZE];
  uint32_t length;
  Word word;
} Name;

static void append_name(Name *name, int32_t value) {
  if (name->length < NAME_SIZE - 1) name->text[name->length] = (char)value;
  ++name->length;
}

static Word word_kind(const Name *name) {
  if (name->length < NAME_SIZE) {
    for (unsigned i = 0; i < sizeof(WORDS) / sizeof(WORDS[0]); ++i) {
      const char *text = WORDS[i].text;
      if (text[0] == name->text[0] && strcmp(name->text, text) == 0)
        return WORDS[i];
    }
  }
  return (Word){NULL, ORDINARY, 0};
}

static Name read_name(TSLexer *lexer) {
  Name name = {0};
  while (name_part(lexer->lookahead)) {
    append_name(&name, lexer->lookahead);
    lexer->advance(lexer, false);
  }
  name.word = word_kind(&name);
  return name;
}

static bool awk_namespace(const Name *name) {
  return strcmp(name->text, "awk") == 0;
}

static enum Token name_token(
  const Scanner *scanner,
  Name name,
  bool qualified,
  bool qualified_awk
) {
  enum WordKind kind = name.word.kind;
  enum Token identifier = qualified ? QUALIFIED_IDENTIFIER : IDENTIFIER;
  if (
    kind == STANDARD_KEYWORD ||
    (qualified &&
      qualified_awk &&
      (kind == EXTENSION_KEYWORD || kind == DIRECTIVE_NAME))
  )
    return ERROR_SENTINEL;
  if (kind == STANDARD_BUILTIN) {
    if (qualified) return ERROR_SENTINEL;
    return strcmp(name.text, "length") == 0 ? LENGTH : BUILTIN;
  }
  bool shadowed = (!qualified || qualified_awk) &&
    (scanner->shadows & (UINT32_C(1) << name.word.bit));
  if (kind == ORDINARY || kind == DIRECTIVE_NAME || shadowed) return identifier;
  if (kind == EXTENSION_KEYWORD) {
    if (!qualified) return (enum Token)(KEYWORD_BEGINFILE + name.word.bit);
    return identifier;
  }
  if (qualified) return qualified_awk ? QUALIFIED_BUILTIN : identifier;
  return scanner->non_awk ? identifier : BUILTIN;
}

static bool scan_qualifier(
  Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  const Name *name
) {
  bool awk = awk_namespace(name);
  lexer->advance(lexer, false);
  enum Token token = name_token(scanner, read_name(lexer), true, awk);
  bool call = token == QUALIFIED_BUILTIN ||
    (token == QUALIFIED_IDENTIFIER && lexer->lookahead == '(');
  scanner->qualified_awk = awk;
  return emit(lexer, valid, call ? CALL_QUALIFIER : QUALIFIER);
}

static bool scan_name(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  Name name = read_name(lexer);
  lexer->mark_end(lexer);
  bool qualified_awk = scanner->qualified_awk;
  scanner->qualified_awk = false;
  bool call = lexer->lookahead == '(';
  bool qualified = valid[QUALIFIED_IDENTIFIER];
  bool reserved =
    name.word.kind == STANDARD_KEYWORD || name.word.kind == STANDARD_BUILTIN;
  if (
    !qualified &&
    name.length == 1 &&
    name.text[0] == '_' &&
    lexer->lookahead == '"'
  )
    return emit(lexer, valid, TRANSLATION_MARKER);
  if (!qualified && lexer->lookahead == ':') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == ':' && !reserved)
      return scan_qualifier(scanner, lexer, valid, &name);
  }
  if (valid[PARAMETER]) {
    if (reserved) return false;
    if (name.word.kind != ORDINARY)
      scanner->shadows |= UINT32_C(1) << name.word.bit;
    return emit(lexer, valid, PARAMETER);
  }
  if (name.word.kind == STANDARD_KEYWORD) {
    if (strcmp(name.text, "function") != 0 && strcmp(name.text, "func") != 0)
      return false;
    scanner->shadows = 0;
    return emit(lexer, valid, name.text[4] ? FUNCTION_START : FUNC_START);
  }
  enum Token token = name_token(scanner, name, qualified, qualified_awk);
  if (token == IDENTIFIER && call) {
    if (valid[INDIRECT_IDENTIFIER]) {
      if (
        name.word.kind == DIRECTIVE_NAME &&
        !(scanner->shadows & (UINT32_C(1) << name.word.bit))
      )
        return false;
      token = INDIRECT_IDENTIFIER;
    } else token = CALL_IDENTIFIER;
  }
  return token != ERROR_SENTINEL && emit(lexer, valid, token);
}

static bool namespace_name(Scanner *scanner, TSLexer *lexer) {
  Reader reader = {.lexer = lexer};
  Name name = {0};
  for (;;) {
    skip_continuations(&reader);
    int32_t value = peek(&reader, 0);
    if (value == '"') break;
    if (!(name.length ? name_part(value) : name_start(value))) return false;
    append_name(&name, value);
    take(&reader);
  }
  enum WordKind kind = word_kind(&name).kind;
  if (!name.length || (kind != ORDINARY && kind != EXTENSION_BUILTIN))
    return false;
  scanner->non_awk = !awk_namespace(&name);
  return true;
}

static bool quoted_text(const TSLexer *lexer) {
  int32_t next = lexer->lookahead;
  return !lexer->eof(lexer) && next && next != '\n' && next != '"';
}

static bool
directive_content(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  bool content = false;
  while (quoted_text(lexer)) {
    if (lexer->lookahead == '\\') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '"' || lexer->lookahead == '\n') {
        if (content) return emit(lexer, valid, DIRECTIVE_TEXT);
        if (lexer->lookahead == '"') {
          open_escape(scanner, 2, 0);
          return emit(lexer, valid, ESCAPE_PREPARE);
        }
        lexer->advance(lexer, false);
        return mark(lexer, valid, LINE_CONTINUATION);
      }
    }
    if (!lexer->eof(lexer) && lexer->lookahead) lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    content = true;
  }
  return emit(lexer, valid, DIRECTIVE_TEXT);
}

static bool number_boundary(TSLexer *lexer) {
  if (lexer->lookahead != '0') return true;
  lexer->advance(lexer, false);
  if (lexer->lookahead != 'x' && lexer->lookahead != 'X') return true;
  lexer->advance(lexer, false);
  if (digit(lexer->lookahead, 16) < 0) return true;
  while (digit(lexer->lookahead, 16) >= 0) lexer->advance(lexer, false);
  if (lexer->lookahead != '.') return true;
  lexer->advance(lexer, false);
  while (digit(lexer->lookahead, 16) >= 0) lexer->advance(lexer, false);
  if (lexer->lookahead != 'p' && lexer->lookahead != 'P') return false;
  lexer->advance(lexer, false);
  if (lexer->lookahead == '+' || lexer->lookahead == '-')
    lexer->advance(lexer, false);
  return digit(lexer->lookahead, 10) >= 0;
}

static bool else_follows(TSLexer *lexer) {
  Reader reader = {.lexer = lexer};
  for (int32_t value;;) {
    skip_continuations(&reader);
    value = peek(&reader, 0);
    if (ascii_in(value, " \t\r\n")) {
      take(&reader);
    } else if (value == '#') {
      while ((value = peek(&reader, 0)) > 0 && value != '\n') take(&reader);
    } else {
      break;
    }
  }
  for (const char *word = "else"; *word; ++word)
    if (take(&reader) != *word) return false;
  return !name_part(peek(&reader, 0));
}

static bool at_kept_escape(Reader *reader) {
  if (peek(reader, 0) != '\\') return false;
  int32_t code = peek(reader, 1);
  return code > 0 && !ascii_in(code, "01234567xuabfnrtv");
}

static Character pattern_character(Reader *reader, uint32_t start) {
  skip_continuations(reader);
  uint32_t character_start = reader->offset;
  Character character = decode(reader);
  character.length += character_start - start;
  unsigned count = character.value >= 0xc2 && character.value <= 0xdf ? 2
    : character.value >= 0xe0 && character.value <= 0xef              ? 3
    : character.value >= 0xf0 && character.value <= 0xf4              ? 4
                                                                      : 0;
  if (!character.byte_escape || !count) return character;
  uint32_t value = (uint32_t)character.value & (0x7f >> count);
  uint32_t end = start + character.length;
  for (unsigned i = 1; i < count; ++i) {
    skip_continuations(reader);
    uint32_t next_start = reader->offset;
    Character next = decode(reader);
    if (!next.byte_escape || next.value < 0x80 || next.value > 0xbf)
      return character;
    value = (value << 6) | ((uint32_t)next.value & 0x3f);
    end = next_start + next.length;
  }
  uint32_t minimum = count == 2 ? 0x80 : count == 3 ? 0x800 : 0x10000;
  if (value >= minimum && value <= 0x10ffff) {
    character.value = (int32_t)value;
    character.length = end - start;
    character.byte_escape = false;
  }
  return character;
}

static Character regex_character(Reader *reader, bool left_backslash) {
  uint32_t start = reader->offset;
  Character character = {.value = '\\', .escaped = true};
  if (left_backslash) take(reader);
  else character = pattern_character(reader, start);
  if (character.value != '\\' || character.quoted) return character;
  character.quoted = true;
  skip_continuations(reader);
  if (at_kept_escape(reader)) {
    take(reader);
    character.paired = true;
    character.length = reader->offset - start;
  } else if (peek(reader, 0) == '/') {
    character.value = -1;
  } else {
    Character next = pattern_character(reader, start);
    character.value = next.value;
    character.length = next.length;
    character.byte_escape = next.byte_escape;
  }
  return character;
}

static Character form_character(Reader *reader) {
  uint32_t start = reader->offset;
  skip_continuations(reader);
  if (!at_kept_escape(reader)) return pattern_character(reader, start);
  take(reader);
  return (Character){
    .value = '\\',
    .length = reader->offset - start,
    .escaped = true,
    .paired = true,
  };
}

static bool
class_payload(Reader *reader, Character character, uint32_t *length) {
  static const char *const names[] = {
    "alnum",
    "alpha",
    "blank",
    "cntrl",
    "digit",
    "graph",
    "lower",
    "print",
    "punct",
    "space",
    "upper",
    "xdigit"
  };
  char name[7] = {0};
  unsigned size = 0;
  for (Character next = character;;) {
    if (next.value < 'a' || next.value > 'z' || size == sizeof(name) - 1)
      return false;
    name[size++] = (char)next.value;
    uint32_t start = reader->offset;
    next = form_character(reader);
    if (next.value == ':' && !next.quoted) break;
    *length = start + next.length;
  }
  for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); ++i)
    if (strcmp(name, names[i]) == 0) return true;
  return false;
}

static enum Token form_role(unsigned char form, unsigned index) {
  static const enum Token roles[][3] = {
    {RX_CLASS_OPEN, RX_CLASS_MARKER, RX_CLASS_CLOSE},
    {RX_COLLATING_OPEN, RX_COLLATING_MARKER, RX_COLLATING_CLOSE},
    {RX_EQUIVALENCE_OPEN, RX_EQUIVALENCE_MARKER, RX_EQUIVALENCE_CLOSE}
  };
  return roles[form == ':' ? 0 : form == '.' ? 1 : 2][index];
}

static enum Token form_unit(
  Regexp *regexp,
  Reader *reader,
  Character character,
  uint32_t *length
) {
  if (character.quoted) return ERROR_SENTINEL;
  if (regexp->form_phase == FORM_PAYLOAD) {
    if (regexp->form == ':' && !class_payload(reader, character, length))
      return ERROR_SENTINEL;
    regexp->form_phase = FORM_CLOSE;
    return RX_PAYLOAD;
  }
  if (regexp->form_phase == FORM_END) {
    if (character.value != ']') return ERROR_SENTINEL;
    regexp->form_phase = FORM_NONE;
    return RX_FORM_END;
  }
  if (character.value != regexp->form) return ERROR_SENTINEL;
  bool opening = regexp->form_phase == FORM_MARKER;
  regexp->form_phase = opening ? FORM_PAYLOAD : FORM_END;
  return form_role(regexp->form, opening ? 1 : 2);
}

static enum Token interval_unit(
  Regexp *regexp,
  Reader *reader,
  Character character,
  uint32_t *length
) {
  int32_t value = character.value;
  if (character.quoted) return ERROR_SENTINEL;
  if (value == ',') {
    regexp->interval_maximum = true;
    return RX_COMMA;
  }
  if (value == '}') {
    regexp->interval = false;
    regexp->interval_maximum = false;
    regexp->interval_minimum = 0;
    return RX_INTERVAL_CLOSE;
  }
  if (value < '0' || value > '9') return ERROR_SENTINEL;
  uint32_t count = (uint32_t)(value - '0');
  for (;;) {
    uint32_t start = reader->offset;
    Character next = regex_character(reader, false);
    if (next.value < '0' || next.value > '9' || next.quoted) break;
    count = count * 10 + (uint32_t)(next.value - '0');
    *length = start + next.length;
    if (count > 255) return ERROR_SENTINEL;
  }
  if (regexp->interval_maximum) {
    if (count < regexp->interval_minimum) return ERROR_SENTINEL;
  } else {
    regexp->interval_minimum = count;
  }
  return RX_COUNT;
}

static enum Token bracket_unit(Regexp *regexp, Reader *reader, int32_t value) {
  if (value == ']' && !regexp->bracket_first) return RX_BRACKET_CLOSE;
  if (value == '^' && regexp->bracket_first && !regexp->bracket_negated)
    return RX_NEGATION;
  if (value == '[') {
    Character next = regex_character(reader, false);
    if (next.quoted || !ascii_in(next.value, ":.=")) return RX_CHARACTER;
    regexp->form = (unsigned char)next.value;
    regexp->form_phase = FORM_MARKER;
    return form_role(regexp->form, 0);
  }
  if (
    value == '-' &&
    !regexp->bracket_first &&
    !regexp->after_class &&
    !regexp->range_pending
  ) {
    Character next = regex_character(reader, false);
    if (next.value != ']' || next.quoted) return RX_RANGE;
  }
  return RX_CHARACTER;
}

static enum Token operator_unit(Regexp *regexp, Reader *reader, int32_t value) {
  switch (value) {
    case '.':
      return RX_WILDCARD;
    case '^':
      return RX_ANCHOR_START;
    case '$':
      return RX_ANCHOR_END;
    case '|':
      return RX_ALTERNATION;
    case '(':
      return RX_GROUP_OPEN;
    case ')':
      return regexp->group_depth ? RX_GROUP_CLOSE : RX_CHARACTER;
    case '[':
      return RX_BRACKET_OPEN;
    case '*':
      return RX_STAR;
    case '+':
      return RX_PLUS;
    case '?':
      return regexp->after_quantifier ? RX_MODIFIER : RX_QUESTION;
    case '{': {
      Character next = regex_character(reader, false);
      if (next.value < '0' || next.value > '9' || next.quoted)
        return RX_CHARACTER;
      regexp->interval = true;
      return RX_INTERVAL_OPEN;
    }
    default:
      return RX_CHARACTER;
  }
}

static bool
bracket_member(Regexp *regexp, enum Token role, Character character) {
  if (role == RX_CHARACTER || (role == RX_PAYLOAD && regexp->form != ':')) {
    uint32_t value = (uint32_t)character.value;
    bool byte = character.byte_escape && value >= 0x80;
    if (role == RX_PAYLOAD && regexp->form == '=' && byte) return false;
    if (regexp->range_pending) {
      if (byte != regexp->range_byte) return false;
      if (byte ? value != regexp->range_start : value < regexp->range_start)
        return false;
    }
    regexp->range_start = value;
    regexp->range_byte = byte;
    regexp->range_pending = false;
  } else if (role == RX_RANGE) {
    regexp->range_pending = true;
  }
  regexp->after_class = role == RX_FORM_END && regexp->form == ':';
  return true;
}

static enum Token unit_role(
  Regexp *regexp,
  Reader *reader,
  Character character,
  uint32_t *length
) {
  if (regexp->form_phase != FORM_NONE)
    return form_unit(regexp, reader, character, length);
  if (regexp->interval) return interval_unit(regexp, reader, character, length);
  if (character.quoted) {
    if (regexp->bracket || !ascii_in(character.value, "wWsSyB<>`'"))
      return RX_CHARACTER;
    return ascii_in(character.value, "wWsS") ? RX_CLASS : RX_ANCHOR;
  }
  return regexp->bracket ? bracket_unit(regexp, reader, character.value)
                         : operator_unit(regexp, reader, character.value);
}

static void enter_role(Regexp *regexp, enum Token role) {
  if (role == RX_GROUP_OPEN) ++regexp->group_depth;
  if (role == RX_GROUP_CLOSE) --regexp->group_depth;
  if (role == RX_FORM_END) regexp->form = 0;
  if (role == RX_BRACKET_OPEN) {
    regexp->bracket = true;
    regexp->bracket_first = true;
  } else if (role == RX_BRACKET_CLOSE) {
    regexp->bracket = false;
    regexp->range_start = 0;
    regexp->range_byte = false;
  } else if (role == RX_NEGATION) {
    regexp->bracket_negated = true;
  } else {
    regexp->bracket_first = false;
    regexp->bracket_negated = false;
  }
  regexp->after_quantifier = role == RX_STAR ||
    role == RX_PLUS ||
    role == RX_QUESTION ||
    role == RX_INTERVAL_CLOSE;
}

static bool regex_role(Scanner *scanner, Reader reader, const bool *valid) {
  Regexp *regexp = &scanner->regexp;
  TSLexer *lexer = reader.lexer;
  Character character = regexp->form_phase == FORM_PAYLOAD
    ? form_character(&reader)
    : regex_character(
        &reader,
        regexp->host_escaped && peek(&reader, 0) == '\\'
      );
  if (character.value < 0) return false;
  uint32_t length = character.length;
  enum Token role = unit_role(regexp, &reader, character, &length);
  if (
    !valid[role] ||
    (regexp->bracket && !bracket_member(regexp, role, character))
  ) {
    // Keep rejected source in place for recovery's host delimiter tracking.
    role = ERROR_SENTINEL;
  }
  if (role != ERROR_SENTINEL) enter_role(regexp, role);
  regexp->unit_left = length;
  regexp->unit_raw = !character.escaped;
  regexp->unit_backslash = character.paired;
  lexer->result_symbol = role;
  return true;
}

static bool regex_unit(Regexp *regexp, TSLexer *lexer, const bool *valid) {
  uint32_t length = advance_text(lexer, regexp->unit_left);
  if (length) regexp->host_escaped = false;
  regexp->unit_left -= length;
  return mark(lexer, valid, regexp->unit_raw ? REGEX_RAW : REGEX_TEXT);
}

static bool backslash(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  Regexp *regexp = &scanner->regexp;
  bool in_regexp = scanner->literal == REGEXP;
  if (scanner->escape.open && !scanner->escape.started)
    return escape_start(scanner, lexer, valid);
  Reader reader = {.lexer = lexer};
  // Paired backslashes are regex text but escape the next source character.
  bool paired = regexp->unit_backslash && regexp->unit_left == 1;
  if (in_regexp && (paired || regexp->host_escaped)) {
    if (!regexp->unit_left) return regex_role(scanner, reader, valid);
    lexer->advance(lexer, false);
    --regexp->unit_left;
    if (paired) regexp->unit_backslash = false;
    regexp->host_escaped = paired;
    return mark(lexer, valid, REGEX_TEXT);
  }
  if (continuation(&reader)) {
    if (scanner->escape.open) scanner->escape.left -= 2;
    if (in_regexp && regexp->unit_left) regexp->unit_left -= 2;
    return mark(
      lexer,
      valid,
      scanner->literal == NONE && valid[OPERATOR_CONTINUATION]
        ? OPERATOR_CONTINUATION
        : LINE_CONTINUATION
    );
  }
  if (valid[ESCAPE_PREPARE] && (!in_regexp || regexp->unit_left)) {
    Character escape = decode(&reader);
    if (escape.value < 0) return false;
    open_escape(scanner, escape.length, escape.first_fragment);
    return emit(lexer, valid, ESCAPE_PREPARE);
  }
  return in_regexp && !regexp->unit_left && regex_role(scanner, reader, valid);
}

static bool regexp_source(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  Regexp *regexp = &scanner->regexp;
  if (regexp->unit_left) return regex_unit(regexp, lexer, valid);
  if (lexer->lookahead == '/' && !regexp->host_escaped) {
    lexer->advance(lexer, false);
    return end_literal(scanner, lexer, valid, REGEXP_END);
  }
  return regex_role(scanner, (Reader){.lexer = lexer}, valid);
}

static bool open_regexp(Scanner *scanner, TSLexer *lexer) {
  scanner->literal = REGEXP;
  scanner->regexp = (Regexp){0};
  lexer->result_symbol = REGEXP_START;
  return true;
}

// Preserve typed-regexp boundaries even where the parser rejects them.
static bool typed_marker(Scanner *scanner, TSLexer *lexer) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  lexer->result_symbol = TYPED_REGEXP_MARKER;
  scanner->typed_slash = lexer->lookahead == '/';
  return scanner->typed_slash;
}

static bool slash(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  bool equals = lexer->lookahead == '=';
  if (equals && valid[DIVIDE_ASSIGN]) {
    lexer->advance(lexer, false);
    return mark(lexer, valid, DIVIDE_ASSIGN);
  }
  if (valid[DIVIDE] && !(equals && valid[REGEXP_START]))
    return emit(lexer, valid, DIVIDE);
  return valid[REGEXP_START] && open_regexp(scanner, lexer);
}

static bool quote(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  enum Token symbol = valid[NAMESPACE_START] ? NAMESPACE_START
    : valid[DIRECTIVE_START]                 ? DIRECTIVE_START
                                             : STRING_START;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (symbol == NAMESPACE_START && !namespace_name(scanner, lexer))
    return false;
  scanner->literal = symbol == STRING_START ? STRING : DIRECTIVE;
  return emit(lexer, valid, symbol);
}

static bool layout_token(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  int32_t next = lexer->lookahead;
  if (valid[NUMBER_BOUNDARY] && (digit(next, 10) >= 0 || next == '.'))
    return number_boundary(lexer) && emit(lexer, valid, NUMBER_BOUNDARY);
  switch (next) {
    case ']':
      if (!valid[SUBSCRIPT_LINK]) return false;
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      return lexer->lookahead == '[' && emit(lexer, valid, SUBSCRIPT_LINK);
    case ':':
      if (!valid[QUALIFIED_SEPARATOR]) return false;
      lexer->advance(lexer, false);
      if (lexer->lookahead != ':') return false;
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      return name_start(lexer->lookahead) &&
        emit(lexer, valid, QUALIFIED_SEPARATOR);
    case '@':
      return typed_marker(scanner, lexer);
    case '\\':
      return backslash(scanner, lexer, valid);
    case '"':
      return quote(scanner, lexer, valid);
    case '/':
      return slash(scanner, lexer, valid);
    default:
      return name_start(next) && scan_name(scanner, lexer, valid);
  }
}

static bool quoted_token(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  bool string = scanner->literal == STRING;
  if (lexer->lookahead == '"') {
    lexer->advance(lexer, false);
    return end_literal(
      scanner,
      lexer,
      valid,
      string ? STRING_END : DIRECTIVE_END
    );
  }
  if (!string && !scanner->escape.open)
    return directive_content(scanner, lexer, valid);
  if (lexer->lookahead == '\\') return backslash(scanner, lexer, valid);
  while (quoted_text(lexer) && lexer->lookahead != '\\')
    lexer->advance(lexer, false);
  return mark(lexer, valid, STRING_CONTENT);
}

// Recovery lacks parser context; accept only context-free boundaries.
static bool
recovery_source(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (lexer->lookahead == '@') return typed_marker(scanner, lexer);
  if (lexer->lookahead == '"') {
    lexer->advance(lexer, false);
    scanner->literal = STRING;
    return mark(lexer, valid, STRING_START);
  }
  Reader reader = {.lexer = lexer};
  return continuation(&reader) && mark(lexer, valid, LINE_CONTINUATION);
}

static bool
recovery_regexp(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  Regexp *regexp = &scanner->regexp;
  int32_t next = lexer->lookahead;
  scanner->escape = (Escape){0};
  regexp->unit_left = 0;
  regexp->unit_backslash = false;
  if (regexp->host_escaped) {
    regexp->host_escaped = false;
    lexer->advance(lexer, false);
  } else if (next == '\\') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == '\n') {
      lexer->advance(lexer, false);
      return mark(lexer, valid, LINE_CONTINUATION);
    }
    if (!lexer->eof(lexer) && lexer->lookahead) lexer->advance(lexer, false);
  } else if (next == '/') {
    lexer->advance(lexer, false);
    return end_literal(scanner, lexer, valid, REGEXP_END);
  } else {
    do {
      lexer->advance(lexer, false);
    } while (
      !lexer->eof(lexer) &&
      lexer->lookahead &&
      !ascii_in(lexer->lookahead, "\\\n/")
    );
  }
  // Recovery may be probed before an error; raw contents must remain rejected.
  return mark(lexer, valid, ERROR_SENTINEL);
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  bool recovering = valid[ERROR_SENTINEL];
  if (scanner->typed_slash) {
    scanner->typed_slash = false;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    return open_regexp(scanner, lexer);
  }
  if (scanner->literal != NONE && lexer->lookahead == '\n')
    return end_literal(scanner, lexer, valid, LITERAL_BREAK);
  if (!recovering && valid[FUNCTION_END]) {
    scanner->shadows = 0;
    return mark(lexer, valid, FUNCTION_END);
  }
  if (scanner->escape.open && !scanner->escape.left) {
    scanner->escape = (Escape){0};
    return mark(lexer, valid, ESCAPE_END);
  }
  // Statement reuse depends on the following else.
  if (!recovering && valid[ELSE_MARK]) {
    lexer->mark_end(lexer);
    return emit(lexer, valid, else_follows(lexer) ? ELSE_MARK : IF_END);
  }
  if (scanner->literal == NONE) {
    while (ascii_in(lexer->lookahead, " \t\r")) lexer->advance(lexer, true);
  }
  lexer->mark_end(lexer);
  int32_t next = lexer->lookahead;
  if (lexer->eof(lexer)) return !recovering && emit(lexer, valid, END_OF_INPUT);
  if (!next || next == '\n') return false;
  if (recovering && scanner->literal == NONE)
    return recovery_source(scanner, lexer, valid);
  if (recovering && scanner->literal == REGEXP)
    return recovery_regexp(scanner, lexer, valid);
  if (scanner->escape.open && next != '\\')
    return escape_fragment(scanner, lexer, valid);
  switch (scanner->literal) {
    case NONE:
      return layout_token(scanner, lexer, valid);
    case REGEXP:
      return next == '\\' ? backslash(scanner, lexer, valid)
                          : regexp_source(scanner, lexer, valid);
    default:
      return quoted_token(scanner, lexer, valid);
  }
}

enum { FLAG_COUNT = 17 };

typedef struct {
  bool *flag[FLAG_COUNT];
} Flags;

static Flags flags(Scanner *scanner) {
  Regexp *regexp = &scanner->regexp;
  return (Flags){{
    &scanner->non_awk,
    &scanner->qualified_awk,
    &scanner->typed_slash,
    &scanner->escape.open,
    &scanner->escape.started,
    &regexp->unit_raw,
    &regexp->unit_backslash,
    &regexp->host_escaped,
    &regexp->bracket,
    &regexp->bracket_first,
    &regexp->bracket_negated,
    &regexp->after_class,
    &regexp->range_pending,
    &regexp->range_byte,
    &regexp->after_quantifier,
    &regexp->interval,
    &regexp->interval_maximum,
  }};
}

static unsigned put(char *buffer, unsigned length, uint32_t value) {
  do {
    unsigned char byte = value & 0x7f;
    value >>= 7;
    buffer[length++] = (char)(value ? byte | 0x80 : byte);
  } while (value);
  return length;
}

static uint32_t get(const char *buffer, unsigned length, unsigned *position) {
  uint32_t value = 0;
  for (unsigned shift = 0; *position < length && shift < 32; shift += 7) {
    unsigned char byte = (unsigned char)buffer[(*position)++];
    value |= (uint32_t)(byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
  }
  return value;
}

void *tree_sitter_awk_external_scanner_create(void) {
  return ts_calloc(1, sizeof(Scanner));
}

void tree_sitter_awk_external_scanner_destroy(void *payload) {
  ts_free(payload);
}

unsigned
tree_sitter_awk_external_scanner_serialize(void *payload, char *buffer) {
  if (!payload) return 0;
  Scanner *scanner = payload;
  Regexp *regexp = &scanner->regexp;
  Flags list = flags(scanner);
  uint32_t bits = (uint32_t)scanner->literal;
  for (unsigned i = 0; i < FLAG_COUNT; ++i)
    if (*list.flag[i]) bits |= UINT32_C(1) << (i + 2);
  unsigned length = put(buffer, 0, bits);
  length = put(buffer, length, scanner->shadows);
  if (scanner->escape.open) {
    length = put(buffer, length, scanner->escape.left);
    length = put(buffer, length, scanner->escape.first_fragment);
  }
  if (scanner->literal == REGEXP) {
    length = put(buffer, length, regexp->unit_left);
    length = put(buffer, length, regexp->group_depth);
    length = put(buffer, length, regexp->range_start);
    length = put(buffer, length, regexp->interval_minimum);
    length = put(buffer, length, regexp->form);
    length = put(buffer, length, regexp->form_phase);
  }
  return length;
}

void tree_sitter_awk_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  if (!payload) return;
  Scanner *scanner = payload;
  Regexp *regexp = &scanner->regexp;
  memset(scanner, 0, sizeof(*scanner));
  if (!length) return;
  unsigned position = 0;
  uint32_t bits = get(buffer, length, &position);
  scanner->literal = (enum Literal)(bits & 3);
  Flags list = flags(scanner);
  for (unsigned i = 0; i < FLAG_COUNT; ++i) *list.flag[i] = bits >> (i + 2) & 1;
  scanner->shadows = get(buffer, length, &position);
  if (scanner->escape.open) {
    scanner->escape.left = get(buffer, length, &position);
    scanner->escape.first_fragment = get(buffer, length, &position);
  }
  if (scanner->literal == REGEXP) {
    regexp->unit_left = get(buffer, length, &position);
    regexp->group_depth = get(buffer, length, &position);
    regexp->range_start = get(buffer, length, &position);
    regexp->interval_minimum = get(buffer, length, &position);
    regexp->form = (unsigned char)get(buffer, length, &position);
    regexp->form_phase = (enum FormPhase)get(buffer, length, &position);
  }
}

bool tree_sitter_awk_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid
) {
  if (!payload) return false;
  Scanner next = *(Scanner *)payload;
  if (!scan(&next, lexer, valid)) return false;
  *(Scanner *)payload = next;
  return true;
}
