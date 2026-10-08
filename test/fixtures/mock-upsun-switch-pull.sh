#!/bin/bash
set -e

printf '%s\n' "$@" > "$MOCK_PULL_LOG"
exit "${MOCK_PULL_RC:-0}"
