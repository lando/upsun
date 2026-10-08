#!/bin/bash
set -e

client="$(basename "$0")"
printf '%s %s\n' "$client" "$*" >> "$MOCK_SQL_LOG"

case " $* " in
  *" SELECT 1 "*)
    [ -z "${MOCK_SQL_READY_AFTER:-}" ] || [ -e "$MOCK_SQL_READY_AFTER" ] || exit 1
    if [ -n "${MOCK_SQL_READY_AFTER_PROBES:-}" ]; then
      probes=$(($(cat "$MOCK_SQL_LOG.probes" 2>/dev/null || echo 0) + 1))
      printf "%s" "$probes" > "$MOCK_SQL_LOG.probes"
      [ "$probes" -ge "$MOCK_SQL_READY_AFTER_PROBES" ] || exit 1
    fi
    exit 0
    ;;
esac

sql_file=""
previous=""
for argument in "$@"; do
  if [ "$previous" = file ]; then
    sql_file="$argument"
    break
  fi
  [ "$argument" = -f ] && previous=file
done

if [ -n "$sql_file" ]; then
  cat "$sql_file" >> "$MOCK_SQL_LOG.sql"
else
  cat >> "$MOCK_SQL_LOG.sql"
fi
