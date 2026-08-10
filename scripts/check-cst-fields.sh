#!/bin/sh

set -eu

repository_directory=$(
  CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd
)
tree_sitter="$repository_directory/node_modules/.bin/tree-sitter"
grammar_parent_directory=$(
  CDPATH='' cd -- "$repository_directory/.." && pwd
)
test_directory=$(
  mktemp -d "${TMPDIR:-/tmp}/tree-sitter-posix-awk-fields.XXXXXX"
)
parser_library="$test_directory/parser"
tree_sitter_config="$test_directory/config.json"
capture_output="$test_directory/captures.txt"

# ShellCheck cannot see that the trap invokes this callback.
# shellcheck disable=SC2329
cleanup() {
  find "$test_directory" -depth -delete
}
trap cleanup EXIT HUP INT TERM

node -e \
  'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ "parser-directories": [process.argv[2]] }, null, 2) + "\n");' \
  "$tree_sitter_config" \
  "$grammar_parent_directory"

"$tree_sitter" build \
  --output "$parser_library" \
  "$repository_directory"

NO_COLOR=1 "$tree_sitter" query \
  --config-path "$tree_sitter_config" \
  --lib-path "$parser_library" \
  --lang-name posix_awk \
  --captures \
  "$repository_directory/test/field_contract.scm" \
  "$repository_directory/test/field_contract.awk" \
  >"$capture_output"

actual_captures=$(
  sed -n 's/.* - \([^,]*\), start:.*/\1/p' "$capture_output" |
    LC_ALL=C sort
)
expected_captures='action.closing
action.opening
ere-expression.closing
ere-expression.opening
ere.closing
ere.closing
ere.opening
ere.opening
extended-reg-exp.operator
lvalue.operator
non-unary-expr.operator
non-unary-expr.operator
non-unary-print-expr.operator
normal-pattern.separator
string.closing
string.opening
terminated-statement.terminator
terminated-statement.terminator
terminated-statement.terminator
terminated-statement.terminator
unary-expr.operator
unary-print-expr.operator'

if [ "$actual_captures" != "$expected_captures" ]; then
  printf '%s\n%s\n' \
    "Anonymous-token field contract differs." \
    "$capture_output" >&2
  exit 1
fi
