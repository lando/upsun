---
title: Configuration
description: Configure the Lando Upsun recipe.
---

# Configuration

The recipe reads your Upsun configuration and turns it into Lando services,
so most changes belong in `.upsun/config.yaml` (Flex) or `.platform*` (Fixed),
followed by `lando rebuild`. The Landofile itself stays small:

```yaml
recipe: upsun
config:
  id: null          # Upsun project id; set by lando init
  app: null         # which application this Landofile belongs to (multi-app)
  xdebug: false     # enable Xdebug on PHP apps
  build: []         # extra build steps for the app container
  run: []           # extra run steps for the app container
  overrides: {}     # deep-merged onto the generated Lando services
```

`recipe: platformsh` still works as a deprecated alias.

## How configuration is read

**Flex.** Every first-level `*.yaml` / `*.yml` in `.upsun/` is loaded and merged
on the `applications`, `services` and `routes` keys. `.upsun/local/` is ignored.

**Fixed.** `.platform.app.yaml` at the root (single app), or
`.platform/applications.yaml`, or one `.platform.app.yaml` per app directory;
plus `.platform/services.yaml` and `.platform/routes.yaml`. `!include` and
`!archive` tags are supported.

A repository containing both `.upsun/` and `.platform/` is an error, as it is on
Upsun.

## Applications

| Upsun key | Local behaviour |
|---|---|
| `type` | Mapped to a Lando service; see [supported runtimes](./index.md#supported-runtimes). `composable:*` uses the primary runtime from `stack`. |
| `source.root` | Each app's Lando service runs with `PLATFORM_APP_DIR=/app/<root>`. |
| `relationships` | All three forms: `db:` (shorthand), `{service: db, endpoint: mysql}`, `"db:mysql"`. |
| `mounts` | Created as directories under `/app` on every start. `source: service` mounts share the network-storage volume. |
| `web.locations` | Rendered into the nginx vhost for PHP apps: `root`, `index`, `passthru`, `allow`, `scripts`, `expires`, `headers` and `rules`. The `/` location's `root` is the webroot. |
| `web.commands.start` | Used as the container command for non-PHP runtimes (`PORT=8888`). |
| `build.flavor` | `composer` (PHP default) runs `composer install`; `default` (Node default) runs `npm install`; `none` skips. |
| `hooks.build` | Runs as a build step in the app container, after the build flavor. |
| `hooks.deploy`, `hooks.post_deploy` | Run on every start, after mounts exist. |
| `crons` | Not scheduled. Run on demand with `lando cron <name>`. |
| `workers` | Extra services named `<app>--<worker>` running `commands.start`. |
| `variables.env.*` | Exported as top-level variables. Other groups are in `PLATFORM_VARIABLES`. |
| `dependencies.php.composer/composer` | Sets the Composer version. `dependencies.nodejs` are installed globally. |
| `size`, `disk`, `resources`, `container_profile` | Ignored. |

`.environment` in the app directory is sourced before hooks, crons and
tooling run.

### Multi-app projects

Every application becomes a Lando service. Tooling (`lando php`, `lando pull`,
...) targets the *closest* app: the one whose `source.root` contains the
Landofile, or `config.app` if set.

## Services

Every service becomes a Lando service with the same name; see
[supported services](./index.md#supported-services). Databases get fixed
credentials that are reported through the relationship:

| Type | user | password | database |
|---|---|---|---|
| `mariadb`, `mysql`, `oracle-mysql`, `mongodb` | `upsun` | `upsun` | `main` |
| `postgresql` | `postgres` | *(empty)* | `main` |

`configuration.schemas` / `configuration.endpoints` on MariaDB and PostgreSQL
select the database and endpoint name exposed on the relationship.

## Routes

`{default}` resolves to `<app>.lndo.site` (`www.{default}` to
`www.<app>.lndo.site`). Upstream routes are proxied to the app; redirect routes
are served directly by the upstream they point to. Requests carry
`X-Client-IP`, `X-Original-Route` and `X-Client-SSL` like Upsun's router.

## Environment

The app container receives the full `PLATFORM_*` set and, for every
relationship `name`, `NAME_HOST`, `NAME_PORT`, `NAME_USERNAME`,
`NAME_PASSWORD`, `NAME_PATH`, `NAME_SCHEME`, `NAME_URL` and friends. The full
list is in the [architecture notes](./architecture.md#environment-contract).

`PLATFORM_PROJECT` is `config.id` (or `lando`), `PLATFORM_BRANCH` is your git
branch, `PLATFORM_ENVIRONMENT_TYPE` is `development`, `PLATFORM_VENDOR` is
`upsun` (Flex) or `platformsh` (Fixed).

## Overrides

`config.overrides` is deep-merged onto the generated services, so you can add
anything a Lando service accepts:

```yaml
config:
  overrides:
    app:
      composer_version: 2
    db:
      portforward: 3307
```

## Warnings

Lando prints a warning when it cannot emulate something exactly.

### composable-runtime-picked

The app uses `type: composable:*` with several runtimes in `stack`. Only the
primary one (php, nodejs, python, ruby, golang, in that order) runs locally.

### relationship-unknown-service

A relationship points at a service that is not defined. The relationship is
kept but has no local target.

### runtime-unsupported

The app runtime has no Lando service (java, dotnet, elixir, rust, lisp). No
container is created for it.

### service-unsupported

The service type has no local equivalent (`vault-kms`). No container is
created for it.

### version-fallback

The exact version is not available locally; the nearest lower minor of the same
major is used.

### version-unsupported

No version of that major is available locally; the newest supported version is
used.

### redirect-route

A `redirect` route is served directly by its upstream app rather than
redirected. Lando's proxy cannot issue redirects.

### varnish-vcl-ignored

The Varnish `configuration.vcl` is in a form Lando cannot apply.

### recipe-deprecated-alias

`recipe: platformsh` is deprecated; use `recipe: upsun`.
