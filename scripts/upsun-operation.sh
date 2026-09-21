#!/bin/bash
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

operation_name="${1:-}"
if [ -z "$operation_name" ]; then
  lando_red "Usage: lando operation <name>"; exit 2
fi
[ -n "${PLATFORM_APPLICATION:-}" ] || { lando_red "PLATFORM_APPLICATION is not set"; exit 1; }

app_json="$(printf '%s' "$PLATFORM_APPLICATION" | base64 --decode)"
# shellcheck disable=SC2016
if command -v jq > /dev/null 2>&1; then
  operation_body="$(printf '%s' "$app_json" | jq -r --arg n "$operation_name" \
    '.operations[$n].commands.start // empty')"
elif command -v php > /dev/null 2>&1; then
  operation_body="$(printf '%s' "$app_json" | php -r '$a=json_decode(stream_get_contents(STDIN),true);echo $a["operations"][$argv[1]]["commands"]["start"]??"";' "$operation_name")"
elif command -v node > /dev/null 2>&1; then
  operation_body="$(printf '%s' "$app_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=((JSON.parse(d).operations||{})[process.argv[1]])||{};process.stdout.write((o.commands&&o.commands.start)||"")})' "$operation_name")"
elif command -v python3 > /dev/null 2>&1; then
  operation_body="$(printf '%s' "$app_json" | python3 -c 'import json,sys;o=(json.load(sys.stdin).get("operations") or {}).get(sys.argv[1]) or {};print((o.get("commands") or {}).get("start") or "",end="")' "$operation_name")"
else
  lando_red "No jq/php/node/python3 available to read PLATFORM_APPLICATION"; exit 1
fi

if [ -z "$operation_body" ]; then
  lando_red "No operation named '$operation_name' in this application"; exit 1
fi

app_dir="${PLATFORM_APP_DIR:-/app}"
# The shared helper loads the tether env (when tethered) and then the app's .environment
# shellcheck source=/dev/null
. "${UPSUN_ENV_HELPER:-$(dirname "$0")/upsun-env.sh}"
cd "$app_dir"
lando_pink "Running operation $operation_name"
printf '%s\n' "$operation_body" | bash -e
lando_green "Finished operation $operation_name"
