#!/bin/bash

set -e

# Get the lando logger
. /helpers/log.sh
# Shared Fixed env resume / parent fallback (platform + PLATFORMSH_CLI_TOKEN)
. "$(dirname "$0")/upsun-sync-env.sh"

# Set the module
LANDO_MODULE="platformsh"

# Unset PLATFORM_RELATIONSHIPS and PLATFORM_APPLICATION for this script
#
# PLATFORM_RELATIONSHIPS is what the platform cli uses to determine whether
# you are actually on platform or not so if this is set then things like
# platform db:command will use localhost instead of the remote environment
#
# PLATFORM_APPLICATION is similarly used to determine for platform mount:command
OLD_PLATFORM_RELATIONSHIPS=$PLATFORM_RELATIONSHIPS
OLD_PLATFORM_APPLICATION=$PLATFORM_APPLICATION
unset PLATFORM_RELATIONSHIPS
unset PLATFORM_APPLICATION

# Collect mounts, relationships and environment
# PLATFORM_PROJECT comes from Landofile config.id (env) and may be overridden by --project
PLATFORM_AUTH=${PLATFORMSH_CLI_TOKEN}
PLATFORM_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "master")
upsun_parse_sync_args "$@"
PLATFORM_PULL_RELATIONSHIPS=("${PLATFORM_SYNC_RELATIONSHIPS[@]}")
PLATFORM_PULL_MOUNTS=("${PLATFORM_SYNC_MOUNTS[@]}")

# Validate auth
# We re-export in this script just in case PLATFORMSH_CLI_TOKEN has been lost
# which can happen if you destroy and start without reinitializing
export PLATFORMSH_CLI_TOKEN="$PLATFORM_AUTH"
lando_pink "Verifying you are authenticated against Upsun Fixed..."
upsun_platform_raw auth:info

# Bind Landofile / --project id so the CLI does not rely on auto-detect alone
upsun_bind_project
lando_pink "Verifying your current project..."
if [ -n "${PLATFORM_PROJECT:-}" ]; then
  lando_green "Verified project id: $PLATFORM_PROJECT"
else
  PLATFORM_PROJECT="$(upsun_platform project:info id)"
  export PLATFORM_PROJECT
  lando_green "Verified project id: $PLATFORM_PROJECT"
fi

# Wake paused/inactive current-branch env; parent fallback only if wake fails
upsun_ensure_active_environment

# Validate ssh keys are good
lando_pink "Verifying your ssh keys work are deployed to the project..."
if ! upsun_platform ssh -e "$PLATFORM_BRANCH" "true" 2>/dev/null; then
 echo "Could not connect over SSH correctly..."
 lando_info "Redeploying environment to reload keys..."
 upsun_platform redeploy -e "$PLATFORM_BRANCH" -y
fi

# If relationships or mounts contain "none" then unset the whole thing so we skip
for PLATFORM_RELATIONSHIP in "${PLATFORM_PULL_RELATIONSHIPS[@]}"; do
  if [ "$PLATFORM_RELATIONSHIP" == 'none' ]; then
    unset PLATFORM_PULL_RELATIONSHIPS
  fi
done
for PLATFORM_MOUNT in "${PLATFORM_PULL_MOUNTS[@]}"; do
  if [ "$PLATFORM_MOUNT" == 'none' ]; then
    unset PLATFORM_PULL_MOUNTS
  fi
done

