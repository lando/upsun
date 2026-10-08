#!/bin/bash
set -e

if [ "${1:-}" = -m ]; then
  printf '%b\n' "${MOCK_PHP_MODULES:-Core\nopcache\nredis}"
fi
