#!/bin/bash
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

case "$(basename "$0")" in
  mysql|mariadb|psql)
    input="$(cat)"
    printf '%s %s stdin=%s\n' "$(basename "$0")" "$*" "${#input}" >> "$MOCK_DB_LOG"
    printf 'SQL: %s\n' "$input" >> "$MOCK_DB_LOG"
    if [ -n "${MOCK_DB_ENV_LOG:-}" ]; then
      printf 'MYSQL_PWD=%s PGPASSWORD=%s\n' "${MYSQL_PWD:-}" "${PGPASSWORD:-}" >> "$MOCK_DB_ENV_LOG"
    fi
    call=0
    [ ! -f "$MOCK_DB_LOG.calls" ] || call="$(cat "$MOCK_DB_LOG.calls")"
    call=$((call + 1))
    printf '%s\n' "$call" > "$MOCK_DB_LOG.calls"
    if [ "${MOCK_DB_TERM_CALL:-}" = "$call" ]; then
      kill -TERM "$PPID"
      exit 1
    fi
    case " ${MOCK_DB_FAIL_CALLS:-} " in *" $call "*) exit 1 ;; esac
    [ "${MOCK_CLIENT_RC:-0}" = 0 ] || exit "$MOCK_CLIENT_RC"
    if [[ "$*" = *information_schema.tables* ]]; then
      # SQL backticks are literal identifiers, not shell substitutions.
      # shellcheck disable=SC2016
      printf '%s\n' 'DROP VIEW IF EXISTS `stale``view`;' 'DROP TABLE IF EXISTS `stale``table`;'
      # shellcheck disable=SC2016
      [ "$call" -lt 4 ] || printf '%s\n' 'DROP TABLE IF EXISTS `partial_import`;'
    fi
    ;;
  mysqldump|mariadb-dump)
    printf '%s %s\n' "$(basename "$0")" "$*" >> "$MOCK_DB_LOG"
    printf 'SELECT 2;\n'
    exit "${MOCK_DUMP_RC:-0}"
    ;;
  pg_dump)
    printf '%s %s\n' "$(basename "$0")" "$*" >> "$MOCK_DB_LOG"
    output=""
    for argument in "$@"; do
      case "$argument" in --file=*) output="${argument#*=}" ;; esac
    done
    if [ -n "${MOCK_PG_DUMP_FILE:-}" ]; then
      cat "$MOCK_PG_DUMP_FILE" > "$output"
    else
      printf 'SELECT 2;\n' > "$output"
    fi
    exit "${MOCK_DUMP_RC:-0}"
    ;;
esac
