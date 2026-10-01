#!/bin/bash
set -e

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
    last="${@: -1}"
    case "$last" in
      status) echo "${MOCK_STATUS:-}" ;;
      parent) echo "${MOCK_PARENT:-master}" ;;
      type) echo "${MOCK_ENV_TYPE:-development}" ;;
    esac
    exit 0
    ;;
  environment:resume)
    if [ "${MOCK_RESUME_RC:-0}" -eq 0 ] && [ "${MOCK_WAKE_NO_LIST:-}" != "1" ]; then
      remember_woken "$(env_from_args "$@")"
    fi
    exit "${MOCK_RESUME_RC:-0}"
    ;;
  environment:activate)
    if [ "${MOCK_ACTIVATE_RC:-0}" -eq 0 ] && [ "${MOCK_WAKE_NO_LIST:-}" != "1" ]; then
      remember_woken "$(env_from_args "$@")"
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
    output=""
    gzip_output=0
    previous=""
    for argument in "$@"; do
      if [ "$previous" = file ]; then output="$argument"; break; fi
      [ "$argument" = -f ] && previous=file
      [ "$argument" = --gzip ] && gzip_output=1
    done
    if [ "$gzip_output" = 1 ]; then
      printf 'SELECT 1;\n' | gzip > "$output"
    else
      printf 'SELECT 1;\n' > "$output"
    fi
    ;;
  db:sql)
    cat >/dev/null
    ;;
  auth:info|mount:download|mount:upload)
    ;;
  *)
    exit 0
    ;;
esac
