#!/bin/bash
#
# Shared Fixed sync helpers for lando pull / lando push.
#
# CLI contract (Upsun Fixed docs):
#   binary: platform   (NOT upsun)
#   token:  PLATFORMSH_CLI_TOKEN   (NOT UPSUN_CLI_TOKEN)
#   resume:   platform environment:resume     (paused)
#   activate: platform environment:activate   (inactive)
#
# Prefer waking the current git-branch (or --env) environment. Parent fallback
# only when wake fails and the user did not opt out (--no-parent or explicit --env).

UPSUN_PLATFORM_BIN="${UPSUN_PLATFORM_BIN:-platform}"

# Run the Fixed CLI as-is (no implied -p).
upsun_platform_raw() {
  "$UPSUN_PLATFORM_BIN" "$@"
}

# Run the Fixed CLI, adding -p when PLATFORM_PROJECT is set.
upsun_platform() {
  if [ -n "${PLATFORM_PROJECT:-}" ]; then
    "$UPSUN_PLATFORM_BIN" "$@" -p "$PLATFORM_PROJECT"
  else
    "$UPSUN_PLATFORM_BIN" "$@"
  fi
}

# Append a comma/space-separated value onto the named array.
upsun_append_csv() {
  local dest_var="$1"
  local raw="$2"
  local item
  for item in $(echo "$raw" | sed -r 's/[,]+/ /g'); do
    [ -n "$item" ] || continue
    eval "$dest_var+=(\"\$item\")"
  done
}

# Parse pull/push argv. Sets:
#   PLATFORM_AUTH, PLATFORM_PROJECT, PLATFORM_BRANCH (if --env)
#   UPSUN_SYNC_NO_PARENT, UPSUN_SYNC_ENV_EXPLICIT
#   PLATFORM_SYNC_RELATIONSHIPS, PLATFORM_SYNC_MOUNTS
upsun_parse_sync_args() {
  PLATFORM_SYNC_RELATIONSHIPS=()
  PLATFORM_SYNC_MOUNTS=()

  while (( "$#" )); do
    case "$1" in
      --auth=*)
        PLATFORM_AUTH="${1#*=}"
        shift
        ;;
      --auth)
        PLATFORM_AUTH="$2"
        shift 2
        ;;
      -r=*|--relationship=*)
        upsun_append_csv PLATFORM_SYNC_RELATIONSHIPS "${1#*=}"
        shift
        ;;
      -r|--relationship)
        upsun_append_csv PLATFORM_SYNC_RELATIONSHIPS "$2"
        shift 2
        ;;
      -m=*|--mount=*)
        upsun_append_csv PLATFORM_SYNC_MOUNTS "${1#*=}"
        shift
        ;;
      -m|--mount)
        upsun_append_csv PLATFORM_SYNC_MOUNTS "$2"
        shift 2
        ;;
      -e=*|--env=*|--environment=*)
        PLATFORM_BRANCH="${1#*=}"
        UPSUN_SYNC_ENV_EXPLICIT=1
        shift
        ;;
      -e|--env|--environment)
        PLATFORM_BRANCH="$2"
        UPSUN_SYNC_ENV_EXPLICIT=1
        shift 2
        ;;
      -p=*|--project=*)
        PLATFORM_PROJECT="${1#*=}"
        shift
        ;;
      -p|--project)
        PLATFORM_PROJECT="$2"
        shift 2
        ;;
      --no-parent|--no-parent=*)
        UPSUN_SYNC_NO_PARENT=1
        shift
        ;;
      --)
        shift
        break
        ;;
      -*|--*=)
        shift
        ;;
      *)
        shift
        ;;
    esac
  done
}

# Export PLATFORM_PROJECT and point the CLI at it (set-remote + env).
upsun_bind_project() {
  if [ -z "${PLATFORM_PROJECT:-}" ]; then
    return 0
  fi
  export PLATFORM_PROJECT
  lando_pink "Using Fixed project $PLATFORM_PROJECT..."
  upsun_platform_raw project:set-remote -y "$PLATFORM_PROJECT" >/dev/null 2>&1 || true
}

# True when $1 is in the active-environment list.
upsun_env_is_active() {
  local branch="$1"
  upsun_platform env -I --pipe | grep -Fx "$branch" >/dev/null
}

# Print status (lowercase, trimmed) or empty if the env cannot be read.
upsun_env_status() {
  local branch="$1"
  upsun_platform environment:info -e "$branch" status 2>/dev/null \
    | tr '[:upper:]' '[:lower:]' \
    | tr -d '[:space:]'
}

# Wake a paused or inactive environment. Returns 0 on CLI success.
upsun_try_wake_env() {
  local branch="$1"
  local status="$2"
  case "$status" in
    paused)
      lando_pink "Environment $branch is paused; resuming with platform environment:resume..."
      upsun_platform environment:resume -e "$branch" -y
      ;;
    inactive)
      lando_pink "Environment $branch is inactive; activating with platform environment:activate..."
      upsun_platform environment:activate -e "$branch" -y
      ;;
    *)
      return 1
      ;;
  esac
}

# Last status read by upsun_require_active (empty if unread / unreadable).
UPSUN_LAST_ENV_STATUS=""

# Confirm $1 is in the active list, waking it if paused/inactive. Green on success.
upsun_require_active() {
  local branch="$1"
  UPSUN_LAST_ENV_STATUS=""
  if upsun_env_is_active "$branch"; then
    lando_green "Verified the $branch environment is active"
    return 0
  fi
  UPSUN_LAST_ENV_STATUS="$(upsun_env_status "$branch")"
  if [ -n "$UPSUN_LAST_ENV_STATUS" ] \
      && upsun_try_wake_env "$branch" "$UPSUN_LAST_ENV_STATUS" \
      && upsun_env_is_active "$branch"; then
    lando_green "Verified the $branch environment is active"
    return 0
  fi
  return 1
}

# Resolve PLATFORM_BRANCH to an environment we can sync against.
upsun_ensure_active_environment() {
  local original="$PLATFORM_BRANCH"
  local parent=""
  local skip_parent=0

  if [ "${UPSUN_SYNC_NO_PARENT:-}" = "1" ] || [ "${UPSUN_SYNC_ENV_EXPLICIT:-}" = "1" ]; then
    skip_parent=1
  fi

  lando_pink "Verifying $PLATFORM_BRANCH is an active environment..."

  if upsun_require_active "$PLATFORM_BRANCH"; then
    return 0
  fi

  if [ "$skip_parent" = "1" ]; then
    lando_red "Could not resume $original (status: ${UPSUN_LAST_ENV_STATUS:-unknown}) and parent fallback is disabled"
    return 1
  fi

  parent="$(upsun_platform environment:info -e "$original" parent 2>/dev/null || echo "master")"
  if [ -n "$UPSUN_LAST_ENV_STATUS" ]; then
    lando_yellow "Could not resume $original (status: $UPSUN_LAST_ENV_STATUS); using the parent environment ($parent) instead"
  else
    lando_yellow "Branch $original is not an active environment; using the parent environment ($parent) instead"
  fi
  PLATFORM_BRANCH="$parent"

  if upsun_require_active "$PLATFORM_BRANCH"; then
    return 0
  fi

  lando_red "Could not verify $PLATFORM_BRANCH is an active environment (status: ${UPSUN_LAST_ENV_STATUS:-unknown})"
  return 1
}
