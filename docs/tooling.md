---
title: Tooling
description: Commands the Upsun recipe adds to your project.
---

# Tooling

Commands are generated from your Upsun configuration. Language, framework,
CLI, cron, operation, Xdebug, tether and sync commands run in the closest app
container with `.environment` sourced. Relationship shells run in the related
service container. Run `lando` to list them.

## Upsun CLI

```bash
lando upsun environment:list      # Flex
lando platform environment:list   # Fixed
```

The CLI is installed in the app container during `lando build`. It is
authenticated with the token cached by `lando init` or `lando pull --auth`, and
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
default endpoint has privileges on, or `main`. They are not generated while
tethered, because there is no local database.

## Operations

```bash
lando operation <name>
```

Runs `operations.<name>.commands.start` once from the app directory with
`.environment` sourced.

## Xdebug

PHP apps get runtime toggles for web requests:

```bash
lando xdebug-on          # mode defaults to debug
lando xdebug-on develop,debug
lando xdebug-off
```

The command reloads PHP-FPM. CLI PHP keeps the `XDEBUG_MODE` value from the
Landofile/container environment.

## Tethering

Tethered apps add:

```bash
lando tether
lando tether --info
lando tether --close
```

See [Tethering](./tether.md).

## Crons

```bash
lando cron <name>
```

Runs `crons.<name>.commands.start` once, from the app directory, with
`.environment` sourced. With `config.crons: true`, the same jobs are also
scheduled by Supercronic in the `<app>--cron` sidecar.

## Sync

`lando pull` and `lando push` are documented in [Syncing](./sync.md).

Adobe Commerce Cloud projects get `pull`, `push` and `tether` commands that only
print a message and exit 1. Use the `magento-cloud` CLI for those workflows.

## SSH

`lando ssh` drops you into the closest app container with `.environment`
sourced, like `upsun ssh`. Use `-s db` for a service.

## Adding more

Extend `tooling:` in your Landofile as with any recipe. See
[Adding more tooling](./guides/adding-more-tooling.md).
