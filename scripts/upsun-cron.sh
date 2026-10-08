#!/bin/bash
#
# Run one Upsun cron job once: upsun-cron.sh <name>
set -e

. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

cron_name="${1:-}"
if [ -z "$cron_name" ]; then
  lando_red "Usage: lando cron <name>"; exit 2
fi
[ -n "${PLATFORM_APPLICATION:-}" ] || { lando_red "PLATFORM_APPLICATION is not set"; exit 1; }

app_json="$(printf '%s' "$PLATFORM_APPLICATION" | base64 --decode)"
# crons.<name>.commands.start (current) or crons.<name>.cmd (legacy)
if command -v jq > /dev/null 2>&1; then
  cron_body="$(printf '%s' "$app_json" | jq -r --arg n "$cron_name" '.crons[$n] | (.commands.start // .cmd) // empty')"
elif command -v php > /dev/null 2>&1; then
  cron_body="$(printf '%s' "$app_json" | php -r '$a=json_decode(stream_get_contents(STDIN),true);$c=$a["crons"][$argv[1]]??[];echo $c["commands"]["start"]??$c["cmd"]??"";' "$cron_name")"
elif command -v node > /dev/null 2>&1; then
  cron_body="$(printf '%s' "$app_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const c=((JSON.parse(d).crons||{})[process.argv[1]])||{};process.stdout.write((c.commands&&c.commands.start)||c.cmd||"")})' "$cron_name")"
elif command -v python3 > /dev/null 2>&1; then
  cron_body="$(printf '%s' "$app_json" | python3 -c 'import json,sys;c=(json.load(sys.stdin).get("crons") or {}).get(sys.argv[1]) or {};print((c.get("commands") or {}).get("start") or c.get("cmd") or "",end="")' "$cron_name")"
else
  lando_red "No jq/php/node/python3 available to read PLATFORM_APPLICATION"; exit 1
fi

if [ -z "$cron_body" ]; then
  lando_red "No cron named '$cron_name' in this application"; exit 1
fi

app_dir="${PLATFORM_APP_DIR:-/app}"
# shellcheck source=/dev/null
. "${UPSUN_ENV_HELPER:-$(dirname "$0")/upsun-env.sh}"
cd "$app_dir"
lando_pink "Running cron $cron_name"
bash -eo pipefail -c "$cron_body"
lando_green "Finished cron $cron_name"
