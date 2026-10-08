#!/bin/bash
set -e

if [ "$1" != db:dump ]; then
  exec "$(dirname "$0")/mock-platform.sh" "$@"
fi

printf '%s\n' "$*" >> "$MOCK_PLATFORM_LOG"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -f ]; then
    gzip -c "$MOCK_DUMP_FILE" > "$2"
    exit 0
  fi
  shift
done
exit 2
