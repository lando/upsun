#!/bin/bash
set -e

printf '%s\n' "$*" >> "$MOCK_PLATFORM_LOG"
case "$1" in
  auth:info)
    [ -z "${PLATFORM_RELATIONSHIPS:-}${PLATFORM_APPLICATION:-}" ]
    [ "${!UPSUN_CLI_TOKEN_VAR}" = "$MOCK_AUTH" ]
    ;;
  project:info) printf 'discovered-project\n' ;;
  environment:checkout)
    [ "$PWD" = "$LANDO_MOUNT" ]
    [ "${MOCK_CHECKOUT_RC:-0}" = 0 ] || exit "$MOCK_CHECKOUT_RC"
    if [ "${MOCK_DELETE_LANDOFILE:-}" = 1 ]; then
      rm -f .lando.yml
    elif [ "${MOCK_TARGET_LANDOFILE:-}" = 1 ]; then
      printf 'name: target\n' > .lando.yml
    fi
    ;;
esac
