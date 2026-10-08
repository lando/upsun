#!/bin/bash
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

[ -n "${PLATFORM_APPLICATION:-}" ] || { lando_red "PLATFORM_APPLICATION is not set"; exit 1; }

app_json="$(printf '%s' "$PLATFORM_APPLICATION" | base64 --decode)"
crontab="${UPSUN_CRONTAB:-/tmp/crontab}"
supercronic="${UPSUN_SUPERCRONIC:-supercronic}"
cron_script="${UPSUN_CRON_SCRIPT:-/helpers/upsun-cron.sh}"

while IFS= read -r cron_name; do
  [ -n "$cron_name" ] && lando_yellow "Cron $cron_name has no spec; skipping"
done < <(printf '%s' "$app_json" | jq -r \
  '.crons // {} | to_entries[] | select(.value.spec == null or .value.spec == "") | .key')

printf '%s' "$app_json" | jq -r --arg s "$cron_script" \
  '.crons // {} | to_entries[] | select(.value.spec != null and .value.spec != "") |
  "\(.value.spec) \($s) \(.key)"' > "$crontab"

cron_count="$(wc -l < "$crontab" | tr -d ' ')"
if [ "$cron_count" -eq 0 ]; then
  lando_yellow "No crons defined; idling"
  exec tail -f /dev/null
fi

lando_pink "Scheduling $cron_count cron(s) with supercronic"
exec "$supercronic" -passthrough-logs "$crontab"
