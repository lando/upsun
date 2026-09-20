---
title: Tooling
description: Commands the Upsun recipe adds to your project.
---

# Tooling

All commands are generated from your Upsun configuration and run inside the
closest app container with the Upsun environment set, including your
`.environment` file (so things like `DRUSH_OPTIONS_URI` and `PATH` additions
work like they do in an Upsun SSH session). Run `lando` to list them.

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
```

## Crons

```bash
lando cron <name>
```

Runs `crons.<name>.commands.start` once, from the app directory, with
`.environment` sourced. Crons are never scheduled automatically.

## Sync

`lando pull` and `lando push` are documented in [Syncing](./sync.md).

## SSH

`lando ssh` drops you into the closest app container with `.environment`
sourced, like `upsun ssh`. Use `-s db` for a service.

## Adding more

Extend `tooling:` in your Landofile as with any recipe. See
[Adding more tooling](./guides/adding-more-tooling.md).
