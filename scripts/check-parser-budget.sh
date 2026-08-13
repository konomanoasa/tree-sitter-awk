#!/bin/sh

set -eu

repository_directory=$(
  CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd
)
parser_file="$repository_directory/src/parser.c"

# These limits leave a small allowance above the reviewed parser. Raising one
# requires identifying and reviewing the source of the growth first.
maximum_state_count=31000
maximum_large_state_count=5050
maximum_symbol_count=450
maximum_external_token_count=112
maximum_parser_bytes=46000000
maximum_action_index=42000

read_define() {
  awk -v expected="$1" '
    $1 == "#define" && $2 == expected {
      if ($3 !~ /^[0-9][0-9]*$/) {
        exit 1
      }
      print $3
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$parser_file"
}

read_maximum_action_index() {
  awk '
    {
      remaining = $0
      while (match(remaining, /ACTIONS\([0-9][0-9]*\)/)) {
        value = substr(remaining, RSTART + 8, RLENGTH - 9) + 0
        if (!found || value > maximum) {
          maximum = value
        }
        found = 1
        remaining = substr(remaining, RSTART + RLENGTH)
      }
    }
    END {
      if (!found) {
        exit 1
      }
      print maximum
    }
  ' "$parser_file"
}

check_maximum() {
  label=$1
  actual=$2
  maximum=$3
  if [ "$actual" -le "$maximum" ]; then
    return 0
  fi
  printf '%s exceeds its parser budget: %s > %s\n' \
    "$label" "$actual" "$maximum" >&2
  return 1
}

state_count=$(read_define STATE_COUNT)
large_state_count=$(read_define LARGE_STATE_COUNT)
symbol_count=$(read_define SYMBOL_COUNT)
external_token_count=$(read_define EXTERNAL_TOKEN_COUNT)
parser_bytes=$(wc -c <"$parser_file" | tr -d '[:space:]')
action_index=$(read_maximum_action_index)

printf '%-22s %12s %12s\n' Metric Actual Maximum
printf '%-22s %12s %12s\n' \
  STATE_COUNT "$state_count" "$maximum_state_count" \
  LARGE_STATE_COUNT "$large_state_count" "$maximum_large_state_count" \
  SYMBOL_COUNT "$symbol_count" "$maximum_symbol_count" \
  EXTERNAL_TOKEN_COUNT "$external_token_count" "$maximum_external_token_count" \
  parser_bytes "$parser_bytes" "$maximum_parser_bytes" \
  maximum_ACTIONS_index "$action_index" "$maximum_action_index"

failed=0
check_maximum STATE_COUNT "$state_count" "$maximum_state_count" || failed=1
check_maximum LARGE_STATE_COUNT \
  "$large_state_count" "$maximum_large_state_count" || failed=1
check_maximum SYMBOL_COUNT "$symbol_count" "$maximum_symbol_count" || failed=1
check_maximum EXTERNAL_TOKEN_COUNT \
  "$external_token_count" "$maximum_external_token_count" || failed=1
check_maximum parser_bytes "$parser_bytes" "$maximum_parser_bytes" || failed=1
check_maximum maximum_ACTIONS_index \
  "$action_index" "$maximum_action_index" || failed=1

exit "$failed"
