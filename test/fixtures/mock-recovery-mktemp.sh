#!/bin/bash
set -e

if [ "$1" = -d ]; then
  exec mktemp "$@"
fi
exit 1
