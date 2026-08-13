#!/bin/sh

set -eu

repository_directory=$(
  CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd
)
tree_sitter="$repository_directory/node_modules/.bin/tree-sitter"
grammar_parent_directory=$(
  CDPATH='' cd -- "$repository_directory/.." && pwd
)
runtime_directory=$(
  mktemp -d "${TMPDIR:-/tmp}/tree-sitter-posix-awk-runtime.XXXXXX"
)
parser_library="$runtime_directory/parser"
wasm_library_directory="$runtime_directory/wasm"
wasm_parser_library="$wasm_library_directory/posix_awk.wasm"
tree_sitter_config="$runtime_directory/config.json"

cleanup() {
  find "$runtime_directory" -depth -delete
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

assert_contains() {
  expected=$1
  file=$2
  if ! grep -Fq -- "$expected" "$file"; then
    printf '%s\n' "Expected parse output to contain: $expected" >&2
    sed -n '1,200p' "$file" >&2
    exit 1
  fi
}

assert_not_contains() {
  unexpected=$1
  file=$2
  if grep -Fq -- "$unexpected" "$file"; then
    printf '%s\n' "Expected parse output not to contain: $unexpected" >&2
    sed -n '1,200p' "$file" >&2
    exit 1
  fi
}

assert_clean_continuation_tree() {
  continuation_tree=$1
  assert_contains "line_continuation" "$continuation_tree"
  assert_not_contains "ERROR" "$continuation_tree"
  assert_not_contains "MISSING" "$continuation_tree"
  assert_not_contains "_recovery" "$continuation_tree"
}

assert_matches() {
  expected_pattern=$1
  file=$2
  if ! grep -Eq -- "$expected_pattern" "$file"; then
    printf '%s\n' "Expected parse output to match: $expected_pattern" >&2
    sed -n '1,200p' "$file" >&2
    exit 1
  fi
}

assert_single_action_closer_recovery() {
  action_closer_tree=$1
  assert_contains "closing: closer_recovery" "$action_closer_tree"
  action_closer_count=$(
    grep -Ec \
      '^[[:space:][:digit:]:-]+closing:[[:space:]]+closer_recovery$' \
      "$action_closer_tree"
  )
  if [ "$action_closer_count" -ne 1 ]; then
    fail "Expected one action closer-recovery node at physical EOF"
  fi
}

node -e \
  'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ "parser-directories": [process.argv[2]] }, null, 2) + "\n");' \
  "$tree_sitter_config" \
  "$grammar_parent_directory"

mkdir -p "$wasm_library_directory"

"$tree_sitter" build \
  --output "$parser_library" \
  "$repository_directory"

"$tree_sitter" build \
  --wasm \
  --output "$wasm_parser_library" \
  "$repository_directory"

parse_native() {
  NO_COLOR=1 "$tree_sitter" parse \
    --config-path "$tree_sitter_config" \
    --lib-path "$parser_library" \
    --lang-name posix_awk \
    --cst \
    "$@"
}

parse_wasm() {
  NO_COLOR=1 TREE_SITTER_LIBDIR="$wasm_library_directory" \
    "$tree_sitter" parse \
    --config-path "$tree_sitter_config" \
    --wasm \
    --scope source.awk \
    --cst \
    "$@"
}

normalize_parse_tree() {
  normalize_input_file=$1
  normalize_output_file=$2
  normalize_source_file=$3
  awk '
    index($0, source_file) == 1 {
      suffix = substr($0, length(source_file) + 1)
      if (suffix ~ /^[[:space:]]+Parse:[[:space:]]/) {
        next
      }
    }
    /^[[:space:]]*Edit:[[:space:]]/ { next }
    { print }
  ' \
    source_file="$normalize_source_file" \
    "$normalize_input_file" \
    >"$normalize_output_file"
}

capture_parse() {
  capture_runtime=$1
  capture_source=$2
  capture_prefix=$3
  shift 3

  if [ "$#" -gt 0 ]; then
    set -- --edits "$@" -- "$capture_source"
  else
    set -- "$capture_source"
  fi

  case $capture_runtime in
  native)
    if parse_native "$@" \
      >"$capture_prefix.stdout" \
      2>"$capture_prefix.stderr"; then
      capture_status=0
    else
      capture_status=$?
    fi
    ;;
  wasm)
    if parse_wasm "$@" \
      >"$capture_prefix.stdout" \
      2>"$capture_prefix.stderr"; then
      capture_status=0
    else
      capture_status=$?
    fi
    ;;
  *)
    fail "Unknown parser runtime: $capture_runtime"
    ;;
  esac

  printf '%s\n' "$capture_status" >"$capture_prefix.status"
  normalize_parse_tree \
    "$capture_prefix.stdout" \
    "$capture_prefix.tree" \
    "$capture_source"
}

show_parse_result() {
  result_prefix=$1
  result_label=$2
  printf '%s\n' "$result_label" >&2
  printf '%s' 'Exit status: ' >&2
  sed -n '1p' "$result_prefix.status" >&2
  sed -n '1,200p' "$result_prefix.stdout" >&2
  sed -n '1,200p' "$result_prefix.stderr" >&2
}

assert_parse_status() {
  status_prefix=$1
  status_expected=$2
  status_label=$3
  status_actual=$(sed -n '1p' "$status_prefix.status")
  if [ "$status_actual" -ne "$status_expected" ]; then
    show_parse_result "$status_prefix" "$status_label"
    fail "Expected exit status $status_expected, received $status_actual: $status_label"
  fi
}

assert_trees_equal() {
  tree_expected=$1
  tree_actual=$2
  tree_label=$3
  if ! cmp -s "$tree_expected" "$tree_actual"; then
    diff -u "$tree_expected" "$tree_actual" >&2 || true
    fail "CSTs differ: $tree_label"
  fi
}

assert_fresh_cross_runtime() {
  fresh_source=$1
  fresh_test_name=$2
  fresh_expected_status=$3
  fresh_native_prefix="$runtime_directory/$fresh_test_name.native.fresh"
  fresh_wasm_prefix="$runtime_directory/$fresh_test_name.wasm.fresh"

  capture_parse native \
    "$fresh_source" \
    "$fresh_native_prefix"
  capture_parse wasm \
    "$fresh_source" \
    "$fresh_wasm_prefix"

  assert_parse_status \
    "$fresh_native_prefix" \
    "$fresh_expected_status" \
    "$fresh_test_name native fresh parse"
  assert_parse_status \
    "$fresh_wasm_prefix" \
    "$fresh_expected_status" \
    "$fresh_test_name Wasm fresh parse"
  assert_trees_equal \
    "$fresh_native_prefix.tree" \
    "$fresh_wasm_prefix.tree" \
    "$fresh_test_name native fresh and Wasm fresh"
}

tracer_source="$runtime_directory/tracer.awk"
printf '%s\n' \
  '# tracer' \
  'BEGIN {' \
  '  x /= 2' \
  '  print x ~ /a/' \
  '}' \
  >"$tracer_source"

