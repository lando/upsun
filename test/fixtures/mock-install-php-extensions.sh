#!/bin/bash
set -e

extension="${1:-}"
printf '%s\n' "$extension" >> "$MOCK_EXT_LOG"
case ",${MOCK_EXT_FAIL:-}," in
  *",$extension,"*) exit 1 ;;
esac
