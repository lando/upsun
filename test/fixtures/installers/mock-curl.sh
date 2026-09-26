#!/bin/bash
set -eo pipefail
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
if [[ "$url" == */latest ]]; then
  printf 'https://github.com/platformsh/cli/releases/tag/v5.0.0'
elif [ -n "$output" ]; then
  cp "$MOCK_CURL_DIR/${url##*/}" "$output"
else
  cat "$MOCK_CURL_DIR/${url##*/}"
fi
