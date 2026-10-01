#!/bin/bash
set -e

printf '%s\n' "$@" > "$MOCK_SUPERCRONIC_LOG"
cat "${@: -1}" >> "$MOCK_SUPERCRONIC_LOG"
exit 0
