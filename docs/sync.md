---
title: Syncing
description: Pull databases and mounts from Upsun, or push them back.
---

# Syncing

`lando pull` and `lando push` use the Upsun CLI inside the app container to
move databases and mounts between your local app and a remote environment.

## Authentication

The commands use a cached API token or one passed with `--auth`; an explicitly
passed token is validated and cached for next time.
The `--auth` picker also offers the token saved on disk in your `upsun` or `platform`
CLI's default session, labeled `upsun CLI token` or `platform CLI token`.
If validation rejects a selected cached token, Lando removes it from its token and
app authentication caches and warns you to run the command again with a new token.

| Flavor | CLI | Token variable |
|---|---|---|
| Flex | `upsun` | `UPSUN_CLI_TOKEN` |
| Fixed | `platform` | `PLATFORMSH_CLI_TOKEN` |

## Pull

```bash
lando pull
lando pull -r database -m /web/files
lando pull -r none -m none --env staging
```

| Option | Meaning |
|---|---|
| `-r`, `--relationship` | Database relationship to import (repeatable). `none` skips databases. |
| `-m`, `--mount` | Mount to download (repeatable). `none` skips mounts. |
| `-e`, `--env` | Remote environment. Defaults to your git branch. |
| `-p`, `--project` | Remote project. Defaults to `config.id`. |
| `--auth` | API token. |
| `--no-parent` | Do not fall back to the parent environment. |
| `--all-mounts` | Pull every remote mount into `PLATFORM_APP_DIR`. Pull only. |
| `--skip-db` | Skip database sync. Equivalent to `-r none`. |
| `--skip-files` | Skip mount sync. Equivalent to `-m none`. |
| `-A`, `--app` | Remote Upsun application. Defaults to `PLATFORM_APPLICATION_NAME`. |

Each database is dumped with `db:dump --gzip`. The compressed dump is streamed
through `gunzip` into the local service the relationship points at, using the
`<RELATIONSHIP>_HOST` variables. Mounts are downloaded with `mount:download`
into the mount path under `/app`.

If the remote environment is paused it is resumed; if it is inactive it is
activated. If that fails and `--env` was not given, the parent environment is
used instead.

## Push

```bash
lando push -r database -m /web/files --env feature-x
```

The database, mount, environment, project, app and skip options also apply to
`push`; `--all-mounts` is pull-only. Push writes a plain SQL dump because it is
streamed to `db:sql`. Pushing to the production environment (type `production`,
or branch `main`/`master`) is refused without `--force`.

In tethered mode, both commands skip databases with a warning because those
relationships already point at Upsun. Mount sync still runs.

## Switch

```bash
lando switch feature-x -r database -m /web/files
lando switch feature-x --skip-db --skip-files
```

`lando switch <environment>` checks out the git branch for a remote environment,
then pulls its databases and mounts. **Pulling replaces your selected local data.**
The environment ID is required. Your `.lando.yml` is restored if the target
branch has none; an existing Landofile on that branch is left alone.

| Option | Meaning |
|---|---|
| `-r`, `--relationship` | Database relationship to import (repeatable). `none` skips databases. |
| `-m`, `--mount` | Mount to download (repeatable). `none` skips mounts. |
| `-p`, `--project` | Remote project. Defaults to `config.id`. |
| `--auth` | API token. |
| `-A`, `--app` | Remote Upsun application. Defaults to `PLATFORM_APPLICATION_NAME`. |
| `--skip-db` | Skip database sync. |
| `--skip-files` | Skip mount sync. Use both skip flags for checkout only. |
| `--no-parent` | Disable parent fallback (already disabled by the explicit environment). |

There is no `--env` or `--all-mounts` option for switch. In tethered mode,
databases are skipped, but mounts can still be pulled. Run `lando restart`
after switching so the tether reconnects to the selected environment.
Switch does not reconnect the tether itself.

Adobe Commerce Cloud projects cannot use `lando switch`; use the
`magento-cloud` CLI instead.

## Adobe Commerce Cloud

`lando pull`, `lando push` and `lando switch` are not available for `.magento.app.yaml`
projects. They exit 1 with a message; use the `magento-cloud` CLI to move data.
For a local dump, `lando db-import` and `lando db-export` still work. See
[Tooling](./tooling.md#database-import-and-export).
