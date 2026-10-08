#!/bin/bash
# This sourced helper returns values through variables consumed by entrypoints.
# shellcheck disable=SC2034
{ set +x; } 2>/dev/null
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"
# Shared Upsun Flex and Fixed sync helpers for lando pull / lando push.
# The injected binary and token variable select the CLI for the detected project.
#
# Prefer waking the current git-branch (or --env) environment. Parent fallback
# only when wake fails and the user did not opt out (--no-parent or explicit --env).
#
# Activeness comes from `environment:info <env> status`, never from membership of
# `env -I`: --no-inactive drops only `inactive`, so paused, dirty and deleting
# environments are all still listed and would be mistaken for active ones.
# Parent fallback is correct only when we know how to wake the branch and the wake
# failed. Statuses we cannot act on (dirty, deleting, unknown, unreadable) hard-fail
# instead, because importing the parent would replace the data the user asked for
# with different data.

UPSUN_CLI_BINARY="${UPSUN_CLI_BINARY:-platform}"
UPSUN_CLI_TOKEN_VAR="${UPSUN_CLI_TOKEN_VAR:-PLATFORMSH_CLI_TOKEN}"

upsun_platform_raw() {
  "$UPSUN_CLI_BINARY" "$@"
}

upsun_platform() {
  if [ -n "${PLATFORM_PROJECT:-}" ]; then
    "$UPSUN_CLI_BINARY" "$@" -p "$PLATFORM_PROJECT"
  else
    "$UPSUN_CLI_BINARY" "$@"
  fi
}

# Append a comma/space-separated value onto the named array.
upsun_append_csv() {
  local dest_var="$1"
  local raw="$2"
  local item
  local -a items
  raw="${raw//$'\n'/,}"
  raw="${raw//$'\t'/,}"
  raw="${raw// /,}"
  IFS=, read -ra items <<< "$raw"
  for item in "${items[@]}"; do
    [ -n "$item" ] || continue
    eval "$dest_var+=(\"\$item\")"
  done
}

# Parse pull/push argv. Sets:
#   PLATFORM_AUTH, PLATFORM_PROJECT, PLATFORM_BRANCH (if --env)
#   UPSUN_SYNC_NO_PARENT, UPSUN_SYNC_ENV_EXPLICIT, UPSUN_SYNC_ALL_MOUNTS, UPSUN_SYNC_APP
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
      --all-mounts)
        UPSUN_SYNC_ALL_MOUNTS=1
        shift
        ;;
      --skip-db|--skip-db=true|--no-db|--no-db=true)
        PLATFORM_SYNC_RELATIONSHIPS=(none)
        shift
        ;;
      --skip-files|--skip-files=true|--no-files|--no-files=true)
        PLATFORM_SYNC_MOUNTS=(none)
        shift
        ;;
      -A=*|--app=*)
        UPSUN_SYNC_APP="${1#*=}"
        shift
        ;;
      -A|--app)
        UPSUN_SYNC_APP="$2"
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
      --force)
        UPSUN_SYNC_FORCE=1
        shift
        ;;
      --)
        shift
        break
        ;;
      *)
        shift
        ;;
    esac
  done
  UPSUN_SYNC_APP="${UPSUN_SYNC_APP:-${PLATFORM_APPLICATION_NAME:-}}"
}

# Resolve the CLI's "schema" (a database, not a PostgreSQL namespace).
upsun_sync_database() {
  rel_name="${1%%:*}"
  rel_key="$(printf '%s' "$rel_name" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"
  host_var="${rel_key}_HOST"
  port_var="${rel_key}_PORT"
  user_var="${rel_key}_USERNAME"
  password_var="${rel_key}_PASSWORD"
  path_var="${rel_key}_PATH"
  scheme_var="${rel_key}_SCHEME"
  database="${!path_var:-}"
  [[ "$1" != *:* ]] || database="${1#*:}"
  if [ -z "$rel_name" ] || [ -z "$database" ]; then
    lando_red "Missing database for $rel_name; set $path_var or use --relationship=$rel_name:DATABASE"
    return 1
  fi
  case "${!scheme_var:-}" in
    mysql|pgsql|postgresql) ;;
    *) lando_red "Unsupported database scheme for $rel_name: ${!scheme_var:-missing}"; return 3 ;;
  esac
}

