#!/bin/bash
set -e

url=""
output=""
previous=""
for argument in "$@"; do
  if [ "$previous" = output ]; then
    output="$argument"
    previous=""
    continue
  fi
  case "$argument" in
    -o) previous='output' ;;
    http://*|https://*) url="$argument" ;;
  esac
done

printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
source_file="$MOCK_CURL_DIR/${url##*/}"
[ -f "$source_file" ] || exit 22
if [ -n "$output" ]; then
  cp "$source_file" "$output"
else
  cat "$source_file"
fi
