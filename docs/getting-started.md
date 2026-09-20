---
title: Getting Started
description: Start an Upsun project locally with Lando.
---

# Getting Started

## From an existing checkout

Add a Landofile next to your `.upsun/` (Flex) or `.platform/` (Fixed) directory:

```yaml
name: my-project
recipe: upsun
config:
  id: PROJECT_ID   # optional, enables lando pull/push without --project
```

```bash
lando start
```

## From Upsun

`lando init` clones the project with the Upsun CLI and writes the Landofile
for you:

```bash
# Flex
lando init --source upsun --upsun-auth API_TOKEN --upsun-site my-project

# Fixed
lando init --source platformsh --upsun-auth API_TOKEN --upsun-site my-project
```

Omit the flags to be prompted. Create an API token in the Upsun Console under
*My profile → API tokens*.

## Pull data

```bash
lando pull
```

You are asked which database relationships and mounts to import. See
[Syncing](./sync.md).

## What you get

Given this `.upsun/config.yaml`:

```yaml
applications:
  app:
    type: php:8.3
    relationships:
      database: "db:mysql"
      redis:
    web:
      locations:
        "/":
          root: web
          passthru: /index.php
services:
  db:
    type: mariadb:11.4
  redis:
    type: redis:7.2
routes:
  "https://{default}/":
    type: upstream
    upstream: "app:http"
```

`lando start` creates `app` (PHP 8.3 + nginx), `db` (MariaDB 11.4) and `redis`
(Redis 7.2), serves `https://app.lndo.site`, and the app sees:

```bash
$ lando exec app -- env | grep -E '^(PLATFORM_APPLICATION_NAME|DATABASE_URL|REDIS_URL)='
DATABASE_URL=mysql://upsun:upsun@db:3306/main
PLATFORM_APPLICATION_NAME=app
REDIS_URL=redis://redis:6379
```

Tooling is generated from the config: `lando php`, `lando composer`,
`lando database` (MariaDB shell), `lando redis`, `lando upsun`, `lando pull`,
`lando push`. See [Tooling](./tooling.md).

## Drupal

The [Upsun Drupal scaffold](https://github.com/upsun/drupal-scaffold) works
out of the box: `composer install` runs as the build flavor, `.environment`
provides `drush` and `DRUSH_OPTIONS_URI`, `settings.platformsh.php` reads
`PLATFORM_RELATIONSHIPS` for the database and Redis, and the deploy hook runs
`drush updatedb` / `config-import` on every start.

```bash
lando start
lando drush site:install -y
lando drush uli
```
