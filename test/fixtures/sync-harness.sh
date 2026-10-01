#!/bin/bash
set -e

export UPSUN_LOG_HELPER="$(dirname "$0")/log.sh"

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
    echo "FORCE=${UPSUN_SYNC_FORCE:-}"
    echo "ENV_EXPLICIT=${UPSUN_SYNC_ENV_EXPLICIT:-}"
    echo "RELS=${PLATFORM_SYNC_RELATIONSHIPS[*]}"
    echo "MOUNTS=${PLATFORM_SYNC_MOUNTS[*]}"
    echo "ALL_MOUNTS=${UPSUN_SYNC_ALL_MOUNTS:-}"
    echo "APP=${UPSUN_SYNC_APP:-}"
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
