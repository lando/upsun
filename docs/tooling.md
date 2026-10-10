---
title: Tooling
description: Commands the Upsun recipe adds to your project.
---

# Tooling

Commands are generated from your Upsun configuration. Language, framework,
CLI, cron, operation, Xdebug and sync commands run in the app
container with `.environment` sourced. Relationship shells run in the related
service container. Run `lando` to list them.

In a multi-app project, every app gets its own commands. Run a command from
inside an app's `source.root` to target that app; anywhere else targets the
closest app (or `config.app`). See
[Multi-app projects](./config.md#multi-app-projects).

In another app's directory (not the project root or the default app's directory),
Lando uses that app's cached tooling. After adding or changing a Landofile command
that shares a name with generated tooling, run `lando --clear` (or `lando start` /
`lando rebuild`) before using it from there. At the project root and in the default
app's directory, fresh Landofile tooling applies without refreshing the router.

Generated commands are cached by Lando. After upgrading the plugin, run
`lando --clear` if a command seems to be missing or behaving like the old
version.

## Authentication

| Command | Meaning |
|---|---|
| `lando auth upsun` | Connect an Upsun account and save its API token for this app without starting containers or syncing data. Flex and Fixed only. |

See [Authentication](./sync.md#authentication) for saved accounts, browser login
and pasting an API token.

## Upsun CLI

```bash
lando upsun environment:list      # Flex
lando platform environment:list   # Fixed
```

The CLI is installed in the app container during `lando build`. It is
authenticated with the app's saved account from `lando auth upsun`, pull, push or switch
when that token is still cached; otherwise it uses the first cached token. It
runs with `PLATFORM_RELATIONSHIPS` unset so it never mistakes Lando for Upsun.

## Language tooling

| Runtime | Commands |
|---|---|
| php | `lando php`, `lando composer` |
| nodejs | `lando node`, `lando npm`, `lando yarn` |
| python | `lando python`, `lando pip` |
| ruby | `lando ruby`, `lando bundle` |
| golang | `lando go` |

## Framework tooling

`lando drush` is added when `drush/drush` is in your `composer.json` or
`composer.lock`.

## Relationship shells

Each database relationship gets a command named after it:

```bash
lando database -e "select 1"    # mariadb / mysql
lando database -c "select 1"    # postgresql (psql)
lando redis ping
lando mongodb                   # mongosh
lando cache                     # valkey-cli for a Valkey relationship
```

## Database import and export

Projects with a MariaDB, MySQL or PostgreSQL service get the standard Lando
helpers:

```bash
lando db-import dump.sql.gz
lando db-import dump.sql --no-wipe     # keep existing tables
lando db-export                        # <database>.<timestamp>.sql.gz in the current directory
lando db-export --stdout > dump.sql
lando db-export -h reports             # another database service
```

| Option | Meaning |
|---|---|
| `-h`, `--host` | Database service to use. Defaults to the service behind the closest app's first SQL relationship, or the first SQL service. |
| `--no-wipe` | Import without dropping the existing database first. |
| `--stdout` | Export to stdout instead of a file. |

Both commands work on the service's default database: the first schema the
default endpoint has privileges on, or `main`.

## Operations

```bash
lando operation <name>
```

Runs `operations.<name>.commands.start` once from the app directory with
`.environment` sourced.

## Xdebug

PHP apps get toggles that apply to web requests and `lando php` alike:

```bash
lando xdebug-on          # mode defaults to debug
lando xdebug-on develop,debug
lando xdebug-off
```

`xdebug-on` loads the extension if needed, writes the mode to
`/usr/local/etc/php/conf.d/zzz-upsun-xdebug.ini` and reloads PHP-FPM;
`xdebug-off` sets the mode to `off` the same way. The container keeps the
toggle until `lando rebuild`, which restores the starting mode. On legacy
Xdebug 2 images, `xdebug-off` unloads the extension because mode settings are unsupported. See
[Debugging with Xdebug](./guides/xdebug.md) for IDE setup.

## Crons

```bash
lando cron <name>
```

Runs `crons.<name>.commands.start` once, from the app directory, with
`.environment` sourced. With `config.crons: true`, the same jobs are also
scheduled by Supercronic in the `<app>--cron` sidecar.

## Sync

`lando pull`, `lando push` and `lando switch [environment]` are documented in [Syncing](./sync.md).

Adobe Commerce Cloud projects get `pull`, `push` and `switch` commands that only
print a message and exit 1. Use the `magento-cloud` CLI for those workflows.

## SSH

`lando ssh` drops you into the closest app container with `.environment`
sourced, like `upsun ssh`. Use `-s db` for a service.

## Adding more

Extend `tooling:` in your Landofile as with any recipe. See
[Adding more tooling](./guides/adding-more-tooling.md).
