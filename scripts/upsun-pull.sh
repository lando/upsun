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
upsun_ensure_active_environment

upsun_sync_selections
upsun_sync_temp
for relationship in "${relationships[@]}"; do
  [ "$relationship" = none ] && continue
  upsun_sync_database "$relationship"
  dump_file="$sync_temp/dump.sql.gz"
  sql_file="$sync_temp/dump.sql"
  "${UPSUN_RM:-rm}" -f -- "$dump_file" "$sql_file"

  lando_pink "Downloading the $rel_name database"
  upsun_platform_raw \
    db:dump -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" "${app_args[@]}" -r "$rel_name" --schema "$database" --gzip -f "$dump_file"
  # Decompress completely (including the gzip checksum) before any destructive SQL.
  "${UPSUN_GUNZIP:-gunzip}" -c "$dump_file" > "$sql_file"
  if [ ! -s "$sql_file" ]; then
    lando_red "Empty database dump for $rel_name:$database; refusing to clear local data"
    exit 1
  fi
  case "${!scheme_var}" in
    mysql)
      mysql_client="${UPSUN_MYSQL_CLIENT:-$(command -v mysql || command -v mariadb)}"
      mysql_args=(--host="${!host_var}" --port="${!port_var}" --user="${!user_var}" --database="$database")
      backup_file="$sync_temp/local.sql"
      if ! dump_client="${UPSUN_MYSQL_DUMP:-$(command -v mysqldump || command -v mariadb-dump)}" \
        || ! MYSQL_PWD="${!password_var}" "$dump_client" --host="${!host_var}" --port="${!port_var}" \
          --user="${!user_var}" --single-transaction --no-tablespaces -- "$database" > "$backup_file"; then
        lando_red "Could not back up $rel_name:$database; refusing to clear local data"
        backup_file=""
        exit 1
      fi
      # The backup must leave sync_temp before any DROP to survive EXIT cleanup on signals.
      if saved_backup="$("${UPSUN_MKTEMP:-mktemp}" \
        "${UPSUN_SYNC_TMPDIR:-${TMPDIR:-/tmp}}/upsun-backup.XXXXXXXX.sql")" \
        && "${UPSUN_CP:-cp}" -- "$backup_file" "$saved_backup"; then
        backup_file="$saved_backup"
      else
        lando_red "Could not preserve the backup of $rel_name:$database; refusing to clear local data"
        backup_file=""
        exit 1
      fi
      upsun_pull_mysql_clean() {
        # The server quotes identifiers, including backticks and embedded newlines.
        MYSQL_PWD="${!password_var}" "$mysql_client" "${mysql_args[@]}" --batch --raw --skip-column-names \
          --execute="SELECT CONCAT('DROP ', IF(TABLE_TYPE = 'VIEW', 'VIEW', 'TABLE'), ' IF EXISTS \`',
            REPLACE(TABLE_NAME, '\`', '\`\`'), '\`;') FROM information_schema.tables
            WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_TYPE DESC" </dev/null > "$sync_temp/drop.sql" || return "$?"
        {
          printf 'SET FOREIGN_KEY_CHECKS=0;\n'
          "${UPSUN_CAT:-cat}" "$sync_temp/drop.sql" || return "$?"
          printf 'SET FOREIGN_KEY_CHECKS=1;\n'
        } > "$sync_temp/clean.sql" || return "$?"
        MYSQL_PWD="${!password_var}" "$mysql_client" "${mysql_args[@]}" < "$sync_temp/clean.sql"
      }
      if ! upsun_pull_mysql_clean \
        || ! MYSQL_PWD="${!password_var}" "$mysql_client" "${mysql_args[@]}" < "$sql_file"; then
        # Re-query after a partial cleanup/import: new objects may now exist.
        if upsun_pull_mysql_clean \
          && MYSQL_PWD="${!password_var}" "$mysql_client" "${mysql_args[@]}" < "$backup_file"; then
          lando_red "Pull failed for $rel_name:$database; previous local data was restored"
          "${UPSUN_RM:-rm}" -f -- "$backup_file"
          backup_file=""
        else
          lando_red "Restore failed for $rel_name:$database"
        fi
        exit 1
      fi
      "${UPSUN_RM:-rm}" -f -- "$backup_file"
      backup_file=""
      ;;
    pgsql|postgresql)
      # Preserve namespaces, their grants, and extension-owned objects. No CASCADE:
      # unsupported dependencies stop and roll back instead of deleting extra objects.
      endpoint_role="${!user_var}"
      endpoint_role="${endpoint_role//\"/\"\"}"
      role_sql="SET ROLE \"$endpoint_role\";"
      printf '%s\n' "$role_sql" > "$sync_temp/clean.sql"
      "${UPSUN_CAT:-cat}" >> "$sync_temp/clean.sql" <<'SQL'
