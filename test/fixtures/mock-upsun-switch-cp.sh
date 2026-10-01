#!/bin/bash
set -e

args=()
for arg in "$@"; do
  case "$arg" in
    /tmp/.lando.yml.*) args+=("$LANDO_MOUNT/stash-${arg##*/}") ;;
    *) args+=("$arg") ;;
  esac
done
/bin/cp "${args[@]}"
