#!/bin/bash
#
# Source this to get the shell environment an Upsun SSH session has:
# the PLATFORM_* variables are already in the container env; this adds
# the application's .environment file (sourced, like Upsun does).

if [ "${UPSUN_CLI_CONTEXT:-}" != 1 ] && [ -f "${UPSUN_TETHER_ENV_FILE:-/tmp/upsun-tether.env}" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${UPSUN_TETHER_ENV_FILE:-/tmp/upsun-tether.env}"
  set +a
fi

if [ -f "${PLATFORM_APP_DIR:-/app}/.environment" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${PLATFORM_APP_DIR:-/app}/.environment"
  set +a
fi
