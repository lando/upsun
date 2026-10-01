#!/bin/bash
set -eo pipefail

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"
# shellcheck source=/dev/null
. "${UPSUN_ENV_HELPER:-/helpers/upsun-env.sh}"

tether_file="${UPSUN_TETHER_ENV_FILE:-/tmp/upsun-tether.env}"
if [ "${UPSUN_TETHERED:-}" = 1 ]; then
  timeout="${UPSUN_TETHER_TIMEOUT:-120}"
  elapsed=0
  if [ ! -f "$tether_file" ]; then
    lando_pink "Waiting for the Upsun tether..."
  fi
  while [ ! -f "$tether_file" ] && [ "$elapsed" -lt "$timeout" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if [ -f "$tether_file" ]; then
    # shellcheck source=/dev/null
    . "${UPSUN_ENV_HELPER:-/helpers/upsun-env.sh}"
  else
    lando_yellow "Tether not ready after ${timeout}s; starting without remote relationships"
  fi
fi

cd "${PLATFORM_APP_DIR:-/app}"

if [ "${UPSUN_PROVISION_WAIT:-0}" -gt 0 ]; then
  provisioned_file="${UPSUN_PROVISIONED_FILE:-/dev/shm/upsun-provisioned}"
  elapsed=0
  if [ ! -f "$provisioned_file" ]; then
    lando_pink "Waiting for database provisioning..."
  fi
  while [ ! -f "$provisioned_file" ] && [ "$elapsed" -lt "$UPSUN_PROVISION_WAIT" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if [ ! -f "$provisioned_file" ]; then
    lando_yellow "Database provisioning not finished after ${UPSUN_PROVISION_WAIT}s; starting anyway"
  fi
fi

if [ -n "${PLATFORM_PRE_APP_COMMAND:-}" ]; then
  lando_pink "Running pre_start"
  set +e
  printf '%s\n' "$PLATFORM_PRE_APP_COMMAND" | bash -e
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    lando_red "pre_start failed"
    exit "$status"
  fi
fi

if [ -n "${PLATFORM_APP_COMMAND:-}" ]; then
  exec bash -c "$PLATFORM_APP_COMMAND"
fi

exec tail -f /dev/null
