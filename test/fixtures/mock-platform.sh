#!/bin/bash
# Fake `platform` CLI for unit tests. Behavior is driven by MOCK_* env vars.
echo "$@" >> "${MOCK_PLATFORM_LOG:-/tmp/mock-platform.log}"

case "$1" in
  env)
    if [ -n "${MOCK_ACTIVE:-}" ]; then
      # shellcheck disable=SC2086
      printf '%s\n' ${MOCK_ACTIVE}
    fi
    exit 0
    ;;
  environment:info)
    last="${@: -1}"
    case "$last" in
      status) echo "${MOCK_STATUS:-}" ;;
      parent) echo "${MOCK_PARENT:-master}" ;;
    esac
    exit 0
    ;;
  environment:resume)
    exit "${MOCK_RESUME_RC:-0}"
    ;;
  environment:activate)
    exit "${MOCK_ACTIVATE_RC:-0}"
    ;;
  project:set-remote)
    exit 0
    ;;
  project:info)
    echo "${MOCK_PROJECT_ID:-proj}"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
