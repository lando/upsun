#!/bin/bash
set -e

. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

hook_name="${1:-}"
case "$hook_name" in
  build|deploy|post_deploy) ;;
  *) lando_red "Unknown Upsun hook: $hook_name"; exit 2 ;;
esac

[ -n "${PLATFORM_APPLICATION:-}" ] || exit 0
app_json="$(printf '%s' "$PLATFORM_APPLICATION" | base64 --decode)"
# Extract hooks.<name> with whatever JSON-capable tool the runtime image ships
if command -v jq > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | jq -r --arg name "$hook_name" '.hooks[$name] // empty')"
elif command -v php > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | php -r '$a=json_decode(stream_get_contents(STDIN),true);echo $a["hooks"][$argv[1]] ?? "";' "$hook_name")"
elif command -v node > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write((JSON.parse(d).hooks||{})[process.argv[1]]||""))' "$hook_name")"
elif command -v python3 > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("hooks") or {}).get(sys.argv[1]) or "",end="")' "$hook_name")"
else
  lando_red "No jq/php/node/python3 available to read PLATFORM_APPLICATION"; exit 1
fi
[ -n "$hook_body" ] || exit 0

app_dir="${PLATFORM_APP_DIR:-/app}"
if [ -f "$app_dir/.environment" ]; then
  set -a
  . "$app_dir/.environment"
  set +a
fi

cd "$app_dir"
lando_pink "Running Upsun $hook_name hook"
printf '%s\n' "$hook_body" | bash -e
lando_green "Finished Upsun $hook_name hook"
