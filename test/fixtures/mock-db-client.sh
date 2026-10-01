#!/bin/bash
set -e

. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

case "$(basename "$0")" in
  mysql|mariadb|psql)
    printf '%s %s stdin=%s\n' "$(basename "$0")" "$*" "$(cat | wc -c | tr -d ' ')" >> "$MOCK_DB_LOG"
    ;;
  mysqldump|mariadb-dump)
    printf '%s %s\n' "$(basename "$0")" "$*" >> "$MOCK_DB_LOG"
    printf 'SELECT 2;\n'
    ;;
  pg_dump)
    printf '%s %s\n' "$(basename "$0")" "$*" >> "$MOCK_DB_LOG"
    output=""
    for argument in "$@"; do
      case "$argument" in --file=*) output="${argument#*=}" ;; esac
    done
    printf 'SELECT 2;\n' > "$output"
    ;;
esac
