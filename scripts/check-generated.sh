#!/bin/sh

set -eu

repository_directory=$(
  CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd
)
generation_directory=$(
  mktemp -d "${TMPDIR:-/tmp}/tree-sitter-posix-awk-generated.XXXXXX"
)

# ShellCheck cannot see that the trap invokes this callback.
# shellcheck disable=SC2329
cleanup() {
  find "$generation_directory" -depth -delete
}
trap cleanup EXIT HUP INT TERM

expected_generated_files='grammar.json
node-types.json
parser.c
tree_sitter/alloc.h
tree_sitter/array.h
tree_sitter/parser.h'

(
  cd "$repository_directory"
  ./node_modules/.bin/tree-sitter generate \
    --output "$generation_directory" \
    grammar.js
)

stale=0
actual_generated_files=$(
  cd "$generation_directory"
  find . -type f -print | sed 's|^\./||' | LC_ALL=C sort
)
if [ "$actual_generated_files" != "$expected_generated_files" ]; then
  printf '%s\n' "Generated file manifest differs." >&2
  printf '%s\n%s\n' "Expected:" "$expected_generated_files" >&2
  printf '%s\n%s\n' "Actual:" "$actual_generated_files" >&2
  stale=1
fi

for generated_file in $expected_generated_files; do
  if ! cmp -s \
    "$generation_directory/$generated_file" \
    "$repository_directory/src/$generated_file"; then
    printf '%s\n' "Generated file is stale: src/$generated_file" >&2
    stale=1
  fi
done

exit "$stale"