assert_fresh_cross_runtime "$tracer_source" "tracer" 0
tracer_tree="$runtime_directory/tracer.native.fresh.tree"
assert_contains "div_assign" "$tracer_tree"
assert_contains "ere" "$tracer_tree"
assert_contains "ordinary_character" "$tracer_tree"
assert_not_contains "ERROR" "$tracer_tree"
assert_not_contains "MISSING" "$tracer_tree"
assert_not_contains "_recovery" "$tracer_tree"
tracer_slash_count=$(grep -Ec '^[[:space:][:digit:]:-]*"/"$' "$tracer_tree")
if [ "$tracer_slash_count" -ne 2 ]; then
  fail "Expected one opening and one closing ERE slash"
fi

slash_priority_source="$runtime_directory/slash-priority.awk"
printf '%s\n' 'BEGIN { print x /a/ }' >"$slash_priority_source"
assert_fresh_cross_runtime "$slash_priority_source" "slash-priority" 0
slash_priority_tree="$runtime_directory/slash-priority.native.fresh.tree"
assert_contains "expression_recovery" "$slash_priority_tree"
assert_not_contains "ERROR" "$slash_priority_tree"
assert_not_contains "MISSING" "$slash_priority_tree"
if grep -Eq \
  '^[[:space:][:digit:]:-]*ere([[:space:]]|$)' \
  "$slash_priority_tree"; then
  fail "Expected division priority to prevent an ERE node"
fi
priority_slash_count=$(
  grep -Ec '^[[:space:][:digit:]:-]*"/"$' "$slash_priority_tree"
)
if [ "$priority_slash_count" -ne 2 ]; then
  fail "Expected each division-priority slash to have one CST token"
fi

assert_incremental_equals_fresh() {
  incremental_initial_file=$1
  incremental_final_file=$2
  incremental_test_name=$3
  incremental_expected_status=$4
  shift 4

  node "$repository_directory/test/assert_runtime_edits.js" \
    "$incremental_test_name" \
    "$incremental_initial_file" \
    "$incremental_final_file" \
    "$@"

  native_incremental_prefix="$runtime_directory/$incremental_test_name.native.incremental"
  native_fresh_prefix="$runtime_directory/$incremental_test_name.native.fresh"
  wasm_incremental_prefix="$runtime_directory/$incremental_test_name.wasm.incremental"
  wasm_fresh_prefix="$runtime_directory/$incremental_test_name.wasm.fresh"

  capture_parse native \
    "$incremental_initial_file" \
    "$native_incremental_prefix" \
    "$@"
  capture_parse native \
    "$incremental_final_file" \
    "$native_fresh_prefix"
  capture_parse wasm \
    "$incremental_initial_file" \
    "$wasm_incremental_prefix" \
    "$@"
  capture_parse wasm \
    "$incremental_final_file" \
    "$wasm_fresh_prefix"

  assert_parse_status \
    "$native_incremental_prefix" \
    "$incremental_expected_status" \
    "$incremental_test_name native incremental parse"
  assert_parse_status \
    "$native_fresh_prefix" \
    "$incremental_expected_status" \
    "$incremental_test_name native fresh parse"
  assert_parse_status \
    "$wasm_incremental_prefix" \
    "$incremental_expected_status" \
    "$incremental_test_name Wasm incremental parse"
  assert_parse_status \
    "$wasm_fresh_prefix" \
    "$incremental_expected_status" \
    "$incremental_test_name Wasm fresh parse"

  assert_trees_equal \
    "$native_fresh_prefix.tree" \
    "$native_incremental_prefix.tree" \
    "$incremental_test_name native incremental and fresh"
  assert_trees_equal \
    "$wasm_fresh_prefix.tree" \
    "$wasm_incremental_prefix.tree" \
    "$incremental_test_name Wasm incremental and fresh"
  assert_trees_equal \
    "$native_fresh_prefix.tree" \
    "$wasm_fresh_prefix.tree" \
    "$incremental_test_name native fresh and Wasm fresh"
}

division_source="$runtime_directory/division.awk"
match_ere_source="$runtime_directory/match-ere.awk"
printf '%s\n' 'BEGIN { print x / a }' >"$division_source"
printf '%s\n' 'BEGIN { print x ~ /a/ }' >"$match_ere_source"
assert_incremental_equals_fresh \
  "$division_source" \
  "$match_ere_source" \
  "division-to-match-ere" \
  0 \
  '16 3 ~ /a/'

division_assignment_source="$runtime_directory/division-assignment.awk"
division_expression_source="$runtime_directory/division-expression.awk"
printf '%s\n' 'BEGIN { x /= 2 }' >"$division_assignment_source"
printf '%s\n' 'BEGIN { x / 2 }' >"$division_expression_source"
assert_incremental_equals_fresh \
  "$division_expression_source" \
  "$division_assignment_source" \
  "insert-div-assign-equals" \
  0 \
  '11 0 ='
assert_incremental_equals_fresh \
  "$division_assignment_source" \
  "$division_expression_source" \
  "delete-div-assign-equals" \
  0 \
  '11 1 '

match_operand_source="$runtime_directory/match-operand.awk"
printf '%s\n' 'BEGIN { print x ~ a }' >"$match_operand_source"
assert_incremental_equals_fresh \
  "$match_operand_source" \
  "$match_ere_source" \
  "operand-to-ere" \
  0 \
  '18 1 /a/'
assert_incremental_equals_fresh \
  "$match_ere_source" \
  "$match_operand_source" \
  "ere-to-operand" \
  0 \
  '18 3 a'

backslash=\\
line_continuation='\
'
raw_newline='
'

ere_source="$runtime_directory/ere.awk"
printf '%s\n' \
  'BEGIN {' \
  '  print /^a.(b|c)*?d{1,2}?$/' \
  '  print /[a-c][[.ch.]][[.-.]][[=a=]][[:alpha:]][\q\/]/' \
  '  print /\/\\\052\057\134./' \
  '}' \
  >"$ere_source"
assert_fresh_cross_runtime "$ere_source" "ere" 0
ere_tree="$runtime_directory/ere.native.fresh.tree"
for ere_node in \
  extended_reg_exp \
  ere_branch \
  ere_expression \
  one_char_or_coll_elem_ere \
  ere_dupl_symbol \
  repetition_modifier \
  bracket_expression \
  matching_list \
  bracket_list \
  follow_list \
  expression_term \
  single_expression \
  range_expression \
  start_range \
  end_range \
  collating_element \
  collating_symbol \
  equivalence_class \
  character_class \
  class_name \
  ordinary_character \
  quoted_character \
  wildcard \
  left_anchor \
  right_anchor \
  dup_count \
  meta_character \
  escape_sequence \
  escaped_delimiter; do
  assert_contains "$ere_node" "$ere_tree"
done
assert_not_contains "ERROR" "$ere_tree"
assert_not_contains "MISSING" "$ere_tree"
assert_not_contains "_recovery" "$ere_tree"