DO $clean$
DECLARE kind "char"; objects text; object_type text; item record;
BEGIN
  FOREACH kind IN ARRAY ARRAY['v', 'm', 'r', 'S']::"char"[] LOOP
    object_type := CASE kind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
      WHEN 'r' THEN 'TABLE' ELSE 'SEQUENCE' END;
    SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ') INTO objects
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE (c.relkind = kind OR (kind = 'r' AND c.relkind = 'p'))
        AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid AND d.deptype = 'e');
    IF objects IS NOT NULL THEN EXECUTE 'DROP ' || object_type || ' ' || objects; END IF;
  END LOOP;
  FOR item IN SELECT p.oid, p.prokind, n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'w')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('DROP %s %I.%I(%s)',
      CASE item.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      item.nspname, item.proname, item.args);
  END LOOP;
  FOR item IN SELECT t.typname, t.typtype, n.nspname
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c')
      AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid
        AND c.relkind IN ('r', 'v', 'm', 'p'))
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass
        AND d.objid = t.oid AND d.deptype = 'e') LOOP
    EXECUTE format('DROP %s %I.%I',
      CASE item.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, item.nspname, item.typname);
  END LOOP;
  PERFORM lo_unlink(oid) FROM pg_largeobject_metadata;
END
$clean$;
SQL
      # Remote ACLs name remote roles; local endpoint grants come from db init.
      # pg_dump's large-object BEGIN/COMMIT must not commit our transaction early.
      upsun_rewrite_pg_dump pull "$sql_file" "$role_sql" >> "$sync_temp/clean.sql"
      PGPASSWORD='' "${UPSUN_PSQL_CLIENT:-psql}" --host="${!host_var}" \
        --port="${!port_var}" --username="${UPSUN_PG_SUPERUSER:-postgres}" --dbname="$database" \
        -X -v ON_ERROR_STOP=1 --single-transaction -f - < "$sync_temp/clean.sql"
      ;;
    *)
      lando_red "Unsupported database scheme for $rel_name: ${!scheme_var}"
      exit 3
      ;;
  esac
done

if [ "${UPSUN_SYNC_ALL_MOUNTS:-}" = 1 ]; then
  lando_pink "Downloading all mounts"
  upsun_platform_raw mount:download -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" "${app_args[@]}" \
    --all --target "${PLATFORM_APP_DIR:-/app}" -y
else
  for mount in "${mounts[@]}"; do
    [ "$mount" = none ] && continue
    remote_mount="${mount%%:*}"
    target="${mount#*:}"
    if [ "$target" = "$mount" ]; then
      target="${PLATFORM_APP_DIR:-/app}/${remote_mount#/}"
    fi
    mkdir -p "$target"
    lando_pink "Downloading the $remote_mount mount"
    upsun_platform_raw mount:download -p "$PLATFORM_PROJECT" -e "$PLATFORM_BRANCH" "${app_args[@]}" \
      -m "$remote_mount" --target "$target" -y
  done
fi

lando_green "Pull completed successfully"
