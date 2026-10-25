(comment) @comment

(identifier) @variable

(builtin_function) @function.builtin

(number) @number

[
  (string_content)
  (directive_text)
] @string

(line_continuation) @punctuation.special

[
  "BEGIN"
  "END"
  "BEGINFILE"
  "ENDFILE"
  "function"
  "func"
  "if"
  "else"
  "while"
  "do"
  "for"
  "switch"
  "case"
  "default"
  "break"
  "continue"
  "next"
  "nextfile"
  "return"
  "exit"
  "delete"
  "print"
  "printf"
  "getline"
] @keyword

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "^"
  "**"
  "="
  "+="
  "-="
  "*="
  "/="
  "%="
  "^="
  "**="
  "++"
  "--"
  "!"
  "&&"
  "||"
  "<"
  "<="
  "=="
  "!="
  ">="
  ">"
  "~"
  "!~"
  "in"
  "$"
  "|"
  "|&"
  ">>"
  "?"
  ":"
] @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  ";"
  "::"
] @punctuation.delimiter

(case_clause
  ":" @punctuation.delimiter)

(default_clause
  ":" @punctuation.delimiter)

(for_in_statement
  "in" @keyword)

(string
  "\"" @punctuation.delimiter)

(directive_string
  "\"" @string)

[
  "@"
  "_"
  "include"
  "load"
  "namespace"
  "nsinclude"
] @keyword.directive

(indirect_function_call
  "@" @operator)

(typed_regexp
  "@" @keyword)

(function_definition
  name: [
    (identifier) @function
    (qualified_name
      name: (identifier) @function)
  ])

(function_call
  name: [
    (identifier) @function.call
    (qualified_name
      name: (identifier) @function.call)
  ])

(parameter_list
  (identifier) @variable.parameter)

(qualified_name
  namespace: (identifier) @module)

(regexp
  "/" @punctuation.delimiter)

(regex_character
  (regex_text) @string.regexp)

(regex_operator
  (regex_text) @operator)

(regex_anchor
  (regex_text) @operator)

(regex_wildcard
  [
    "."
    (regex_text)
  ] @character.special)

(regex_character_class
  (regex_text) @character.special)

(regex_delimiter
  [
    ":"
    "."
    "="
  ] @punctuation.delimiter)

(regex_class_name
  (regex_text) @character.special)

(regex_collating_element
  (regex_text) @character.special)

(regex_digits) @number

[
  (escape_sequence
    !fragment)
  (escape_fragment)
] @string.escape