# If there are no relationships specified then indicate that
if [ ${#PLATFORM_PULL_RELATIONSHIPS[@]} -eq 0 ]; then
  lando_warn "Looks like you did not pass in any relationships!"
  lando_info "That is not a problem. However here is a list of available relationships you can try next time!"
  upsun_platform relationships --refresh || true
# Otherwise loop through our relationships and import them
else
  for PLATFORM_RELATIONSHIP in "${PLATFORM_PULL_RELATIONSHIPS[@]}"; do
    # Try to split PLATFORM_RELATIONSHIP
    IFS=':' read -r -a PLATFORM_RELATIONSHIP_PARTS <<< "$PLATFORM_RELATIONSHIP"
    # Set the source and target
    PLATFORM_RELATIONSHIP_RELATIONSHIP="${PLATFORM_RELATIONSHIP_PARTS[0]}"
    PLATFORM_RELATIONSHIP_SCHEMA="${PLATFORM_RELATIONSHIP_PARTS[1]}"
    # If PLATFORM_RELATIONSHIP_SCHEMA is still empty lets set it to main
    if [ -z "$PLATFORM_RELATIONSHIP_SCHEMA" ]; then
      eval "PLATFORM_RELATIONSHIP_SCHEMA=\$LANDO_CONNECT_${PLATFORM_RELATIONSHIP_RELATIONSHIP^^}_DEFAULT_SCHEMA"
    fi
    # Build out the connection string
    eval "LCD=\$LANDO_CONNECT_${PLATFORM_RELATIONSHIP_RELATIONSHIP^^}"
    # Dump tables if we need to
    TABLES=$($LCD $PLATFORM_RELATIONSHIP_SCHEMA -e 'SHOW TABLES' | awk '{ print $1}' | grep -v '^Tables' ) || true
    echo "Destroying all current tables in database if needed... "
    for t in $TABLES; do
      echo "Dropping $t from local $PLATFORM_RELATIONSHIP_SCHEMA database..."
      $LCD $PLATFORM_RELATIONSHIP_SCHEMA <<-EOF
        SET FOREIGN_KEY_CHECKS=0;
        DROP VIEW IF EXISTS \`$t\`;
        DROP TABLE IF EXISTS \`$t\`;
EOF
    done
    # Import the DB
    lando_pink "Importing data from the $PLATFORM_RELATIONSHIP_RELATIONSHIP relationship into the $PLATFORM_RELATIONSHIP_SCHEMA schema..."
    upsun_platform db:dump -e "$PLATFORM_BRANCH" -r $PLATFORM_RELATIONSHIP_RELATIONSHIP --schema $PLATFORM_RELATIONSHIP_SCHEMA -o | $LCD $PLATFORM_RELATIONSHIP_SCHEMA
  done
fi

# If there are no mounts specified then indicate that
if [ ${#PLATFORM_PULL_MOUNTS[@]} -eq 0 ]; then
  lando_warn "Looks like you did not pass in any mounts!"
  lando_info "That is not a problem. However here is a list of available mounts you can try next time!"
  upsun_platform mounts --refresh || true
# Otherwise loop through our mounts and download them them
else
  for PLATFORM_MOUNT in "${PLATFORM_PULL_MOUNTS[@]}"; do
    # Try to split PLATFORM_MOUNT
    IFS=':' read -r -a PLATFORM_MOUNT_PARTS <<< "$PLATFORM_MOUNT"
    # Set the source and target
    PLATFORM_MOUNT_SOURCE="${PLATFORM_MOUNT_PARTS[0]}"
    PLATFORM_MOUNT_TARGET="${PLATFORM_MOUNT_PARTS[1]}"
    # If PLATFORM_MOUNT_TARGET is still empty lets set it from the source
    if [ -z "$PLATFORM_MOUNT_TARGET" ]; then
      PLATFORM_MOUNT_TARGET="$LANDO_SOURCE_DIR/$PLATFORM_MOUNT_SOURCE"
    fi
    lando_pink "Downloading files from the $PLATFORM_MOUNT_SOURCE mount into $PLATFORM_MOUNT_TARGET"
    upsun_platform mount:download -e "$PLATFORM_BRANCH" --mount $PLATFORM_MOUNT_SOURCE --target "$PLATFORM_MOUNT_TARGET" -y
  done
fi

# Finish up!
lando_green "Pull completed successfully!"