upsun_sync_selections() {
  local selection
  for selection in "${relationships[@]}"; do
    [ "$selection" != none ] || relationships=(none)
  done
  for selection in "${mounts[@]}"; do
    if [ "$selection" = none ]; then
      mounts=(none)
      UPSUN_SYNC_ALL_MOUNTS=0
    fi
  done
  if [ "${#relationships[@]}" = 0 ]; then
    lando_yellow "No relationships selected; use --relationship=NAME[:DATABASE] or --skip-db."
  fi
  if [ "${#mounts[@]}" = 0 ] && [ "${UPSUN_SYNC_ALL_MOUNTS:-}" != 1 ]; then
    lando_yellow "No mounts selected; use --mount=PATH or --skip-files."
  fi
  # Validate every target before changing any selected database.
  for selection in "${relationships[@]}"; do
    [ "$selection" != none ] || continue
    if [[ " ${UPSUN_SYNC_REPLICAS:-} " == *" ${selection%%:*} "* ]]; then
      lando_red "${selection%%:*} is a read-only replica; sync its primary relationship instead"
      return 1
    fi
    upsun_sync_database "$selection" || return "$?"
  done
}

upsun_sync_temp() {
  sync_temp="$("${UPSUN_MKTEMP:-mktemp}" -d "${UPSUN_SYNC_TMPDIR:-${TMPDIR:-/tmp}}/upsun-data.XXXXXXXX")"
  trap 'upsun_sync_cleanup' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

upsun_sync_cleanup() {
  local status=$?
  if [ -n "${backup_file:-}" ]; then
    lando_red "Local backup kept at $backup_file"
  fi
  "${UPSUN_RM:-rm}" -rf -- "$sync_temp"
  return "$status"
}

upsun_app_args() {
  [ -n "${UPSUN_SYNC_APP:-}" ] && printf -- '-A\n%s\n' "$UPSUN_SYNC_APP"
  return 0
}

# Export PLATFORM_PROJECT and point the CLI at it (set-remote + env).
upsun_bind_project() {
  if [ -z "${PLATFORM_PROJECT:-}" ]; then
    return 0
  fi
  export PLATFORM_PROJECT
  lando_pink "Using project $PLATFORM_PROJECT..."
  upsun_platform_raw project:set-remote -y "$PLATFORM_PROJECT" >/dev/null 2>&1 || true
}

# Print status (lowercase, trimmed) or empty if the env cannot be read.
upsun_env_status() {
  local branch="$1"
  local status
  status="$(upsun_platform environment:info -e "$branch" status 2>/dev/null)" || return 2
  printf '%s' "$status" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]'
}

upsun_try_wake_env() {
  local branch="$1"
  local status="$2"
  case "$status" in
    paused)
      lando_pink "Environment $branch is paused; resuming with $UPSUN_CLI_BINARY environment:resume..."
      upsun_platform environment:resume -e "$branch" -y
      ;;
    inactive)
      lando_pink "Environment $branch is inactive; activating with $UPSUN_CLI_BINARY environment:activate..."
      upsun_platform environment:activate -e "$branch" -y
      ;;
    *)
      return 1
      ;;
  esac
}

# Last status read by upsun_require_active (empty if unread / unreadable).
UPSUN_LAST_ENV_STATUS=""

# Keep progress in the foreground. Lando pipes stderr, so only a real output
# terminal gets carriage-return updates; piped tooling gets one line per retry.
upsun_retry_countdown() {
  local branch="$1" remaining old_int rc=0
  local frames=('|' '/' '-' "\\")
  old_int="$(trap -p INT)"
  trap 'printf "\n" >&2; exit 130' INT
  if [ -t 2 ]; then
    for ((remaining=30; remaining>0; remaining--)); do
      printf '\r%s Environment %s: retrying in %2d seconds ' "${frames[$((remaining % 4))]}" "$branch" "$remaining" >&2
      "${UPSUN_SLEEP:-sleep}" 1 || { rc=2; break; }
    done
    printf '\rEnvironment %s: retry countdown finished.      \n' "$branch" >&2
  else
    printf 'Environment %s: retrying in 30 seconds...\n' "$branch" >&2
    "${UPSUN_SLEEP:-sleep}" 30 || rc=2
  fi
  if [ -n "$old_int" ]; then eval "$old_int"; else trap - INT; fi
  return "$rc"
}

