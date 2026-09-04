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

# Collect mounts and relationships
# PLATFORM_PROJECT comes from Landofile config.id (env) and may be overridden by --project
PLATFORM_AUTH=${PLATFORMSH_CLI_TOKEN}
PLATFORM_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "master")
upsun_parse_sync_args "$@"
PLATFORM_PUSH_RELATIONSHIPS=("${PLATFORM_SYNC_RELATIONSHIPS[@]}")
PLATFORM_PUSH_MOUNTS=("${PLATFORM_SYNC_MOUNTS[@]}")

# Error if you want to push to production (git branch or --env)
if [ "$PLATFORM_BRANCH" == 'master' ]; then
  lando_red "Pushing directly to production is not allowed!"
  exit 6
fi

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

# Re-check after possible parent fallback (initial check is the git branch / --env)
if [ "$PLATFORM_BRANCH" == 'master' ]; then
  lando_red "Pushing directly to production is not allowed!"
  exit 6
fi

# Validate ssh keys are good
lando_pink "Verifying your ssh keys work are deployed to the project..."
if ! upsun_platform ssh -e "$PLATFORM_BRANCH" "true" 2>/dev/null; then
 echo "Could not connect over SSH correctly..."
 lando_info "Redeploying environment to reload keys..."
 upsun_platform redeploy -e "$PLATFORM_BRANCH" -y
fi

# If relationships or mounts contain "none" then unset the whole thing so we skip
for PLATFORM_RELATIONSHIP in "${PLATFORM_PUSH_RELATIONSHIPS[@]}"; do
  if [ "$PLATFORM_RELATIONSHIP" == 'none' ]; then
    unset PLATFORM_PUSH_RELATIONSHIPS
  fi
done
for PLATFORM_MOUNT in "${PLATFORM_PUSH_MOUNTS[@]}"; do
  if [ "$PLATFORM_MOUNT" == 'none' ]; then
    unset PLATFORM_PUSH_MOUNTS
  fi
done

# If there are no relationships specified then indicate that
if [ ${#PLATFORM_PUSH_RELATIONSHIPS[@]} -eq 0 ]; then
  lando_warn "Looks like you did not pass in any relationships!"
  lando_info "That is not a problem. However here is a list of available relationships you can try next time!"
  upsun_platform relationships --refresh || true
# Otherwise loop through our relationships and import them
else
  for PLATFORM_RELATIONSHIP in "${PLATFORM_PUSH_RELATIONSHIPS[@]}"; do
    # Try to split PLATFORM_RELATIONSHIP
    IFS=':' read -r -a PLATFORM_RELATIONSHIP_PARTS <<< "$PLATFORM_RELATIONSHIP"
    # Set the source and target
    PLATFORM_RELATIONSHIP_RELATIONSHIP="${PLATFORM_RELATIONSHIP_PARTS[0]}"
    PLATFORM_RELATIONSHIP_SCHEMA="${PLATFORM_RELATIONSHIP_PARTS[1]}"
    # If PLATFORM_RELATIONSHIP_SCHEMA is still empty lets set it to the default schema: usually main
    if [ -z "$PLATFORM_RELATIONSHIP_SCHEMA" ]; then
      eval "PLATFORM_RELATIONSHIP_SCHEMA=\$LANDO_CONNECT_${PLATFORM_RELATIONSHIP_RELATIONSHIP^^}_DEFAULT_SCHEMA"
    fi
    lando_pink "Exporting local data into the remote $PLATFORM_RELATIONSHIP_RELATIONSHIP relationship $PLATFORM_RELATIONSHIP_SCHEMA schema..."
    eval "LD=\$LANDO_DUMP_${PLATFORM_RELATIONSHIP_RELATIONSHIP^^}"
    $LD $PLATFORM_RELATIONSHIP_SCHEMA | upsun_platform db:sql -e "$PLATFORM_BRANCH" -r $PLATFORM_RELATIONSHIP_RELATIONSHIP --schema $PLATFORM_RELATIONSHIP_SCHEMA
  done
fi

# If there are no mounts specified then indicate that
if [ ${#PLATFORM_PUSH_MOUNTS[@]} -eq 0 ]; then
  lando_warn "Looks like you did not pass in any mounts!"
  lando_info "That is not a problem. However here is a list of available mounts you can try next time!"
  upsun_platform mounts --refresh || true
# Otherwise loop through our mounts and download them them
else
  for PLATFORM_MOUNT in "${PLATFORM_PUSH_MOUNTS[@]}"; do
    # Try to split PLATFORM_MOUNT
    IFS=':' read -r -a PLATFORM_MOUNT_PARTS <<< "$PLATFORM_MOUNT"
    # Set the source and target
    PLATFORM_MOUNT_SOURCE="${PLATFORM_MOUNT_PARTS[0]}"
    PLATFORM_MOUNT_TARGET="${PLATFORM_MOUNT_PARTS[1]}"
    # If PLATFORM_MOUNT_TARGET is still empty lets set it from the source
    if [ -z "$PLATFORM_MOUNT_TARGET" ]; then
      PLATFORM_MOUNT_TARGET="$PLATFORM_MOUNT_SOURCE"
    fi
    lando_pink "Uploading local files from $LANDO_SOURCE_DIR/$PLATFORM_MOUNT_SOURCE into the remote $PLATFORM_MOUNT_TARGET mount"
    upsun_platform mount:upload -e "$PLATFORM_BRANCH" --mount $PLATFORM_MOUNT_TARGET --source "$LANDO_SOURCE_DIR/$PLATFORM_MOUNT_SOURCE" -y
  done
fi

# Finish up!
lando_green "Push completed successfully!"
