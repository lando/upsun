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

environment_type="$(upsun_platform_raw environment:info -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" type 2>/dev/null || true)"
if [ "${UPSUN_SYNC_FORCE:-}" != 1 ] && {
  [ "$environment_type" = production ] || [ "$PLATFORM_BRANCH" = main ] || [ "$PLATFORM_BRANCH" = master ];
}; then
  lando_red "Refusing to push to the production environment without --force"
  exit 6
fi

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

  lando_pink "Dumping the local $rel_name database"
  case "${!scheme_var}" in
    mysql)
      dump_client="$(command -v mysqldump || command -v mariadb-dump)"
      MYSQL_PWD="${!password_var}" "$dump_client" --host="${!host_var}" --port="${!port_var}" \
        --user="${!user_var}" "${!path_var}" > "$dump_file"
      ;;
    pgsql|postgresql)
      PGPASSWORD="${!password_var}" pg_dump --host="${!host_var}" --port="${!port_var}" \
        --username="${!user_var}" --dbname="${!path_var}" --file="$dump_file"
      ;;
    *)
      lando_red "Unsupported database scheme for $rel_name: ${!scheme_var}"
      exit 3
      ;;
  esac
  upsun_platform_raw db:sql -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" -r "$rel_name" < "$dump_file"
done

for mount in "${mounts[@]}"; do
  [ "$mount" = none ] && continue
  local_mount="${mount%%:*}"
  remote_mount="${mount#*:}"
  [ "$remote_mount" = "$mount" ] && remote_mount="$local_mount"
  source_dir="${PLATFORM_APP_DIR:-/app}/${local_mount#/}"
  lando_pink "Uploading the $local_mount mount"
  upsun_platform_raw mount:upload -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" \
    -m "$remote_mount" --source "$source_dir" -y
done

lando_green "Push completed successfully"
