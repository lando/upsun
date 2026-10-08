#!/bin/bash
set -e

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

echo "$@" >> "${MOCK_PLATFORM_LOG:-/tmp/mock-platform.log}"

woken_file() {
  echo "${MOCK_WOKEN_FILE:-${MOCK_PLATFORM_LOG:-/tmp/mock-platform.log}.woken}"
}

# Persist a successfully woken env so later `env -I` lists it.
remember_woken() {
  local env_id="$1"
  [ -n "$env_id" ] || return 0
  echo "$env_id" >> "$(woken_file)"
}

status_file() {
  echo "${MOCK_STATUS_FILE:-${MOCK_PLATFORM_LOG:-/tmp/mock-platform.log}.status}"
}

# Record that a wake took, so the environment reports `active` afterwards. This is
# what the real CLI does once its activity finishes.
remember_status() {
  local env_id="$1"
  local status="$2"
  [ -n "$env_id" ] || return 0
  echo "$env_id $status" >> "$(status_file)"
}

# Resolution order: a recorded post-wake status, then a MOCK_STATUSES pair
# (`feat=paused main=active`), then the single MOCK_STATUS for every environment.
status_for() {
  local env_id="$1"
  local recorded=""
  if [ -n "$env_id" ] && [ -f "$(status_file)" ]; then
    recorded="$(awk -v e="$env_id" '$1 == e { print $2 }' "$(status_file)" | tail -n 1)"
  fi
  if [ -n "$recorded" ]; then
    echo "$recorded"
    return 0
  fi
  local pair
  # shellcheck disable=SC2086
  for pair in ${MOCK_STATUSES:-}; do
    case "$pair" in
      "$env_id"=*)
        echo "${pair#*=}"
        return 0
        ;;
    esac
  done
  # Default to a healthy environment. Set MOCK_STATUS='' for an unreadable status.
  echo "${MOCK_STATUS-active}"
}

# Pull the -e / --environment value from argv.
env_from_args() {
  local prev=""
  local arg
  for arg in "$@"; do
    case "$arg" in
      -e|--environment)
        prev=e
        ;;
      -e=*|--environment=*)
        echo "${arg#*=}"
        return 0
        ;;
      *)
        if [ "$prev" = e ]; then
          echo "$arg"
          return 0
        fi
        prev=""
        ;;
    esac
  done
  return 1
}

case "$1" in
  env)
    if [ -n "${MOCK_ACTIVE:-}" ]; then
      # shellcheck disable=SC2086
      printf '%s\n' ${MOCK_ACTIVE}
    fi
    if [ -f "$(woken_file)" ]; then
      cat "$(woken_file)"
    fi
    exit 0
    ;;
  environment:info)
    prop=""
    skip_next=0
    for argument in "$@"; do
      if [ "$skip_next" = 1 ]; then
        skip_next=0
        continue
      fi
      case "$argument" in
        -e|--environment|-p|--project)
          skip_next=1
          continue
          ;;
        status|parent|type)
          prop="$argument"
          ;;
      esac
    done
    case "$prop" in
      status)
        if [ -n "${MOCK_STATUS_SEQUENCE:-}" ]; then
          sequence_file="${MOCK_PLATFORM_LOG}.sequence"
          count=0
          [ ! -f "$sequence_file" ] || read -r count < "$sequence_file"
          count=$((count + 1))
          echo "$count" > "$sequence_file"
          read -r -a sequence <<< "$MOCK_STATUS_SEQUENCE"
          index=$((count - 1))
          [ "$index" -lt "${#sequence[@]}" ] || index=$((${#sequence[@]} - 1))
          value="${sequence[$index]}"
          case "$value" in
            empty) exit 0 ;;
            fail-active) echo active; exit 1 ;;
            *) echo "$value"; exit 0 ;;
          esac
        fi
        status_for "$(env_from_args "$@")"
        if [ -f "$(status_file)" ]; then exit "${MOCK_WAKE_STATUS_RC:-${MOCK_STATUS_RC:-0}}"; fi
        exit "${MOCK_STATUS_RC:-0}"
        ;;
      parent) [ "${MOCK_PARENT_RC:-0}" = 0 ] || exit "$MOCK_PARENT_RC"; echo "${MOCK_PARENT-master}" ;;
      type) [ "${MOCK_TYPE_RC:-0}" = 0 ] || exit "$MOCK_TYPE_RC"; echo "${MOCK_ENV_TYPE-development}" ;;
    esac
    exit 0
    ;;
  environment:resume)
    if [ "${MOCK_RESUME_RC:-0}" -eq 0 ] && [ "${MOCK_WAKE_NO_LIST:-}" != "1" ]; then
      remember_woken "$(env_from_args "$@")"
      remember_status "$(env_from_args "$@")" "${MOCK_WAKE_STATUS-active}"
    fi
    exit "${MOCK_RESUME_RC:-0}"
    ;;
  environment:activate)
    if [ "${MOCK_ACTIVATE_RC:-0}" -eq 0 ] && [ "${MOCK_WAKE_NO_LIST:-}" != "1" ]; then
      remember_woken "$(env_from_args "$@")"
      remember_status "$(env_from_args "$@")" "${MOCK_WAKE_STATUS-active}"
    fi
    exit "${MOCK_ACTIVATE_RC:-0}"
    ;;
  project:set-remote)
    exit 0
    ;;
  project:info)
    echo "${MOCK_PROJECT_ID:-proj}"
    exit 0
    ;;
  db:dump)
    [ "${MOCK_DOWNLOAD_RC:-0}" = 0 ] || exit "$MOCK_DOWNLOAD_RC"
    output=""
    gzip_output=0
    previous=""
    for argument in "$@"; do
      if [ "$previous" = file ]; then output="$argument"; break; fi
      [ "$argument" = -f ] && previous="file"
      [ "$argument" = --gzip ] && gzip_output=1
    done
    if [ "${MOCK_BAD_GZIP:-0}" = 1 ]; then
      printf 'not gzip' > "$output"
    elif [ "$gzip_output" = 1 ]; then
      if [ -n "${MOCK_DUMP_SQL_FILE:-}" ]; then
        gzip -c "$MOCK_DUMP_SQL_FILE" > "$output"
      else
        printf 'SELECT 1;\n' | gzip > "$output"
      fi
    else
      printf 'SELECT 1;\n' > "$output"
    fi
    ;;
  db:sql)
    cat > "${MOCK_UPLOAD_SQL_FILE:-/dev/null}"
    exit "${MOCK_UPLOAD_RC:-0}"
    ;;
  auth:info|mount:download|mount:upload)
    ;;
  *)
    exit 0
    ;;
esac