closed_ere_source="$runtime_directory/closed-ere.awk"
unclosed_ere_source="$runtime_directory/unclosed-ere.awk"
printf '%s\n' 'BEGIN { print /abc/' 'print /ok/ }' >"$closed_ere_source"
printf '%s\n' 'BEGIN { print /abc' 'print /ok/ }' >"$unclosed_ere_source"
assert_incremental_equals_fresh \
  "$closed_ere_source" \
  "$unclosed_ere_source" \
  "delete-ere-closing-slash" \
  0 \
  '18 1 '
delete_ere_slash_tree="$runtime_directory/delete-ere-closing-slash.native.fresh.tree"
assert_contains "ere_end_recovery" "$delete_ere_slash_tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:18[[:space:]]+ere_end_recovery$' \
  "$delete_ere_slash_tree"
assert_not_contains "ERROR" "$delete_ere_slash_tree"
assert_not_contains "MISSING" "$delete_ere_slash_tree"
assert_incremental_equals_fresh \
  "$unclosed_ere_source" \
  "$closed_ere_source" \
  "insert-ere-closing-slash" \
  0 \
  '18 0 /'
insert_ere_slash_tree="$runtime_directory/insert-ere-closing-slash.native.fresh.tree"
assert_not_contains "_recovery" "$insert_ere_slash_tree"

plain_ere_delimiter_source="$runtime_directory/plain-ere-delimiter.awk"
escaped_ere_delimiter_source="$runtime_directory/escaped-ere-delimiter.awk"
printf '%s\n' 'BEGIN { print /ab/ }' >"$plain_ere_delimiter_source"
printf '%s\n' 'BEGIN { print /ab\/c/ }' >"$escaped_ere_delimiter_source"
assert_incremental_equals_fresh \
  "$plain_ere_delimiter_source" \
  "$escaped_ere_delimiter_source" \
  "escape-ere-closing-slash" \
  0 \
  '17 1 \/c/'
escape_ere_slash_tree="$runtime_directory/escape-ere-closing-slash.native.fresh.tree"
assert_contains "escaped_delimiter" "$escape_ere_slash_tree"
assert_not_contains "_recovery" "$escape_ere_slash_tree"
assert_incremental_equals_fresh \
  "$division_source" \
  "$escaped_ere_delimiter_source" \
  "division-through-broken-to-escaped-ere" \
  0 \
  '14 5 /ab\/c/' \
  '20 1 ' \
  '20 0 /'
assert_incremental_equals_fresh \
  "$escaped_ere_delimiter_source" \
  "$plain_ere_delimiter_source" \
  "restore-ere-closing-slash" \
  0 \
  '17 4 /'
restore_ere_slash_tree="$runtime_directory/restore-ere-closing-slash.native.fresh.tree"
assert_not_contains "escaped_delimiter" "$restore_ere_slash_tree"

three_digit_octal_ere_source="$runtime_directory/three-digit-octal-ere.awk"
octal_followed_by_character_ere_source="$runtime_directory/octal-followed-by-character-ere.awk"
printf '%s\n' 'BEGIN { print /\124/ }' >"$three_digit_octal_ere_source"
printf '%s\n' 'BEGIN { print /\1234/ }' >"$octal_followed_by_character_ere_source"
assert_incremental_equals_fresh \
  "$three_digit_octal_ere_source" \
  "$octal_followed_by_character_ere_source" \
  "split-ere-octal-at-three-digits" \
  0 \
  '18 0 3'
split_ere_octal_tree="$runtime_directory/split-ere-octal-at-three-digits.native.fresh.tree"
assert_contains "escape_sequence" "$split_ere_octal_tree"
assert_contains "ordinary_character" "$split_ere_octal_tree"
assert_incremental_equals_fresh \
  "$octal_followed_by_character_ere_source" \
  "$three_digit_octal_ere_source" \
  "join-ere-octal-at-three-digits" \
  0 \
  '18 1 '
join_ere_octal_tree="$runtime_directory/join-ere-octal-at-three-digits.native.fresh.tree"
assert_contains "escape_sequence" "$join_ere_octal_tree"
assert_not_contains "ordinary_character" "$join_ere_octal_tree"

greedy_ere_source="$runtime_directory/greedy-ere.awk"
shortest_ere_source="$runtime_directory/shortest-ere.awk"
printf '%s\n' 'BEGIN { print /a*/ }' >"$greedy_ere_source"
printf '%s\n' 'BEGIN { print /a*?/ }' >"$shortest_ere_source"
assert_incremental_equals_fresh \
  "$greedy_ere_source" \
  "$shortest_ere_source" \
  "insert-ere-repetition-modifier" \
  0 \
  '17 0 ?'
insert_ere_modifier_tree="$runtime_directory/insert-ere-repetition-modifier.native.fresh.tree"
assert_contains "repetition_modifier" "$insert_ere_modifier_tree"
assert_incremental_equals_fresh \
  "$shortest_ere_source" \
  "$greedy_ere_source" \
  "delete-ere-repetition-modifier" \
  0 \
  '17 1 '
delete_ere_modifier_tree="$runtime_directory/delete-ere-repetition-modifier.native.fresh.tree"
assert_not_contains "repetition_modifier" "$delete_ere_modifier_tree"

equivalence_ere_source="$runtime_directory/equivalence-ere.awk"
class_ere_source="$runtime_directory/class-ere.awk"
printf '%s\n' 'BEGIN { print /[[=a=]]/ }' >"$equivalence_ere_source"
printf '%s\n' 'BEGIN { print /[[:alpha:]]/ }' >"$class_ere_source"
assert_incremental_equals_fresh \
  "$equivalence_ere_source" \
  "$class_ere_source" \
  "equivalence-to-character-class" \
  0 \
  '16 5 [:alpha:]'
class_ere_tree="$runtime_directory/equivalence-to-character-class.native.fresh.tree"
assert_contains "character_class" "$class_ere_tree"
assert_contains "class_name" "$class_ere_tree"
assert_not_contains "equivalence_class" "$class_ere_tree"
assert_incremental_equals_fresh \
  "$class_ere_source" \
  "$equivalence_ere_source" \
  "character-class-to-equivalence" \
  0 \
  '16 9 [=a=]'
equivalence_ere_tree="$runtime_directory/character-class-to-equivalence.native.fresh.tree"
assert_contains "equivalence_class" "$equivalence_ere_tree"
assert_not_contains "character_class" "$equivalence_ere_tree"

literal_open_bracket_ere_source="$runtime_directory/literal-open-bracket-ere.awk"
collating_symbol_ere_source="$runtime_directory/collating-symbol-ere.awk"
printf '%s\n' 'BEGIN { print /[[]/ }' >"$literal_open_bracket_ere_source"
printf '%s\n' 'BEGIN { print /[[.x.]]/ }' >"$collating_symbol_ere_source"
assert_incremental_equals_fresh \
  "$literal_open_bracket_ere_source" \
  "$collating_symbol_ere_source" \
  "literal-bracket-to-collating-symbol" \
  0 \
  '17 0 .x.]'
