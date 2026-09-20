#!/bin/bash
set -e

. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"
. "$(dirname "$0")/upsun-sync-env.sh"

unset PLATFORM_RELATIONSHIPS
unset PLATFORM_APPLICATION

PLATFORM_AUTH="${!UPSUN_CLI_TOKEN_VAR:-}"
PLATFORM_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
upsun_parse_sync_args "$@"
relationships=("${PLATFORM_SYNC_RELATIONSHIPS[@]}")
mounts=("${PLATFORM_SYNC_MOUNTS[@]}")

printf -v "$UPSUN_CLI_TOKEN_VAR" '%s' "$PLATFORM_AUTH"
export "$UPSUN_CLI_TOKEN_VAR"
upsun_platform_raw auth:info
upsun_bind_project
if [ -z "${PLATFORM_PROJECT:-}" ]; then
  PLATFORM_PROJECT="$(upsun_platform_raw project:info id)"
  export PLATFORM_PROJECT
fi
upsun_ensure_active_environment

for relationship in "${relationships[@]}"; do
  [ "$relationship" = none ] && continue
  rel_name="${relationship%%:*}"
  rel_key="$(printf '%s' "$rel_name" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"
  host_var="${rel_key}_HOST"
  port_var="${rel_key}_PORT"
  user_var="${rel_key}_USERNAME"
  password_var="${rel_key}_PASSWORD"
  path_var="${rel_key}_PATH"
  scheme_var="${rel_key}_SCHEME"
  dump_file="/tmp/${rel_key}.sql"

  lando_pink "Downloading the $rel_name database"
  upsun_platform_raw db:dump -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" -r "$rel_name" -f "$dump_file"
  case "${!scheme_var}" in
    mysql)
      mysql_client="$(command -v mysql || command -v mariadb)"
      MYSQL_PWD="${!password_var}" "$mysql_client" --host="${!host_var}" --port="${!port_var}" \
        --user="${!user_var}" "${!path_var}" < "$dump_file"
      ;;
    pgsql|postgresql)
      PGPASSWORD="${!password_var}" psql --host="${!host_var}" --port="${!port_var}" \
        --username="${!user_var}" --dbname="${!path_var}" --file="$dump_file"
      ;;
    *)
      lando_red "Unsupported database scheme for $rel_name: ${!scheme_var}"
      exit 3
      ;;
  esac
done

for mount in "${mounts[@]}"; do
  [ "$mount" = none ] && continue
  remote_mount="${mount%%:*}"
  target="${mount#*:}"
  if [ "$target" = "$mount" ]; then
    target="${PLATFORM_APP_DIR:-/app}/${remote_mount#/}"
  fi
  mkdir -p "$target"
  lando_pink "Downloading the $remote_mount mount"
  upsun_platform_raw mount:download -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" \
    -m "$remote_mount" --target "$target" -y
done

lando_green "Pull completed successfully"
