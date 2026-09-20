#!/bin/bash
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"
# shellcheck source=/dev/null
. "$(dirname "$0")/upsun-sync-env.sh"

UPSUN_TETHER_DIR="${UPSUN_TETHER_DIR:-/tmp/upsun-tether}"
UPSUN_TETHER_ENV_FILE="${UPSUN_TETHER_ENV_FILE:-/tmp/upsun-tether.env}"
UPSUN_FPM_POOL_DIR="${UPSUN_FPM_POOL_DIR:-/usr/local/etc/php-fpm.d}"
UPSUN_TETHER_BASE_PORT="${UPSUN_TETHER_BASE_PORT:-30000}"
UPSUN_TETHER_WAIT="${UPSUN_TETHER_WAIT:-30}"
UPSUN_PGREP="${UPSUN_PGREP:-pgrep}"
UPSUN_KILL="${UPSUN_KILL:-kill}"
fpm_conf="$UPSUN_FPM_POOL_DIR/zzz-upsun-tether.conf"

reload_fpm() {
  local pid
  pid=$("$UPSUN_PGREP" -o php-fpm 2>/dev/null || true)
  if [ -n "$pid" ]; then
    "$UPSUN_KILL" -USR2 "$pid"
  fi
}

close_tether() {
  local silent="${1:-0}"
  local pid_file
  local pid
  shopt -s nullglob
  for pid_file in "$UPSUN_TETHER_DIR"/*.pid; do
    pid=$(cat "$pid_file" 2>/dev/null || true)
    if [ -n "$pid" ] && "$UPSUN_KILL" -0 "$pid" 2>/dev/null; then
      "$UPSUN_KILL" "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file" "${pid_file%.pid}.log"
  done
  shopt -u nullglob
  rm -f "$UPSUN_TETHER_ENV_FILE" "$UPSUN_TETHER_ENV_FILE.tmp" "$fpm_conf" "$fpm_conf.tmp"
  reload_fpm
  if [ "$silent" != 1 ]; then
    lando_green "Tether closed"
  fi
}

wait_for_tunnel() {
  local rel="$1"
  local port="$2"
  local waited=0
  if [ "$UPSUN_TETHER_WAIT" -eq 0 ]; then
    return 0
  fi
  while [ "$waited" -lt "$UPSUN_TETHER_WAIT" ]; do
    if bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  lando_yellow "Tunnel for $rel did not open on port $port"
}

write_env_file() {
  local relationships="$1"
  local relationships_b64="$2"
  mkdir -p "$(dirname "$UPSUN_TETHER_ENV_FILE")"
  {
    jq -nr --arg value "$relationships_b64" '
      def shq: "\u0027" + (gsub("\u0027"; "\u0027\\\u0027\u0027")) + "\u0027";
      "PLATFORM_RELATIONSHIPS=" + ($value | shq)
    '
    jq -r '
      def shq: "\u0027" + (gsub("\u0027"; "\u0027\\\u0027\u0027")) + "\u0027";
      to_entries[] |
      .key as $name |
      .value[0] as $value |
      ($name | ascii_upcase | gsub("[^A-Z0-9]"; "_")) as $prefix |
      def line($field; $data): "\($prefix)_\($field)=\($data | tostring | shq)";
      ($value.scheme + "://" +
        (if $value.username == null then ""
         else ($value.username | tostring) +
           (if $value.password == null then "" else ":" + ($value.password | tostring) end) + "@"
         end) +
        ($value.host | tostring) + ":" + ($value.port | tostring) +
        (if $value.path == null then "" else "/" + ($value.path | tostring) end)) as $url |
      line("HOST"; $value.host),
      line("HOSTNAME"; $value.hostname),
      line("IP"; $value.ip),
      line("PORT"; $value.port),
      line("SCHEME"; $value.scheme),
      (if $value.username == null then empty else line("USERNAME"; $value.username) end),
      (if $value.password == null then empty else line("PASSWORD"; $value.password) end),
      (if $value.path == null then empty else line("PATH"; $value.path) end),
      line("URL"; $url)
    ' <<< "$relationships"
  } > "$UPSUN_TETHER_ENV_FILE.tmp"
  chmod 0644 "$UPSUN_TETHER_ENV_FILE.tmp"
  mv "$UPSUN_TETHER_ENV_FILE.tmp" "$UPSUN_TETHER_ENV_FILE"
}

write_fpm_conf() {
  local relationships="$1"
  local relationships_b64="$2"
  [ -d "$UPSUN_FPM_POOL_DIR" ] || return 0
  {
    printf '[www]\n'
    printf 'env[PLATFORM_RELATIONSHIPS] = %s\n' "$relationships_b64"
    jq -r '
      to_entries[] |
      .key as $name |
      .value[0] as $value |
      ($name | ascii_upcase | gsub("[^A-Z0-9]"; "_")) as $prefix |
      def line($field; $data): "env[\($prefix)_\($field)] = \($data | tostring)";
      ($value.scheme + "://" +
        (if $value.username == null then ""
         else ($value.username | tostring) +
           (if $value.password == null then "" else ":" + ($value.password | tostring) end) + "@"
         end) +
        ($value.host | tostring) + ":" + ($value.port | tostring) +
        (if $value.path == null then "" else "/" + ($value.path | tostring) end)) as $url |
      line("HOST"; $value.host), line("HOSTNAME"; $value.hostname), line("IP"; $value.ip),
      line("PORT"; $value.port), line("SCHEME"; $value.scheme),
      (if $value.username == null then empty else line("USERNAME"; $value.username) end),
      (if $value.password == null then empty else line("PASSWORD"; $value.password) end),
      (if $value.path == null then empty else line("PATH"; $value.path) end),
      line("URL"; $url)
    ' <<< "$relationships"
  } > "$fpm_conf.tmp"
  mv "$fpm_conf.tmp" "$fpm_conf"
  reload_fpm
}

open_tether() {
  local environment="${UPSUN_TETHER_ENVIRONMENT:-}"
  local rels_b64
  local relationships
  local relationships_b64
  local rel
  local port
  local index=0
  local -a rel_names

  unset PLATFORM_RELATIONSHIPS PLATFORM_APPLICATION
  export UPSUN_CLI_CONTEXT=1
  export "${UPSUN_CLI_TOKEN_VAR?}"
  export HOME="${HOME:-/root}"
  mkdir -p "$UPSUN_TETHER_DIR"
  close_tether 1

  if [ -z "$environment" ]; then
    environment=$(git -C "${PLATFORM_APP_DIR:-/app}" symbolic-ref --short HEAD 2>/dev/null || true)
  fi
  PLATFORM_BRANCH="${environment:-main}"
  upsun_bind_project
  upsun_ensure_active_environment
  printf '%s\n' "$PLATFORM_BRANCH" > "$UPSUN_TETHER_DIR/environment"

  # shellcheck disable=SC2016
  if ! rels_b64=$(upsun_platform_raw ssh -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" \
    -A "$PLATFORM_APPLICATION_NAME" -- 'echo $PLATFORM_RELATIONSHIPS'); then
    lando_red "Could not read PLATFORM_RELATIONSHIPS from $PLATFORM_BRANCH"
    return 3
  fi
  if ! relationships=$(printf '%s' "$rels_b64" | base64 -d 2>/dev/null) \
    || ! jq -e 'type == "object" and length > 0 and all(.[]; type == "array" and length > 0)' \
      >/dev/null 2>&1 <<< "$relationships"; then
    lando_red "Could not read PLATFORM_RELATIONSHIPS from $PLATFORM_BRANCH"
    return 3
  fi

  mapfile -t rel_names < <(jq -r 'keys[]' <<< "$relationships")
  for rel in "${rel_names[@]}"; do
    port=$((UPSUN_TETHER_BASE_PORT + index))
    nohup "$UPSUN_CLI_BINARY" tunnel:single -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" \
      -A "$PLATFORM_APPLICATION_NAME" -r "$rel" --port "$port" -g \
      > "$UPSUN_TETHER_DIR/$rel.log" 2>&1 &
    printf '%s\n' "$!" > "$UPSUN_TETHER_DIR/$rel.pid"
    wait_for_tunnel "$rel" "$port"
    lando_pink "Tunnel $rel -> 127.0.0.1:$port"
    relationships=$(jq --arg rel "$rel" --argjson port "$port" \
      '.[$rel] |= map(.host="127.0.0.1" | .hostname="127.0.0.1" | .ip="127.0.0.1" | .port=$port)' \
      <<< "$relationships")
    index=$((index + 1))
  done

  relationships_b64=$(printf '%s' "$relationships" | base64 -w0 2>/dev/null \
    || printf '%s' "$relationships" | base64 | tr -d '\n')
  write_env_file "$relationships" "$relationships_b64"
  write_fpm_conf "$relationships" "$relationships_b64"
  lando_green "Tethered to $PLATFORM_BRANCH: ${#rel_names[@]} relationship(s) tunnelled"
}

show_info() {
  local relationships
  local rel
  local pid
  local port
  local status
  local pid_file
  if [ ! -f "$UPSUN_TETHER_ENV_FILE" ]; then
    lando_yellow "Not tethered"
    return 0
  fi
  PLATFORM_RELATIONSHIPS=""
  # shellcheck source=/dev/null
  . "$UPSUN_TETHER_ENV_FILE"
  relationships=$(printf '%s' "$PLATFORM_RELATIONSHIPS" | base64 -d)
  printf 'Environment: %s\n' "$(cat "$UPSUN_TETHER_DIR/environment" 2>/dev/null || true)"
  shopt -s nullglob
  for pid_file in "$UPSUN_TETHER_DIR"/*.pid; do
    rel=$(basename "${pid_file%.pid}")
    pid=$(cat "$pid_file")
    port=$(jq -r --arg rel "$rel" '.[$rel][0].port' <<< "$relationships")
    status=dead
    if [ -n "$pid" ] && "$UPSUN_KILL" -0 "$pid" 2>/dev/null; then
      status=running
    fi
    printf '%s: port %s (%s)\n' "$rel" "$port" "$status"
  done
  shopt -u nullglob
  jq . <<< "$relationships"
}

case "${1:-open}" in
  open) open_tether ;;
  close|--close) close_tether ;;
  info|--info) show_info ;;
  *)
    lando_red "Usage: lando tether [open|--close|--info]"
    exit 2
    ;;
esac
