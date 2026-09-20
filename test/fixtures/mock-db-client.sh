#!/bin/bash
set -e

. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

printf '%s %s\n' "$(basename "$0")" "$*" >> "$MOCK_DB_LOG"
case "$(basename "$0")" in
  mysql|mariadb) cat >/dev/null ;;
  mysqldump|mariadb-dump) printf 'SELECT 2;\n' ;;
  psql) ;;
  pg_dump)
    output=""
    for argument in "$@"; do
      case "$argument" in --file=*) output="${argument#*=}" ;; esac
    done
    printf 'SELECT 2;\n' > "$output"
    ;;
esac
