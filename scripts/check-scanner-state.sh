#!/bin/sh

set -eu

repository_directory=$(
  CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd
)
test_directory=$(
  mktemp -d "${TMPDIR:-/tmp}/tree-sitter-posix-awk-scanner-state.XXXXXX"
)
test_binary="$test_directory/scanner-state"
c_compiler=${CC:-cc}

cleanup() {
  find "$test_directory" -depth -delete
}
trap cleanup EXIT HUP INT TERM

"$c_compiler" \
  -std=c11 \
  -Wall \
  -Wextra \
  -Werror \
  -pedantic \
  -I "$repository_directory/src" \
  "$repository_directory/test/scanner_state.c" \
  -o "$test_binary"

"$test_binary"
