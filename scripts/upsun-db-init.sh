#!/bin/bash
set -e

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

[ "$#" -eq 3 ] || { lando_red "Usage: upsun-db-init.sh <host> <mysql|pgsql> <base64-sql>"; exit 2; }

host="$1"
dialect="$2"
encoded_sql="$3"
wait_seconds="${UPSUN_DB_WAIT:-60}"

case "$dialect" in
  mysql)
    MYSQL_CLIENT="${UPSUN_MYSQL_CLIENT:-}"
    if [ -z "$MYSQL_CLIENT" ]; then
      MYSQL_CLIENT="$(command -v mysql || command -v mariadb || true)"
    fi
    client="$MYSQL_CLIENT"
    ;;
  pgsql)
    client="${UPSUN_PSQL_CLIENT:-psql}"
    ;;
  *)
    lando_red "Unknown database dialect: $dialect"
    exit 2
    ;;
esac

sql_file="$(mktemp)"
trap 'rm -f "$sql_file"' EXIT
printf '%s' "$encoded_sql" | base64 --decode > "$sql_file"

elapsed=0
while true; do
  if [ "$dialect" = mysql ]; then
    if "$client" -h "$host" -u root --skip-password -e 'SELECT 1' >/dev/null 2>&1; then break; fi
  else
    if PGPASSWORD='' "$client" -h "$host" -U postgres -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then break; fi
  fi
  if [ "$elapsed" -ge "$wait_seconds" ]; then
    lando_red "Database $host did not accept connections after ${wait_seconds}s"
    exit 4
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

status=0
if [ "$dialect" = mysql ]; then
  "$client" -h "$host" -u root --skip-password < "$sql_file" || status=$?
else
  PGPASSWORD='' "$client" -v ON_ERROR_STOP=1 -h "$host" -U postgres -d postgres -f "$sql_file" || status=$?
fi

if [ "$status" -ne 0 ]; then
  lando_red "Failed to initialize $dialect schemas and users on $host (status $status)"
  exit "$status"
fi

lando_green "Initialized $dialect schemas and users on $host"
