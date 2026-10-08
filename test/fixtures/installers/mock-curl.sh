#!/bin/bash
set -eo pipefail
url=""
output=""
retry=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift ;;
    --retry) retry="$2"; shift ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
printf '%s\n' "$retry" >> "$MOCK_CURL_LOG.retry"
if [[ "$url" == */latest ]]; then
  printf 'https://github.com/upsun/cli/releases/tag/v5.0.0'
elif [ -n "$output" ]; then
  cp "$MOCK_CURL_DIR/${url##*/}" "$output"
else
  cat "$MOCK_CURL_DIR/${url##*/}"
fi