# Poll only status, never wake again or fall back to another environment.
upsun_wait_ready() {
  local branch="$1" waited status
  lando_pink "Environment $branch has an activity in progress (status: dirty); waiting up to 600 seconds..."
  for ((waited=30; waited<=600; waited+=30)); do
    upsun_retry_countdown "$branch" || return 2
    UPSUN_LAST_ENV_STATUS=""
    if ! status="$(upsun_env_status "$branch")"; then
      lando_red "Could not read the status of the $branch environment while waiting"
      return 2
    fi
    UPSUN_LAST_ENV_STATUS="$status"
    case "$status" in
      active)
        lando_green "Verified the $branch environment is active"
        return 0
        ;;
      dirty) ;;
      *)
        lando_red "Environment $branch reports '${status:-unreadable}' while waiting; refusing to sync"
        return 2
        ;;
    esac
  done
  lando_red "Environment $branch still has an activity in progress after 600 seconds; refusing to sync"
  return 2
}

# Ensure $1 is active, waking it when it is paused or inactive.
#   0  active and ready to sync
#   1  a wake was attempted and did not take, so parent fallback is still reasonable
#   2  the status cannot be acted on, and the parent must never be used
upsun_require_active() {
  local branch="$1"
  local status
  UPSUN_LAST_ENV_STATUS=""
  if ! status="$(upsun_env_status "$branch")"; then
    lando_red "Could not read the status of the $branch environment"
    return 2
  fi
  UPSUN_LAST_ENV_STATUS="$status"

  case "$status" in
  active)
    lando_green "Verified the $branch environment is active"
    return 0
    ;;
  paused|inactive)
    upsun_try_wake_env "$branch" "$status" || return 1
    ;;
  dirty)
    upsun_wait_ready "$branch"
    return "$?"
    ;;
  deleting)
    lando_red "Environment $branch is being deleted; there is nothing to sync from"
    return 2
    ;;
  '')
    lando_red "Could not read the status of the $branch environment"
    return 2
    ;;
  *)
    lando_red "Environment $branch has unhandled status '$status'; refusing to sync"
    return 2
    ;;
  esac

  # The wake command blocks on its own activity, but another one can start right
  # after it returns, so re-read the status instead of trusting the exit code.
  if ! status="$(upsun_env_status "$branch")"; then
    UPSUN_LAST_ENV_STATUS=""
    lando_red "Could not read the status of the $branch environment after waking"
    return 2
  fi
  UPSUN_LAST_ENV_STATUS="$status"
  case "$status" in
  active)
    lando_green "Verified the $branch environment is active"
    return 0
    ;;
  paused|inactive)
    # The wake command ran and the environment is still stopped, so this is a wake
    # that did not take. That is the only outcome where the parent is a fair swap.
    return 1
    ;;
  dirty)
    lando_pink "Environment $branch started another activity after waking"
    upsun_wait_ready "$branch"
    return "$?"
    ;;
  *)
    # Never the parent: the environment became unresolvable, and importing the
    # parent would replace the requested data with a different environment's.
    lando_red "Environment $branch reports '${status:-unreadable}' after waking; refusing to sync"
    return 2
    ;;
  esac
}

