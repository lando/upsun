---
title: Syncing
description: Pull databases and mounts from Upsun, or push them back.
---

# Syncing

`lando pull` and `lando push` use the Upsun CLI inside the app container to
move databases and mounts between your local app and a remote environment.

## Authentication

The commands use the API token cached by `lando init`, or one passed with
`--auth`. A token passed explicitly is validated and cached for next time.

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
