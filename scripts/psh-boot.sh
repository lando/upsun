#!/bin/sh
# Compatibility wrapper for the pre-rename helper name.
exec "$(dirname "$0")/upsun-boot.sh" "$@"
