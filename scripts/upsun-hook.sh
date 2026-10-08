#!/bin/bash
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

hook_name="${1:-}"
case "$hook_name" in
  build|deploy|post_deploy) hook_group="hooks" ;;
  pre_start|post_start) hook_group="web" ;;
  *) lando_red "Unknown Upsun hook: $hook_name"; exit 2 ;;
esac

[ -n "${PLATFORM_APPLICATION:-}" ] || exit 0
app_json="$(printf '%s' "$PLATFORM_APPLICATION" | base64 --decode)"
# Extract the hook with whatever JSON-capable tool the runtime image ships
# shellcheck disable=SC2016
if command -v jq > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | jq -r --arg group "$hook_group" --arg name "$hook_name" \
    'if $group == "web" then .web.commands[$name] // empty else .hooks[$name] // empty end')"
elif command -v php > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | php -r '$a=json_decode(stream_get_contents(STDIN),true);echo $argv[1]==="web"?($a["web"]["commands"][$argv[2]]??""):($a["hooks"][$argv[2]]??"");' "$hook_group" "$hook_name")"
elif command -v node > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);const g=process.argv[1]==="web"?((a.web||{}).commands||{}):(a.hooks||{});process.stdout.write(g[process.argv[2]]||"")})' "$hook_group" "$hook_name")"
elif command -v python3 > /dev/null 2>&1; then
  hook_body="$(printf '%s' "$app_json" | python3 -c 'import json,sys;a=json.load(sys.stdin);g=((a.get("web") or {}).get("commands") or {}) if sys.argv[1]=="web" else (a.get("hooks") or {});print(g.get(sys.argv[2]) or "",end="")' "$hook_group" "$hook_name")"
else
  lando_red "No jq/php/node/python3 available to read PLATFORM_APPLICATION"; exit 1
fi
[ -n "$hook_body" ] || exit 0

app_dir="${PLATFORM_APP_DIR:-/app}"
if [ "$hook_name" = build ]; then
  # Use image tools before loading .environment, which may re-add project bins.
  build_path=""
  path_separator=""
  while IFS= read -r -d ':' path_entry; do
    case "$path_entry" in
      "$app_dir/vendor/bin"|"$app_dir/bin"|/app/vendor/bin|/app/bin) continue ;;
    esac
    build_path+="$path_separator$path_entry"
    path_separator=":"
  done <<< "$PATH:"
  export PATH="$build_path"
fi
# shellcheck source=/dev/null
. "${UPSUN_ENV_HELPER:-$(dirname "$0")/upsun-env.sh}"

cd "$app_dir"
lando_pink "Running Upsun $hook_name hook"
bash -eo pipefail -c "$hook_body"
lando_green "Finished Upsun $hook_name hook"