collating_symbol_ere_tree="$runtime_directory/literal-bracket-to-collating-symbol.native.fresh.tree"
assert_contains "collating_symbol" "$collating_symbol_ere_tree"
assert_not_contains "ERROR" "$collating_symbol_ere_tree"
assert_incremental_equals_fresh \
  "$collating_symbol_ere_source" \
  "$literal_open_bracket_ere_source" \
  "collating-symbol-to-literal-bracket" \
  0 \
  '17 4 '
literal_open_bracket_ere_tree="$runtime_directory/collating-symbol-to-literal-bracket.native.fresh.tree"
assert_contains "collating_element" "$literal_open_bracket_ere_tree"
assert_not_contains "collating_symbol" "$literal_open_bracket_ere_tree"

raw_ere_newline_source="$runtime_directory/raw-ere-newline.awk"
printf '%s\n' 'BEGIN { print /ab' '/ }' >"$raw_ere_newline_source"
assert_incremental_equals_fresh \
  "$plain_ere_delimiter_source" \
  "$raw_ere_newline_source" \
  "closed-ere-to-raw-newline" \
  0 \
  "17 0 $raw_newline"
raw_ere_newline_tree="$runtime_directory/closed-ere-to-raw-newline.native.fresh.tree"
assert_contains "ere_end_recovery" "$raw_ere_newline_tree"
assert_single_action_closer_recovery "$raw_ere_newline_tree"
assert_not_contains "ERROR" "$raw_ere_newline_tree"
assert_not_contains "MISSING" "$raw_ere_newline_tree"

eof_ere_recovery_source="$runtime_directory/eof-ere-recovery.awk"
printf '%s' 'BEGIN { print /abc' >"$eof_ere_recovery_source"
assert_fresh_cross_runtime \
  "$eof_ere_recovery_source" \
  "eof-ere-recovery" \
  0
eof_ere_recovery_tree="$runtime_directory/eof-ere-recovery.native.fresh.tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:18[[:space:]]+ere_end_recovery$' \
  "$eof_ere_recovery_tree"
assert_single_action_closer_recovery "$eof_ere_recovery_tree"
assert_not_contains "ERROR" "$eof_ere_recovery_tree"
assert_not_contains "MISSING" "$eof_ere_recovery_tree"

eof_ere_escape_recovery_source="$runtime_directory/eof-ere-escape-recovery.awk"
printf '%s' "BEGIN { print /abc$backslash" >"$eof_ere_escape_recovery_source"
assert_fresh_cross_runtime \
  "$eof_ere_escape_recovery_source" \
  "eof-ere-escape-recovery" \
  0
eof_ere_escape_recovery_tree="$runtime_directory/eof-ere-escape-recovery.native.fresh.tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:19[[:space:]]+ere_end_recovery([[:space:]]|$)' \
  "$eof_ere_escape_recovery_tree"
assert_single_action_closer_recovery "$eof_ere_escape_recovery_tree"
assert_not_contains "ERROR" "$eof_ere_escape_recovery_tree"
assert_not_contains "MISSING" "$eof_ere_escape_recovery_tree"

nested_group_eof_source="$runtime_directory/nested-group-eof.awk"
printf '%s' 'BEGIN { print /(a' >"$nested_group_eof_source"
assert_fresh_cross_runtime \
  "$nested_group_eof_source" \
  "nested-group-eof" \
  0
nested_group_eof_tree="$runtime_directory/nested-group-eof.native.fresh.tree"
assert_matches \
  '^0:17[[:space:]]*-[[:space:]]*0:17[[:space:]]+ere_inner_recovery$' \
  "$nested_group_eof_tree"
assert_matches \
  '^0:17[[:space:]]*-[[:space:]]*0:17[[:space:]]+ere_end_recovery$' \
  "$nested_group_eof_tree"
assert_single_action_closer_recovery "$nested_group_eof_tree"
assert_not_contains "ERROR" "$nested_group_eof_tree"
assert_not_contains "MISSING" "$nested_group_eof_tree"

raw_statement_newline_source="$runtime_directory/raw-statement-newline.awk"
continued_statement_boundary_source="$runtime_directory/continued-statement-boundary.awk"
printf '%s\n' \
  'BEGIN {' \
  '  print 1' \
  '}' \
  >"$raw_statement_newline_source"
printf '%s\n' \
  'BEGIN {' \
  "  print 1$backslash" \
  '}' \
  >"$continued_statement_boundary_source"
assert_incremental_equals_fresh \
  "$raw_statement_newline_source" \
  "$continued_statement_boundary_source" \
  "raw-newline-to-line-continuation" \
  0 \
  "17 0 $backslash"
assert_incremental_equals_fresh \
  "$continued_statement_boundary_source" \
  "$raw_statement_newline_source" \
  "line-continuation-to-raw-newline" \
  0 \
  '17 1 '

output_pipe_source="$runtime_directory/output-pipe.awk"
logical_or_print_source="$runtime_directory/logical-or-print.awk"
printf '%s\n' 'BEGIN { print value | command }' >"$output_pipe_source"
printf '%s\n' 'BEGIN { print value || command }' >"$logical_or_print_source"
assert_incremental_equals_fresh \
  "$output_pipe_source" \
  "$logical_or_print_source" \
  "output-pipe-to-logical-or" \
  0 \
  '21 0 |'
logical_or_print_tree="$runtime_directory/output-pipe-to-logical-or.native.fresh.tree"
assert_contains "operator: or" "$logical_or_print_tree"
assert_not_contains "output_redirection" "$logical_or_print_tree"
assert_not_contains "ERROR" "$logical_or_print_tree"
assert_not_contains "MISSING" "$logical_or_print_tree"
assert_not_contains "_recovery" "$logical_or_print_tree"

plain_append_source="$runtime_directory/plain-append.awk"
continued_append_source="$runtime_directory/continued-append.awk"
printf '%s\n' 'BEGIN { print value >> archive }' >"$plain_append_source"
printf '%s\n' \
  "BEGIN { print value $backslash" \
  '>> archive }' \
  >"$continued_append_source"
assert_incremental_equals_fresh \
  "$plain_append_source" \
  "$continued_append_source" \
  "insert-append-line-continuation" \
  0 \
  "20 0 $line_continuation"
continued_append_tree="$runtime_directory/insert-append-line-continuation.native.fresh.tree"
assert_contains "redirection: output_redirection" "$continued_append_tree"
assert_contains "append" "$continued_append_tree"
assert_clean_continuation_tree "$continued_append_tree"

terminated_break_source="$runtime_directory/terminated-break.awk"
continued_break_source="$runtime_directory/continued-break.awk"
printf '%s\n' \
  'BEGIN {' \
  '  break' \
  '  print value' \
  '}' \
  >"$terminated_break_source"
printf '%s\n' \
  'BEGIN {' \
  "  break$backslash" \
  '  print value' \
  '}' \
  >"$continued_break_source"
