#!/bin/bash
# Source the shared sync helper with stubbed lando loggers for unit tests.
set -e
lando_pink() { echo "PINK $*" >&2; }
lando_green() { echo "GREEN $*" >&2; }
lando_yellow() { echo "YELLOW $*" >&2; }
lando_red() { echo "RED $*" >&2; }
lando_info() { echo "INFO $*" >&2; }
lando_warn() { echo "WARN $*" >&2; }

. "$(dirname "$0")/../../scripts/upsun-sync-env.sh"

mode="$1"
shift || true

case "$mode" in
  parse)
    upsun_parse_sync_args "$@"
    echo "AUTH=${PLATFORM_AUTH:-}"
    echo "PROJECT=${PLATFORM_PROJECT:-}"
    echo "BRANCH=${PLATFORM_BRANCH:-}"
    echo "NO_PARENT=${UPSUN_SYNC_NO_PARENT:-}"
    echo "ENV_EXPLICIT=${UPSUN_SYNC_ENV_EXPLICIT:-}"
    echo "RELS=${PLATFORM_SYNC_RELATIONSHIPS[*]}"
    echo "MOUNTS=${PLATFORM_SYNC_MOUNTS[*]}"
    ;;
  ensure)
    PLATFORM_BRANCH="$1"
    upsun_ensure_active_environment
    echo "BRANCH=${PLATFORM_BRANCH}"
    ;;
  bind)
    PLATFORM_PROJECT="$1"
    upsun_bind_project
    echo "PROJECT=${PLATFORM_PROJECT}"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
