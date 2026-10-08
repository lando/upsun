---
title: Lifecycle
description: What happens when an Upsun project starts under Lando.
---

# Lifecycle

1. **Load.** The recipe detects the flavor, reads `.upsun/*.yaml` or
   `.platform*`, and normalizes it into one model.
2. **Map.** Each application and service is mapped to a Lando service; routes
   become proxy entries; tooling is generated for every app. The closest app's
   generated commands plus recipe options go into `<app>.recipe.cache`, without
   Landofile tooling. The per-directory router has empty root and closest-app
   entries, so fresh Landofile commands win there. Other apps get generated commands
   minus user-owned names, with `false` only for missing closest-app commands the
   user does not own. Duplicate paths favor the empty root/closest entries.
   At `post-init` 4 the selected route is shallow-merged and non-object commands are
   removed, even for empty routes, before core builds tasks at 5. At 9 the router is
   double-JSON cached in `<app>.tooling.router` for core's warm path. After adding or
   changing a colliding Landofile command, run `lando --clear`, `lando start` or
   `lando rebuild` before using it from another app's directory.
3. **Build** (first start and `lando rebuild`).
   - PHP root steps: install `jq`, configure requested extensions, link a root
     `php.ini`, install a secondary Node.js runtime when declared, configure
     Mailpit sendmail, then install the `upsun` or `platform` CLI.
   - Other runtimes: install MariaDB/PostgreSQL clients, `jq`, `rsync` and an SSH
     client, then install the CLI.
   - As the app user: install declared dependencies, run the build flavor
     (`composer install` / `npm install`), then `hooks.build` with `.environment`
     sourced; before sourcing, Lando's `/app/vendor/bin` and `/app/bin` (and their
     app-directory equivalents) are removed from PATH so the image's Composer
     and tools are used, like an Upsun build. `config.build` follows for the closest app.
4. **Start.** Non-PHP apps and workers use `/helpers/upsun-start.sh`. It waits for
   database provisioning when asked (below), runs the web application's `pre_start`, then replaces itself with
   `PLATFORM_APP_COMMAND`. Workers run only their own start command, or idle if
   none is defined. Static apps idle while nginx serves their files and file fallbacks.
5. **Every start.** At Lando `post-start` priority 101, the plugin runs commands
   in this order: mounts → database initialization → provisioned
   marker → PHP `pre_start` → `post_start` → `hooks.deploy` →
   `hooks.post_deploy`. Database initialization creates configured schemas and
   endpoint users before any hook runs. Replica users and grants run on the
   primary after primary initialization, even when the replica is declared first.

## Sign in without starting

`lando auth upsun` prompts for an account and initializes the app, but its empty
command list starts no containers and runs no environment operations. The
`post-auth` event validates and saves the token for the app's vendor, updates
`<app>.meta.cache` and prints the connected email. Rejected tokens are removed;
network errors and outages leave saved accounts intact.

CLI tooling prefers the app's saved token while it remains cached,
including accounts saved by `post-pull`, `post-push` and `post-switch`, and
`lando pull`/`push`/`switch` default `--auth` to it instead of prompting.
Whenever a token is saved or a rejected one is removed, the `<app>.recipe.cache`
and `<app>.tooling.router` caches are dropped so the next command is rebuilt
with the current account.

## Provisioning wait

Only the closest non-PHP application with local SQL initialization gets `UPSUN_PROVISION_WAIT=300`.
Its start wrapper waits for `UPSUN_PROVISIONED_FILE`
(`/dev/shm/upsun-provisioned`), which the every-start runner touches once
database initialization finishes. After 300 seconds it prints a warning and
starts anyway. PHP apps, workers and cron sidecars do not wait.

## Failures

If any every-start command fails, Lando finishes starting, prints a warning
that names the failed step, and `lando start` exits nonzero. Fix the cause and
run `lando restart`.

Lando's `run_*` steps are lock-gated and run once per rebuild. The separate
`post-start` runner is why mounts, database setup and deploy hooks
run again after every `lando start` or `lando restart`.

With `config.crons: true`, `<app>--cron` installs Supercronic and schedules the
configured `crons` entries. `lando cron <name>` remains available either way.

Details of the model, environment and mapping contracts are in
[Architecture](./architecture.md).