# Rewrite plain pg_dump SQL without interpreting COPY data or quoted function bodies.
# The role is passed through ENVIRON so awk does not reinterpret identifier backslashes.
upsun_rewrite_pg_dump() {
  # shellcheck disable=SC2016
  UPSUN_IMPORT_MODE="$1" UPSUN_IMPORT_ROLE="${3:-}" "${UPSUN_AWK:-awk}" '
    function scan(line,    i, c, rest, tag) {
      ended = 0
      for (i = 1; i <= length(line); i++) {
        c = substr(line, i, 1)
        if (dollar != "") {
          if (substr(line, i, length(dollar)) == dollar) {
            i += length(dollar) - 1; dollar = ""
          }
        } else if (quote != "") {
          if (c == quote) {
            if (substr(line, i + 1, 1) == quote) i++
            else quote = ""
          } else if (c == "\\" && quote_escape) i++
        } else if (substr(line, i, 2) == "--") {
          break
        } else if (c == sprintf("%c", 39) || c == "\"") {
          quote = c
          quote_escape = c == sprintf("%c", 39) && i > 1 && substr(line, i - 1, 1) ~ /[eE]/ &&
            (i == 2 || substr(line, i - 2, 1) !~ /[A-Za-z_0-9]/)
        } else if (c == "$") {
          rest = substr(line, i)
          if (match(rest, /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/)) {
            tag = substr(rest, 1, RLENGTH); dollar = tag; i += length(tag) - 1
          }
        } else if (c == ";") ended = 1
      }
    }
    copy { print; if (/^\\\.$/) copy = 0; next }
    {
      outside = dollar == "" && quote == ""
      if (outside && /^COPY .* FROM stdin;$/) { copy = 1; print; next }
      if (outside && /^-- (Name|Data for Name): .*; Type: /) {
        extension = /; Type: EXTENSION;/ || /^-- Name: EXTENSION .*; Type: COMMENT;/
        if (ENVIRON["UPSUN_IMPORT_MODE"] == "pull") {
          if (superuser && !extension) { print ENVIRON["UPSUN_IMPORT_ROLE"]; superuser = 0 }
          if (extension && !superuser) { print "RESET ROLE;"; superuser = 1 }
        }
        acl = /; Type: (ACL|DEFAULT ACL);/
        blobs = /; Type: BLOBS;/
      }
      if (outside && acl) next
      if (outside && blobs && /^(BEGIN|COMMIT);$/) next
      if (outside && (/^COMMENT ON EXTENSION / ||
          (ENVIRON["UPSUN_IMPORT_MODE"] == "push" && /^DROP EXTENSION /))) skip = 1
      reset = outside && /^DROP EXTENSION / && !superuser
      scan($0)
      if (skip) { if (ended && dollar == "" && quote == "") skip = 0; next }
      if (reset) print "RESET ROLE;"
      print
      if (reset) print ENVIRON["UPSUN_IMPORT_ROLE"]
    }
    END { if (superuser) print ENVIRON["UPSUN_IMPORT_ROLE"] }
  ' "$2"
}

# Resolve PLATFORM_BRANCH to an environment we can sync against.
upsun_ensure_active_environment() {
  local original="$PLATFORM_BRANCH"
  local parent=""
  local skip_parent=0
  local rc=0

  if [ "${UPSUN_SYNC_NO_PARENT:-}" = "1" ] || [ "${UPSUN_SYNC_ENV_EXPLICIT:-}" = "1" ]; then
    skip_parent=1
  fi

  lando_pink "Verifying $PLATFORM_BRANCH is an active environment..."

  rc=0
  upsun_require_active "$PLATFORM_BRANCH" || rc=$?
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  # Already reported above. Retrying against the parent here would quietly import
  # a different environment's data over the local one.
  if [ "$rc" -eq 2 ]; then
    return 1
  fi

  if [ "$skip_parent" = "1" ]; then
    lando_red "Could not resume $original (status: ${UPSUN_LAST_ENV_STATUS:-unknown}) and parent fallback is disabled"
    return 1
  fi

  if ! parent="$(upsun_platform environment:info -e "$original" parent 2>/dev/null)" || [ -z "$parent" ]; then
    lando_red "Could not determine the parent of $original"
    return 2
  fi
  if [ -n "$UPSUN_LAST_ENV_STATUS" ]; then
    lando_yellow "Could not resume $original (status: $UPSUN_LAST_ENV_STATUS); using the parent environment ($parent) instead"
  else
    lando_yellow "Branch $original is not an active environment; using the parent environment ($parent) instead"
  fi
  PLATFORM_BRANCH="$parent"

  rc=0
  upsun_require_active "$PLATFORM_BRANCH" || rc=$?
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if [ "$rc" -eq 2 ]; then
    return 1
  fi

  lando_red "Could not verify $PLATFORM_BRANCH is an active environment (status: ${UPSUN_LAST_ENV_STATUS:-unknown})"
  return 1
}