assert_incremental_equals_fresh \
  "$terminated_break_source" \
  "$continued_break_source" \
  "statement-newline-to-continuation" \
  0 \
  "15 0 $backslash"
continued_break_tree="$runtime_directory/statement-newline-to-continuation.native.fresh.tree"
assert_contains "break_keyword" "$continued_break_tree"
assert_contains "line_continuation" "$continued_break_tree"
assert_contains "terminator: terminator_recovery" "$continued_break_tree"
assert_contains "print_statement" "$continued_break_tree"
assert_not_contains "statement_recovery" "$continued_break_tree"
assert_not_contains "ERROR" "$continued_break_tree"
assert_not_contains "MISSING" "$continued_break_tree"

complete_if_source="$runtime_directory/complete-if.awk"
missing_consequence_source="$runtime_directory/missing-consequence.awk"
printf '%s\n' \
  'BEGIN { if (condition) consequence; else alternative }' \
  >"$complete_if_source"
printf '%s\n' \
  'BEGIN { if (condition) else alternative }' \
  >"$missing_consequence_source"
assert_incremental_equals_fresh \
  "$complete_if_source" \
  "$missing_consequence_source" \
  "delete-if-consequence" \
  0 \
  '23 13 '
missing_consequence_tree="$runtime_directory/delete-if-consequence.native.fresh.tree"
assert_contains "consequence: statement_recovery" "$missing_consequence_tree"
assert_contains "else_keyword" "$missing_consequence_tree"
assert_contains "alternative: unterminated_statement" "$missing_consequence_tree"
assert_not_contains "terminator_recovery" "$missing_consequence_tree"
assert_not_contains "ERROR" "$missing_consequence_tree"
assert_not_contains "MISSING" "$missing_consequence_tree"

closed_subscript_eof_source="$runtime_directory/closed-subscript-eof.awk"
open_subscript_eof_source="$runtime_directory/open-subscript-eof.awk"
printf '%s' 'BEGIN { delete array[offset] }' >"$closed_subscript_eof_source"
printf '%s' 'BEGIN { delete array[offset' >"$open_subscript_eof_source"
assert_incremental_equals_fresh \
  "$closed_subscript_eof_source" \
  "$open_subscript_eof_source" \
  "delete-subscript-and-action-closers-at-eof" \
  0 \
  '27 3 '
open_subscript_eof_tree="$runtime_directory/delete-subscript-and-action-closers-at-eof.native.fresh.tree"
assert_contains "subscripts: expr_list" "$open_subscript_eof_tree"
assert_single_action_closer_recovery "$open_subscript_eof_tree"
assert_not_contains "ERROR" "$open_subscript_eof_tree"
assert_not_contains "MISSING" "$open_subscript_eof_tree"
open_subscript_eof_closer_count=$(
  grep -Ec '^[[:space:][:digit:]:-]+closer_recovery$' "$open_subscript_eof_tree"
)
if [ "$open_subscript_eof_closer_count" -ne 1 ]; then
  fail "Expected one unfielded subscript closer-recovery node at physical EOF"
fi
assert_incremental_equals_fresh \
  "$open_subscript_eof_source" \
  "$closed_subscript_eof_source" \
  "insert-subscript-and-action-closers-at-eof" \
  0 \
  '27 0 ] }'
closed_subscript_eof_tree="$runtime_directory/insert-subscript-and-action-closers-at-eof.native.fresh.tree"
assert_not_contains "ERROR" "$closed_subscript_eof_tree"
assert_not_contains "MISSING" "$closed_subscript_eof_tree"
assert_not_contains "_recovery" "$closed_subscript_eof_tree"

comment_backslash_source="$runtime_directory/comment-backslash.awk"
leading_continuation_source="$runtime_directory/leading-continuation.awk"
printf '%s\n' "#$backslash" 'BEGIN {}' >"$comment_backslash_source"
printf '%s\n' "$backslash" 'BEGIN {}' >"$leading_continuation_source"
assert_incremental_equals_fresh \
  "$comment_backslash_source" \
  "$leading_continuation_source" \
  "comment-backslash-to-line-continuation" \
  0 \
  '0 1 '

blank_call_source="$runtime_directory/blank-call.awk"
continued_call_source="$runtime_directory/continued-call.awk"
printf '%s\n' 'BEGIN { f (value) }' >"$blank_call_source"
printf '%s\n' \
  "BEGIN { f$backslash" \
  '(value) }' \
  >"$continued_call_source"
assert_incremental_equals_fresh \
  "$blank_call_source" \
  "$continued_call_source" \
  "blank-to-line-continuation-call" \
  0 \
  "9 1 $line_continuation"
continued_call_tree="$runtime_directory/blank-to-line-continuation-call.native.fresh.tree"
assert_matches \
  '^[[:space:][:digit:]:-]*func_name[[:space:]]' \
  "$continued_call_tree"
assert_clean_continuation_tree "$continued_call_tree"

plain_add_assign_source="$runtime_directory/plain-add-assign.awk"
continued_add_assign_source="$runtime_directory/continued-add-assign.awk"
printf '%s\n' 'BEGIN { value += other }' >"$plain_add_assign_source"
printf '%s\n' \
  "BEGIN { value $backslash" \
  '+= other }' \
  >"$continued_add_assign_source"
assert_incremental_equals_fresh \
  "$plain_add_assign_source" \
  "$continued_add_assign_source" \
  "insert-add-assign-line-continuation" \
  0 \
  "14 0 $line_continuation"
continued_add_assign_tree="$runtime_directory/insert-add-assign-line-continuation.native.fresh.tree"
assert_contains "add_assign" "$continued_add_assign_tree"
assert_clean_continuation_tree "$continued_add_assign_tree"

plain_additive_source="$runtime_directory/plain-additive.awk"
continued_additive_source="$runtime_directory/continued-additive.awk"
printf '%s\n' 'BEGIN { left + right }' >"$plain_additive_source"
printf '%s\n' \
  "BEGIN { left$backslash" \
  '+ right }' \
  >"$continued_additive_source"
assert_incremental_equals_fresh \
  "$plain_additive_source" \
  "$continued_additive_source" \
  "insert-additive-operator-line-continuation" \
  0 \
  "12 1 $line_continuation"
continued_additive_tree="$runtime_directory/insert-additive-operator-line-continuation.native.fresh.tree"
assert_contains '"+"' "$continued_additive_tree"
assert_clean_continuation_tree "$continued_additive_tree"

plain_comparison_source="$runtime_directory/plain-comparison.awk"
continued_comparison_source="$runtime_directory/continued-comparison.awk"
printf '%s\n' 'BEGIN { left < right }' >"$plain_comparison_source"
printf '%s\n' \
  "BEGIN { left$backslash" \
  '< right }' \
  >"$continued_comparison_source"
assert_incremental_equals_fresh \
  "$plain_comparison_source" \
  "$continued_comparison_source" \
  "insert-comparison-operator-line-continuation" \
  0 \
  "12 1 $line_continuation"
