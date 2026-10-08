#!/bin/bash
#
# Source this to get the shell environment an Upsun SSH session has:
# the PLATFORM_* variables are already in the container env; this adds
# the application's .environment file (sourced, like Upsun does).

if [ -f "${PLATFORM_APP_DIR:-/app}/.environment" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${PLATFORM_APP_DIR:-/app}/.environment"
  set +a
fi
