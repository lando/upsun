---
title: Getting Started
description: Start an Upsun project locally with Lando.
---

# Getting Started

## From an existing checkout

If your teammate's repo already has a Landofile with `recipe: upsun` (or
`platformsh`), run `lando auth upsun` to connect your account. You don't need
`lando init`; this only signs you in, without starting containers or pulling data.

Add a Landofile next to `.upsun/` (Flex), or next to `.platform.app.yaml` /
`.platform/` (Fixed):

```yaml
name: my-project
recipe: upsun
config:
  id: PROJECT_ID   # optional; otherwise read from .upsun/local/project.yaml
```

`lando pull`/`push`/`switch` need a project ID from `config.id` or the CLI's local project file; local `lando start` works without it.

```bash
lando start
```

## From Upsun

`lando init` clones the project with the Upsun CLI and writes the Landofile
for you:

```bash
# Flex
lando init --source upsun

# Fixed
lando init --source platformsh
```

Choose **Log in with your browser** (the default when no tokens are cached) to
create an API token named `Lando (<hostname>)`. Upsun only creates tokens
right after a login, so it may ask you to log in again even if you're already
signed in. Lando saves the token for next time;
you can revoke it in the Upsun Console under *My profile → API tokens*.
Press **Enter** during browser login to skip it and paste a token instead.
If login fails, Lando offers the paste prompt automatically.

Over SSH or in a remote shell, your browser can't reach Lando's local callback.
Skip browser login and paste a token from the Console instead.
For non-interactive init, pass `--upsun-auth API_TOKEN --upsun-site my-project`
with either source; `--upsun-auth` bypasses browser login and the token prompts.

If you run either command in a folder that already has the project's Upsun
config (`.upsun/`, `.platform.app.yaml` or `.magento.app.yaml`), Lando skips the
clone. It still asks for your account and project, saves the token and sets
`config.id` from the project you choose. If the folder is linked to a different
project in its local `project.yaml`, init stops instead.

To initialize an already-linked checkout without signing in, use the current
directory as the source:

```bash
lando init --source cwd
```

This reads `config.id` from `.upsun/local/project.yaml` (or
`.platform/local/project.yaml` for Fixed). Run `upsun project:set-remote` or
clone with `upsun get` first if that local project file does not exist.

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

`lando start` creates `app` (PHP 8.3 + nginx), `db` (MariaDB 11.4), `redis`
(Redis 7.2) and `mailpit`. It serves `https://my-project.lndo.site` and the
Mailpit UI at `http://mail.my-project.lndo.site`. The app sees:

```bash
$ lando exec app -- env | grep -E '^(PLATFORM_APPLICATION_NAME|DATABASE_URL|REDIS_URL)='
DATABASE_URL=mysql://upsun:upsun@db:3306/main
PLATFORM_APPLICATION_NAME=app
REDIS_URL=redis://redis:6379
```

PostgreSQL relationships use the same predictable credentials, for example
`pgsql://upsun:upsun@db:5432/main`.

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
