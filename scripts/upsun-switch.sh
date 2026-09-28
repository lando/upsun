#!/bin/bash
set -e

. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"
. "${UPSUN_SYNC_ENV:-$(dirname "$0")/upsun-sync-env.sh}"

unset PLATFORM_RELATIONSHIPS
unset PLATFORM_APPLICATION

ENV=""
forwarded=()
skip_db=0
skip_files=0
# Lando prepends interactive passthrough flags before the positional argv.
while (( "$#" )); do
  case "$1" in
    --auth|--project|-p|--app|-A|--relationship|-r|--mount|-m)
      if [ "$#" -lt 2 ]; then
        lando_red "Missing value for $1"
        exit 1
      fi
      forwarded+=("$1" "$2")
      shift 2
      ;;
    --skip-db|--skip-db=true)
      skip_db=1
      forwarded+=(--skip-db)
      shift
      ;;
    --skip-files|--skip-files=true)
      skip_files=1
      forwarded+=(--skip-files)
      shift
      ;;
    --auth=*|--project=*|-p=*|--app=*|-A=*|--relationship=*|-r=*|--mount=*|-m=*|--no-parent|--no-parent=*)
      forwarded+=("$1")
      shift
      ;;
    -*) shift ;;
    *)
      [ -n "$ENV" ] || ENV="$1"
      shift
      ;;
  esac
done
if [ -z "$ENV" ]; then
  lando_red "An environment ID is required: lando switch <environment>"
  exit 1
fi

cd "$LANDO_MOUNT"
PLATFORM_AUTH="${!UPSUN_CLI_TOKEN_VAR:-}"
upsun_parse_sync_args "${forwarded[@]}" --env "$ENV"
printf -v "$UPSUN_CLI_TOKEN_VAR" '%s' "$PLATFORM_AUTH"
export "$UPSUN_CLI_TOKEN_VAR"
upsun_platform_raw auth:info
upsun_bind_project
if [ -z "${PLATFORM_PROJECT:-}" ]; then
  PLATFORM_PROJECT="$(upsun_platform_raw project:info id)"
  export PLATFORM_PROJECT
fi

CURRENT_LANDO_YML="$LANDO_MOUNT/.lando.yml"
STASHED_LANDO_YML="/tmp/.lando.yml.$ENV"
stashed=0
if [ -f "$CURRENT_LANDO_YML" ]; then
  cp "$CURRENT_LANDO_YML" "$STASHED_LANDO_YML"
  stashed=1
fi

# Both CLIs expose environment:checkout <id> (alias: checkout).
# https://github.com/platformsh/legacy-cli/blob/main/src/Command/Environment/EnvironmentCheckoutCommand.php
upsun_platform environment:checkout "$ENV"
if [ "$stashed" = 1 ] && [ ! -f "$CURRENT_LANDO_YML" ]; then
  cp "$STASHED_LANDO_YML" "$CURRENT_LANDO_YML"
fi

if [ "$skip_db" != 1 ] || [ "$skip_files" != 1 ]; then
  "${UPSUN_PULL_SCRIPT:-/helpers/upsun-pull.sh}" --env "$ENV" "${forwarded[@]}"
fi
if [ "${UPSUN_TETHERED:-}" = 1 ]; then
  lando_yellow "Run lando restart so the tether reconnects to $ENV"
fi
lando_green "Switched to $ENV"
