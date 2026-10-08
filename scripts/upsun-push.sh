#!/bin/bash
# Connection variables are assigned by the injectable shared sync helper.
# shellcheck disable=SC2154
set -eo pipefail
{ set +x; } 2>/dev/null

# shellcheck source=/dev/null
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"
# shellcheck source=/dev/null
. "${UPSUN_SYNC_ENV:-$(dirname "$0")/upsun-sync-env.sh}"

unset PLATFORM_RELATIONSHIPS
unset PLATFORM_APPLICATION

PLATFORM_AUTH="${!UPSUN_CLI_TOKEN_VAR:-}"
PLATFORM_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
upsun_parse_sync_args "$@"
export UPSUN_SYNC_NO_PARENT=1
relationships=("${PLATFORM_SYNC_RELATIONSHIPS[@]}")
mounts=("${PLATFORM_SYNC_MOUNTS[@]}")
mapfile -t app_args < <(upsun_app_args)

printf -v "$UPSUN_CLI_TOKEN_VAR" '%s' "$PLATFORM_AUTH"
export "${UPSUN_CLI_TOKEN_VAR?}"
upsun_platform_raw auth:info
upsun_bind_project
if [ -z "${PLATFORM_PROJECT:-}" ]; then
  PLATFORM_PROJECT="$(upsun_platform_raw project:info id)"
  export PLATFORM_PROJECT
fi
if ! upsun_ensure_active_environment; then
  lando_red "Cannot push to $PLATFORM_BRANCH; resume it or pass --env to select an active target"
  exit 1
fi

type_status=0
environment_type="$(upsun_platform_raw environment:info -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" type 2>/dev/null)" \
  || type_status=$?
if [ "${UPSUN_SYNC_FORCE:-}" != 1 ]; then
  if [ "$PLATFORM_BRANCH" = main ] || [ "$PLATFORM_BRANCH" = master ]; then
    lando_red "Refusing to push to the production environment without --force"
    exit 6
  fi
  if [ "$type_status" -ne 0 ]; then
    lando_red "Could not verify the environment type; retry or pass --force"
    exit 7
  fi
  case "$environment_type" in
    production) lando_red "Refusing to push to the production environment without --force"; exit 6 ;;
    development|staging) ;;
    *) lando_red "Unrecognized environment type '$environment_type'; retry or pass --force"; exit 7 ;;
  esac
fi

upsun_sync_selections
upsun_sync_temp
for relationship in "${relationships[@]}"; do
  [ "$relationship" = none ] && continue
  upsun_sync_database "$relationship"
  dump_file="$sync_temp/dump.sql"

  lando_pink "Dumping the local $rel_name database"
  case "${!scheme_var}" in
    mysql)
      dump_client="${UPSUN_MYSQL_DUMP:-$(command -v mysqldump || command -v mariadb-dump)}"
      MYSQL_PWD="${!password_var}" "$dump_client" --host="${!host_var}" --port="${!port_var}" \
        --user="${!user_var}" -- "$database" > "$dump_file"
      ;;
    pgsql|postgresql)
      PGPASSWORD="${!password_var}" "${UPSUN_PG_DUMP:-pg_dump}" --host="${!host_var}" --port="${!port_var}" \
        --username="${!user_var}" --dbname="$database" --file="$dump_file" \
        --clean --if-exists --no-owner --no-acl
      # Extensions are provisioned by the Upsun service config and owned by its superuser, so the
      # endpoint user cannot drop or comment on them; CREATE EXTENSION IF NOT EXISTS is left in place.
      {
        printf '\\set ON_ERROR_STOP on\nBEGIN;\n'
        upsun_rewrite_pg_dump push "$dump_file"
        printf 'COMMIT;\n'
      } > "$sync_temp/import.sql"
      dump_file="$sync_temp/import.sql"
      ;;
    *)
      lando_red "Unsupported database scheme for $rel_name: ${!scheme_var}"
      exit 3
      ;;
  esac
  remote_backup=""
  if [ "${!scheme_var}" = mysql ]; then
    if ! upsun_platform_raw db:dump -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" "${app_args[@]}" \
      -r "$rel_name" --schema "$database" -f "$sync_temp/remote.sql" \
      || [ ! -s "$sync_temp/remote.sql" ]; then
      lando_red "Could not back up remote $rel_name:$database; refusing to import"
      exit 1
    fi
    if ! remote_backup="$("${UPSUN_MKTEMP:-mktemp}" \
      "${UPSUN_SYNC_TMPDIR:-${TMPDIR:-/tmp}}/upsun-remote-backup.XXXXXXXX.sql")" \
      || ! "${UPSUN_CP:-cp}" -- "$sync_temp/remote.sql" "$remote_backup"; then
      lando_red "Could not preserve remote backup; refusing to import"
      exit 1
    fi
  fi
  if ! upsun_platform_raw db:sql -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" "${app_args[@]}" \
    -r "$rel_name" --schema "$database" < "$dump_file"; then
    if [ -n "$remote_backup" ]; then
      printf -v restore_command '%q ' "$UPSUN_CLI_BINARY" db:sql -p "$PLATFORM_PROJECT" \
        -e "$PLATFORM_BRANCH" "${app_args[@]}" -r "$rel_name" --schema "$database"
      printf -v restore_file '%q' "$remote_backup"
      lando_red "Push failed; remote backup kept at $remote_backup. Restore with: $restore_command< $restore_file"
    fi
    exit 1
  fi
  [ -z "$remote_backup" ] || "${UPSUN_RM:-rm}" -f -- "$remote_backup"
done

for mount in "${mounts[@]}"; do
  [ "$mount" = none ] && continue
  local_mount="${mount%%:*}"
  remote_mount="${mount#*:}"
  [ "$remote_mount" = "$mount" ] && remote_mount="$local_mount"
  source_dir="${PLATFORM_APP_DIR:-/app}/${local_mount#/}"
  lando_pink "Uploading the $local_mount mount"
  upsun_platform_raw mount:upload -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" "${app_args[@]}" \
    -m "$remote_mount" --source "$source_dir" -y
done

lando_green "Push completed successfully"