continued_comparison_tree="$runtime_directory/insert-comparison-operator-line-continuation.native.fresh.tree"
assert_contains '"<"' "$continued_comparison_tree"
assert_clean_continuation_tree "$continued_comparison_tree"

continued_getline_redirect_source="$runtime_directory/continued-getline-redirect.awk"
continued_getline_comparison_source="$runtime_directory/continued-getline-comparison.awk"
printf '%s\n' \
  "BEGIN { getline target$backslash" \
  '< source }' \
  >"$continued_getline_redirect_source"
printf '%s\n' \
  "BEGIN { getline target$backslash" \
  '<= source }' \
  >"$continued_getline_comparison_source"
assert_fresh_cross_runtime \
  "$continued_getline_redirect_source" \
  "continued-getline-redirect" \
  0
continued_getline_redirect_tree="$runtime_directory/continued-getline-redirect.native.fresh.tree"
assert_contains "source: expr" "$continued_getline_redirect_tree"
assert_not_contains "operator: le" "$continued_getline_redirect_tree"
assert_clean_continuation_tree "$continued_getline_redirect_tree"
assert_incremental_equals_fresh \
  "$continued_getline_redirect_source" \
  "$continued_getline_comparison_source" \
  "continued-getline-redirect-to-comparison" \
  0 \
  '25 0 ='
continued_getline_comparison_tree="$runtime_directory/continued-getline-redirect-to-comparison.native.fresh.tree"
assert_contains "operator: le" "$continued_getline_comparison_tree"
assert_not_contains "source: expr" "$continued_getline_comparison_tree"
assert_clean_continuation_tree "$continued_getline_comparison_tree"

plain_conditional_source="$runtime_directory/plain-conditional.awk"
continued_conditional_source="$runtime_directory/continued-conditional.awk"
printf '%s\n' 'BEGIN { condition ? yes : no }' >"$plain_conditional_source"
printf '%s\n' \
  "BEGIN { condition ? yes$backslash" \
  ': no }' \
  >"$continued_conditional_source"
assert_incremental_equals_fresh \
  "$plain_conditional_source" \
  "$continued_conditional_source" \
  "insert-conditional-colon-line-continuation" \
  0 \
  "23 1 $line_continuation"
continued_conditional_tree="$runtime_directory/insert-conditional-colon-line-continuation.native.fresh.tree"
assert_contains "alternative: expr" "$continued_conditional_tree"
assert_clean_continuation_tree "$continued_conditional_tree"

plain_logical_source="$runtime_directory/plain-logical.awk"
continued_logical_source="$runtime_directory/continued-logical.awk"
printf '%s\n' 'BEGIN { left && right }' >"$plain_logical_source"
printf '%s\n' \
  "BEGIN { left$backslash" \
  '&& right }' \
  >"$continued_logical_source"
assert_incremental_equals_fresh \
  "$plain_logical_source" \
  "$continued_logical_source" \
  "insert-logical-operator-line-continuation" \
  0 \
  "12 1 $line_continuation"
continued_logical_tree="$runtime_directory/insert-logical-operator-line-continuation.native.fresh.tree"
assert_contains "and" "$continued_logical_tree"
assert_clean_continuation_tree "$continued_logical_tree"

plain_pipe_getline_source="$runtime_directory/plain-pipe-getline.awk"
continued_pipe_getline_source="$runtime_directory/continued-pipe-getline.awk"
printf '%s\n' 'BEGIN { source | getline target }' >"$plain_pipe_getline_source"
printf '%s\n' \
  "BEGIN { source$backslash" \
  '| getline target }' \
  >"$continued_pipe_getline_source"
assert_incremental_equals_fresh \
  "$plain_pipe_getline_source" \
  "$continued_pipe_getline_source" \
  "insert-input-pipe-line-continuation" \
  0 \
  "14 1 $line_continuation"
continued_pipe_getline_tree="$runtime_directory/insert-input-pipe-line-continuation.native.fresh.tree"
assert_contains "non_unary_input_function" "$continued_pipe_getline_tree"
assert_clean_continuation_tree "$continued_pipe_getline_tree"

unary_pipe_getline_source="$runtime_directory/unary-pipe-getline.awk"
field_pipe_getline_source="$runtime_directory/field-pipe-getline.awk"
printf '%s\n' 'BEGIN { -source | getline target }' >"$unary_pipe_getline_source"
printf '%s\n' "BEGIN { \$source | getline target }" >"$field_pipe_getline_source"
assert_incremental_equals_fresh \
  "$unary_pipe_getline_source" \
  "$field_pipe_getline_source" \
  "unary-to-field-pipe-getline" \
  0 \
  '8 1 $'
field_pipe_getline_tree="$runtime_directory/unary-to-field-pipe-getline.native.fresh.tree"
assert_matches \
  '^[[:space:][:digit:]:-]*non_unary_input_function$' \
  "$field_pipe_getline_tree"
assert_not_contains "ERROR" "$field_pipe_getline_tree"
assert_not_contains "MISSING" "$field_pipe_getline_tree"
assert_not_contains "_recovery" "$field_pipe_getline_tree"

redirected_input_source="$runtime_directory/redirected-input-source.awk"
missing_input_source="$runtime_directory/missing-input-source.awk"
printf '%s\n' 'BEGIN { getline target < source}' >"$redirected_input_source"
printf '%s\n' 'BEGIN { getline target < }' >"$missing_input_source"
assert_incremental_equals_fresh \
  "$redirected_input_source" \
  "$missing_input_source" \
  "delete-redirected-input-source" \
  0 \
  '25 6 '
missing_input_tree="$runtime_directory/delete-redirected-input-source.native.fresh.tree"
assert_contains "non_unary_input_function" "$missing_input_tree"
assert_contains "expression_recovery" "$missing_input_tree"
assert_not_contains "ERROR" "$missing_input_tree"
assert_not_contains "MISSING" "$missing_input_tree"

string_source="$runtime_directory/string.awk"
printf '%s\n' \
  'BEGIN {' \
  '  "value"' \
  '  print "" "a #/é value" "\"\\\a\b\f\n\r\t\v\/\.\q\x"' \
  '  print "\1234" "abcd" "\\n"' \
  '}' \
  >"$string_source"
assert_fresh_cross_runtime "$string_source" "string" 0
string_tree="$runtime_directory/string.native.fresh.tree"
assert_contains "string_content" "$string_tree"
assert_contains "escape_sequence" "$string_tree"
assert_not_contains "line_continuation" "$string_tree"
assert_not_contains "ERROR" "$string_tree"
assert_not_contains "MISSING" "$string_tree"
assert_not_contains "_recovery" "$string_tree"

raw_string_recovery_source="$runtime_directory/raw-string-recovery.awk"
printf '%s\n' \
  'BEGIN { print "abc' \
  'print "ok" }' \
  >"$raw_string_recovery_source"
