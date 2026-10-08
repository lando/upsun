#!/bin/bash
set -e

[ -n "${MOCK_FPM_PID:-}" ] || exit 1
printf '%s\n' "$MOCK_FPM_PID"
