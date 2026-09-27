---
title: Lifecycle
description: What happens when an Upsun project starts under Lando.
---

# Lifecycle

1. **Load.** The recipe detects the flavor, reads `.upsun/*.yaml` or
   `.platform*`, and normalizes it into one model.
2. **Map.** Each application and service is mapped to a Lando service; routes
   become proxy entries; tooling is generated.
3. **Build** (first start and `lando rebuild`).
   - PHP root steps: install `jq`, configure requested extensions, link a root
     `php.ini`, install a secondary Node.js runtime when declared, configure
     Mailpit sendmail, then install the `upsun` or `platform` CLI.
   - Other runtimes: install MariaDB/PostgreSQL clients, `jq`, `rsync` and an SSH
     client, then install the CLI.
   - As the app user: install declared dependencies, run the build flavor
     (`composer install` / `npm install`), then `hooks.build` with `.environment`
     sourced. `config.build` follows for the closest app.
4. **Start.** Non-PHP apps and workers use `/helpers/upsun-start.sh`. It waits up
   to 120 seconds for a requested tether, waits for database provisioning when
   asked (below), runs `pre_start`, then replaces itself with
   `PLATFORM_APP_COMMAND`. Static apps idle while nginx serves their files.
5. **Every start.** At Lando `post-start` priority 101, the plugin runs commands
   in this order: mounts → database initialization (or tether) → provisioned
   marker → PHP `pre_start` → `post_start` → `hooks.deploy` →
   `hooks.post_deploy`. Database initialization creates configured schemas and
   endpoint users before any hook runs.

## Provisioning wait

A non-PHP app with a local SQL relationship gets `UPSUN_PROVISION_WAIT=300`.
Its start wrapper waits for `UPSUN_PROVISIONED_FILE`
(`/dev/shm/upsun-provisioned`), which the every-start runner touches once
database initialization finishes. After 300 seconds it prints a warning and
starts anyway. PHP apps, workers, cron sidecars and tethered apps do not wait.

## Failures

If any every-start command fails, Lando finishes starting, prints a warning
that names the failed step, and `lando start` exits nonzero. Fix the cause and
run `lando restart`.

Lando's `run_*` steps are lock-gated and run once per rebuild. The separate
`post-start` runner is why mounts, database setup, deploy hooks and tether setup
run again after every `lando start` or `lando restart`.

With `config.crons: true`, `<app>--cron` installs Supercronic and schedules the
configured `crons` entries. `lando cron <name>` remains available either way.

Details of the model, environment and mapping contracts are in
[Architecture](./architecture.md).
