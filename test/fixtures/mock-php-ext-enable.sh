#!/bin/bash
set -e

printf '%s\n' "$*" >> "$MOCK_EXT_ENABLE_LOG"
case ",${MOCK_EXT_ENABLE_FAIL:-}," in
  *",$*,"*) exit 1 ;;
esac