assert_fresh_cross_runtime "$raw_string_recovery_source" "raw-string-recovery" 0
raw_string_recovery_tree="$runtime_directory/raw-string-recovery.native.fresh.tree"
assert_matches \
  '^0:14[[:space:]]*-[[:space:]]*0:18[[:space:]]+string$' \
  "$raw_string_recovery_tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:18[[:space:]]+string_end_recovery$' \
  "$raw_string_recovery_tree"
assert_not_contains "ERROR" "$raw_string_recovery_tree"
assert_not_contains "MISSING" "$raw_string_recovery_tree"

eof_string_recovery_source="$runtime_directory/eof-string-recovery.awk"
printf '%s' 'BEGIN { print "abc' >"$eof_string_recovery_source"
assert_fresh_cross_runtime "$eof_string_recovery_source" "eof-string-recovery" 0
eof_string_recovery_tree="$runtime_directory/eof-string-recovery.native.fresh.tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:18[[:space:]]+string_end_recovery$' \
  "$eof_string_recovery_tree"
assert_single_action_closer_recovery "$eof_string_recovery_tree"
assert_not_contains "ERROR" "$eof_string_recovery_tree"
assert_not_contains "MISSING" "$eof_string_recovery_tree"

continued_lone_escape_source="$runtime_directory/continued-lone-escape.awk"
printf '%s\n' \
  "BEGIN { print \"abc$backslash$backslash" \
  >"$continued_lone_escape_source"
assert_fresh_cross_runtime \
  "$continued_lone_escape_source" \
  "continued-lone-escape" \
  0
continued_lone_escape_tree="$runtime_directory/continued-lone-escape.native.fresh.tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:20[[:space:]]+escape_sequence[[:space:]]' \
  "$continued_lone_escape_tree"
assert_matches \
  '^0:20[[:space:]]*-[[:space:]]*0:20[[:space:]]+string_end_recovery$' \
  "$continued_lone_escape_tree"
assert_single_action_closer_recovery "$continued_lone_escape_tree"
assert_not_contains "ERROR" "$continued_lone_escape_tree"
assert_not_contains "MISSING" "$continued_lone_escape_tree"

raw_lone_escape_recovery_source="$runtime_directory/raw-lone-escape-recovery.awk"
printf '%s\n' \
  "BEGIN { print \"abc$backslash$backslash" \
  '' \
  'print "ok" }' \
  >"$raw_lone_escape_recovery_source"
assert_fresh_cross_runtime \
  "$raw_lone_escape_recovery_source" \
  "raw-lone-escape-recovery" \
  0
raw_lone_escape_recovery_tree="$runtime_directory/raw-lone-escape-recovery.native.fresh.tree"
assert_matches \
  '^0:18[[:space:]]*-[[:space:]]*0:20[[:space:]]+escape_sequence[[:space:]]' \
  "$raw_lone_escape_recovery_tree"
assert_matches \
  '^0:20[[:space:]]*-[[:space:]]*0:20[[:space:]]+string_end_recovery$' \
  "$raw_lone_escape_recovery_tree"
assert_matches \
  '^0:20[[:space:]]*-[[:space:]]*1:0[[:space:]]+terminator:[[:space:]]+newline$' \
  "$raw_lone_escape_recovery_tree"
assert_not_contains "ERROR" "$raw_lone_escape_recovery_tree"
assert_not_contains "MISSING" "$raw_lone_escape_recovery_tree"

closed_string_source="$runtime_directory/closed-string.awk"
unclosed_string_source="$runtime_directory/unclosed-string.awk"
printf '%s\n' 'BEGIN { print "abc"' '}' >"$closed_string_source"
printf '%s\n' 'BEGIN { print "abc' '}' >"$unclosed_string_source"
assert_incremental_equals_fresh \
  "$closed_string_source" \
  "$unclosed_string_source" \
  "delete-string-closing-quote" \
  0 \
  '18 1 '
delete_string_quote_tree="$runtime_directory/delete-string-closing-quote.native.fresh.tree"
assert_contains "string_end_recovery" "$delete_string_quote_tree"
assert_not_contains "ERROR" "$delete_string_quote_tree"
assert_not_contains "MISSING" "$delete_string_quote_tree"
assert_incremental_equals_fresh \
  "$unclosed_string_source" \
  "$closed_string_source" \
  "insert-string-closing-quote" \
  0 \
  '18 0 "'
insert_string_quote_tree="$runtime_directory/insert-string-closing-quote.native.fresh.tree"
assert_not_contains "_recovery" "$insert_string_quote_tree"

plain_escape_source="$runtime_directory/plain-escape.awk"
backslash_escape_source="$runtime_directory/backslash-escape.awk"
printf '%s\n' 'BEGIN { print "an" }' >"$plain_escape_source"
printf '%s\n' 'BEGIN { print "a\n" }' >"$backslash_escape_source"
assert_incremental_equals_fresh \
  "$plain_escape_source" \
  "$backslash_escape_source" \
  "insert-string-escape-backslash" \
  0 \
  "16 0 $backslash"
insert_escape_backslash_tree="$runtime_directory/insert-string-escape-backslash.native.fresh.tree"
assert_contains "escape_sequence" "$insert_escape_backslash_tree"
assert_incremental_equals_fresh \
  "$backslash_escape_source" \
  "$plain_escape_source" \
  "delete-string-escape-backslash" \
  0 \
  '16 1 '
delete_escape_backslash_tree="$runtime_directory/delete-string-escape-backslash.native.fresh.tree"
assert_not_contains "escape_sequence" "$delete_escape_backslash_tree"

top_level_ere_pattern_source="$runtime_directory/top-level-ere-pattern.awk"
top_level_division_pattern_source="$runtime_directory/top-level-division-pattern.awk"
printf '%s\n' '/ready/ { print }' >"$top_level_ere_pattern_source"
printf '%s\n' 'total / count { print }' >"$top_level_division_pattern_source"
assert_incremental_equals_fresh \
  "$top_level_ere_pattern_source" \
  "$top_level_division_pattern_source" \
  "top-level-ere-to-division-pattern" \
  0 \
  '0 7 total / count'
division_pattern_tree="$runtime_directory/top-level-ere-to-division-pattern.native.fresh.tree"
assert_contains "normal_pattern" "$division_pattern_tree"
assert_not_contains "extended_reg_exp" "$division_pattern_tree"
assert_not_contains "ERROR" "$division_pattern_tree"
assert_not_contains "MISSING" "$division_pattern_tree"
assert_not_contains "_recovery" "$division_pattern_tree"
division_pattern_slash_count=$(
  grep -Ec '^[[:space:][:digit:]:-]*"/"$' "$division_pattern_tree"
)
if [ "$division_pattern_slash_count" -ne 1 ]; then
  fail "Expected one division slash in the top-level normal pattern"
fi
assert_incremental_equals_fresh \
  "$top_level_division_pattern_source" \
  "$top_level_ere_pattern_source" \
  "top-level-division-to-ere-pattern" \
  0 \
  '0 13 /ready/'
