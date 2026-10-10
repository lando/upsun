#!/bin/bash
set -e

if [ "${1:-}" = -m ]; then
  printf '%b\n' "${MOCK_PHP_MODULES:-Core\nopcache\nredis}"
elif [ "${1:-}" = -r ] && [ "${2:-}" = 'echo phpversion("xdebug");' ]; then
  printf '%s' "${MOCK_XDEBUG_VERSION-3.5.0}"
fi