ere_pattern_tree="$runtime_directory/top-level-division-to-ere-pattern.native.fresh.tree"
assert_contains "normal_pattern" "$ere_pattern_tree"
assert_contains "extended_reg_exp" "$ere_pattern_tree"
assert_not_contains "ERROR" "$ere_pattern_tree"
assert_not_contains "MISSING" "$ere_pattern_tree"
assert_not_contains "_recovery" "$ere_pattern_tree"
ere_pattern_slash_count=$(
  grep -Ec '^[[:space:][:digit:]:-]*"/"$' "$ere_pattern_tree"
)
if [ "$ere_pattern_slash_count" -ne 2 ]; then
  fail "Expected opening and closing slashes in the top-level ERE pattern"
fi

adjacent_function_name_source="$runtime_directory/adjacent-function-name.awk"
continued_spaced_function_name_source="$runtime_directory/continued-spaced-function-name.awk"
printf '%s\n' 'function compute(value) {}' >"$adjacent_function_name_source"
printf '%s\n' \
  "function compute $backslash" \
  '(value) {}' \
  >"$continued_spaced_function_name_source"
assert_incremental_equals_fresh \
  "$adjacent_function_name_source" \
  "$continued_spaced_function_name_source" \
  "adjacent-to-continued-spaced-function-name" \
  0 \
  "16 0  $line_continuation"
continued_spaced_function_name_tree="$runtime_directory/adjacent-to-continued-spaced-function-name.native.fresh.tree"
assert_matches \
  "^[[:space:][:digit:]:-]*name:[[:space:]]+name[[:space:]]+\`compute\`$" \
  "$continued_spaced_function_name_tree"
assert_not_contains "func_name" "$continued_spaced_function_name_tree"
assert_clean_continuation_tree "$continued_spaced_function_name_tree"
assert_incremental_equals_fresh \
  "$continued_spaced_function_name_source" \
  "$adjacent_function_name_source" \
  "continued-spaced-to-adjacent-function-name" \
  0 \
  '16 3 '
adjacent_function_name_tree="$runtime_directory/continued-spaced-to-adjacent-function-name.native.fresh.tree"
assert_matches \
  "^[[:space:][:digit:]:-]*name:[[:space:]]+func_name[[:space:]]+\`compute\`$" \
  "$adjacent_function_name_tree"
assert_not_contains "line_continuation" "$adjacent_function_name_tree"
assert_not_contains "ERROR" "$adjacent_function_name_tree"
assert_not_contains "MISSING" "$adjacent_function_name_tree"
assert_not_contains "_recovery" "$adjacent_function_name_tree"

compact_range_pattern_source="$runtime_directory/compact-range-pattern.awk"
multiline_range_pattern_source="$runtime_directory/multiline-range-pattern.awk"
printf '%s\n' 'start,stop {}' >"$compact_range_pattern_source"
printf '%s\n' 'start,' 'stop {}' >"$multiline_range_pattern_source"
assert_incremental_equals_fresh \
  "$compact_range_pattern_source" \
  "$multiline_range_pattern_source" \
  "insert-range-pattern-newline" \
  0 \
  "6 0 $raw_newline"
multiline_range_pattern_tree="$runtime_directory/insert-range-pattern-newline.native.fresh.tree"
assert_contains "normal_pattern" "$multiline_range_pattern_tree"
assert_contains "left: expr" "$multiline_range_pattern_tree"
assert_contains "right: expr" "$multiline_range_pattern_tree"
assert_contains "newline_opt" "$multiline_range_pattern_tree"
assert_not_contains "ERROR" "$multiline_range_pattern_tree"
assert_not_contains "MISSING" "$multiline_range_pattern_tree"
assert_not_contains "_recovery" "$multiline_range_pattern_tree"
range_newline_opt_count=$(
  grep -Ec '^[[:space:][:digit:]:-]+newline_opt$' "$multiline_range_pattern_tree"
)
if [ "$range_newline_opt_count" -ne 1 ]; then
  fail "Expected one range-pattern newline_opt owner"
fi
assert_incremental_equals_fresh \
  "$multiline_range_pattern_source" \
  "$compact_range_pattern_source" \
  "delete-range-pattern-newline" \
  0 \
  '6 1 '
compact_range_pattern_tree="$runtime_directory/delete-range-pattern-newline.native.fresh.tree"
assert_not_contains "newline_opt" "$compact_range_pattern_tree"
assert_not_contains "ERROR" "$compact_range_pattern_tree"
assert_not_contains "MISSING" "$compact_range_pattern_tree"
assert_not_contains "_recovery" "$compact_range_pattern_tree"

separated_closed_items_source="$runtime_directory/separated-closed-items.awk"
direct_open_action_item_source="$runtime_directory/direct-open-action-item.awk"
printf '%s\n%s' 'BEGIN {}' 'END {}' >"$separated_closed_items_source"
printf '%s' 'BEGIN {END {}' >"$direct_open_action_item_source"
assert_incremental_equals_fresh \
  "$separated_closed_items_source" \
  "$direct_open_action_item_source" \
  "delete-action-close-and-item-terminator" \
  0 \
  '7 2 '
direct_open_action_item_tree="$runtime_directory/delete-action-close-and-item-terminator.native.fresh.tree"
assert_contains "closing: action_item_boundary_recovery" "$direct_open_action_item_tree"
assert_contains "terminator: terminator_recovery" "$direct_open_action_item_tree"
assert_contains "end_keyword" "$direct_open_action_item_tree"
assert_not_contains "closer_recovery" "$direct_open_action_item_tree"
assert_not_contains "ERROR" "$direct_open_action_item_tree"
assert_not_contains "MISSING" "$direct_open_action_item_tree"
action_item_boundary_recovery_count=$(
  grep -Ec \
    '^[[:space:][:digit:]:-]+closing:[[:space:]]+action_item_boundary_recovery$' \
    "$direct_open_action_item_tree"
)
if [ "$action_item_boundary_recovery_count" -ne 1 ]; then
  fail "Expected one direct action item-boundary recovery"
fi
item_terminator_recovery_count=$(
  grep -Ec \
    '^[[:space:][:digit:]:-]+terminator:[[:space:]]+terminator_recovery$' \
    "$direct_open_action_item_tree"
)
if [ "$item_terminator_recovery_count" -ne 1 ]; then
  fail "Expected one recovered top-level item terminator"
fi
assert_incremental_equals_fresh \
  "$direct_open_action_item_source" \
  "$separated_closed_items_source" \
  "restore-action-close-and-item-terminator" \
  0 \
  "7 0 }$raw_newline"
separated_closed_items_tree="$runtime_directory/restore-action-close-and-item-terminator.native.fresh.tree"
assert_contains "terminator: terminator" "$separated_closed_items_tree"
assert_not_contains "ERROR" "$separated_closed_items_tree"
assert_not_contains "MISSING" "$separated_closed_items_tree"
assert_not_contains "_recovery" "$separated_closed_items_tree"
