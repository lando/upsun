---
title: Configuration
description: Configure the Lando Upsun recipe.
---

# Configuration

The recipe reads `.upsun/config.yaml` (Flex) or `.platform*` (Fixed) and turns
it into Lando services. Change Upsun configuration first, then run
`lando rebuild` when the service definitions change.

```yaml
name: my-project
recipe: upsun
config:
  id: null          # remote project ID; otherwise read from the local project file
  app: null         # closest application override for a multi-app project
  xdebug: false     # initial Xdebug setting for PHP services
  build: []         # extra build steps on the closest app
  run: []           # extra Lando run steps; lock-gated once per rebuild
  overrides: {}     # deep-merged onto generated Lando services
  mail: true        # add Mailpit unless the project defines a mailpit service
  crons: false      # schedule crons in <app>--cron when true
  tethered: false   # true for the git branch, or an environment ID string
```

## How configuration is read

**Flex.** First-level YAML files in `.upsun/` are merged on `applications`,
`services` and `routes`. `.upsun/local/` is not part of the application model.

**Fixed.** The loader reads `.platform.app.yaml`,
`.platform/applications.yaml`, per-app `.platform.app.yaml` files, and
`.platform/services.yaml` / `.platform/routes.yaml`. `!include` and `!archive`
are supported.

A repository containing both formats is an error.

## Applications

| Upsun key | Local behaviour |
|---|---|
| `type` | Maps PHP, Node.js, Python, Ruby and Go to their Lando service plugins. |
| `source.root` | Sets `PLATFORM_APP_DIR=/app/<root>` and the tooling directory. |
| `relationships` | Supports shorthand, object and `service:endpoint` forms. |
| `mounts` | Creates directories under `/app` on every start. No volumes are generated. |
| `web.commands.pre_start` | Runs before the app command in the non-PHP start wrapper; PHP runs it in the every-start sequence. |
| `web.commands.start` | Exposed as `PLATFORM_APP_COMMAND`; the non-PHP service gets `PORT=8888` and the wrapper executes the command. |
| `web.commands.post_start` | Runs on every start through the post-start runner. |
| `web.locations` | Renders nginx locations. Non-PHP apps get an nginx sidecar; apps without `web.commands.start` can be static sites. |
| `hooks.build` | Runs after dependency and build-flavor installation during rebuild. |
| `hooks.deploy`, `hooks.post_deploy` | Run on every start, after mounts and database initialization. |
| `crons` | Always available through `lando cron <name>`; `config.crons: true` also schedules them in `<app>--cron`. |
| `workers` | Adds `<app>--<worker>` services using `workers.<name>.commands.start`. |
| `operations` | Adds `lando operation <name>` for `operations.<name>.commands.start`. |
| `timezone` | Sets `TZ` on app, worker and cron containers. |
| `additional_hosts` | Adds each `host:ip` pair to app, worker and cron containers. |
| `runtime.extensions`, `runtime.disabled_extensions` | Installs or disables PHP extensions during rebuild. |
| `dependencies.nodejs` | Installs global npm packages. |
| `dependencies.php` | Installs global Composer packages; `composer/composer` selects Composer 2 when requested. |
| `dependencies.python`, `python2`, `python3` | Installs user-level pip packages. |
| `dependencies.ruby` | Installs gems. |
| `variables.php` | Generates a PHP ini fragment. Nested keys use dot notation. |
| `<source.root>/php.ini` | Linked to `/usr/local/etc/php/conf.d/zzz-upsun-app.ini` when present. |
| `build.flavor` | PHP defaults to `composer install`; Node.js defaults to `npm install`; `none` skips the flavor step. |

`.environment` is sourced before hooks, crons, operations and generated tooling.

### Composable applications

The first entry in `stack.runtimes` is the primary local runtime:

```yaml
applications:
  app:
    type: composable:26.05
    stack:
      runtimes:
        - "php@8.4":
            extensions: [redis, xsl]
            disabled_extensions: [imap]
        - "nodejs@22"
      packages: [jq]
```

PHP extension options merge into `runtime.extensions` and
`runtime.disabled_extensions`. A secondary Node.js runtime after PHP is
installed in the PHP container. Other secondary runtimes are ignored with a
`composable-runtime-picked` warning.

### Multi-app projects

Every application becomes a Lando service. Tooling targets the closest app,
based on the Landofile location and `source.root`, or the explicit `config.app`.

## Services

See the [supported service table](./index.md#supported-services). MariaDB,
MySQL and PostgreSQL schemas and endpoint users are provisioned idempotently on
every start before deploy hooks run.

| Database setup | Local value |
|---|---|
| default schema/database | `main` |
| default endpoint username | `upsun` |
| configured endpoint username | the endpoint name |
| MariaDB/MySQL password | `upsun` |
| PostgreSQL password | `upsun` |

`configuration.schemas` selects the databases to create. Endpoint names and
their `admin`, `rw` or `ro` privileges create users and grants.
`default_schema` / `default_database` selects the connection path reported to
that endpoint's relationship.

`mercure`, `chroma` and `qdrant` use their official images. Mercure gets local
publisher/subscriber keys, Qdrant exposes ports `6333` and `6334`, and Valkey
relationships get a `valkey-cli` shell.

### Mailpit

Mailpit is enabled by default as service `mailpit`. SMTP listens on port `25`,
apps receive `PLATFORM_SMTP_HOST=mailpit`, and the UI is available at
`mail.<name>.<domain>`. PHP's generated `sendmail_path` sends to `mailpit:25`.

Set `config.mail: false` to disable it. The generated service is also skipped
when the Upsun configuration already defines a service named `mailpit`.

## Routes

`{default}` and `{all}` resolve to the Landofile `name`, so a project named
`my-project` gets `my-project.lndo.site`; `www.{default}` becomes
`www.my-project.lndo.site`.

Redirect routes are Traefik redirect middlewares. They issue real permanent
301 responses, including `www.<name>.lndo.site` to the canonical route.
`redirects.paths` also creates redirects on an upstream route. `code: 302`
makes one temporary; `prefix`, `append_suffix` and `regexp` control matching and
replacement.

Requests carry `X-Client-IP`, `X-Original-Route` and, for HTTPS routes,
`X-Client-SSL`.

## Environment

Apps receive the `PLATFORM_*` runtime contract plus `NAME_HOST`, `NAME_PORT`,
`NAME_USERNAME`, `NAME_PASSWORD`, `NAME_PATH`, `NAME_SCHEME`, `NAME_URL` and
other fields for each relationship. Command fields set
`PLATFORM_PRE_APP_COMMAND`, `PLATFORM_APP_COMMAND` and
`PLATFORM_POST_APP_COMMAND`; `timezone` sets `TZ`.

`PLATFORM_PROJECT` uses `config.id`, then the ID from
`.upsun/local/project.yaml` or `.platform/local/project.yaml`, then `lando`.
`lando init --source cwd` writes the detected local ID into the generated
Landofile configuration.

Tethered apps start with `PLATFORM_RELATIONSHIPS=''`, no relationship-specific
variables, `UPSUN_TETHERED=1` and `UPSUN_TETHER_ENVIRONMENT=<environment>`.
See [Tethering](./tether.md).

## Overrides

`config.overrides` is deep-merged onto generated services:

```yaml
config:
  overrides:
    app:
      composer_version: 2
    db:
      portforward: 3307
```

## Warnings

### composable-runtime-picked

A composable application declares a secondary runtime that cannot be emulated.
This warning is emitted only when a runtime is ignored; Node.js beside a PHP
primary is installed instead.

### php-extension-unsupported

`blackfire`, `newrelic`, `sourceguardian` and `ioncube` cannot be installed by
the local extension helper and are skipped.

### relationship-unknown-service

A relationship points at a service that is not defined.

### runtime-unsupported

The application runtime has no bundled Lando service plugin.

### service-unsupported

The service type has no local mapping, so no container is created.

### version-fallback

The exact version is unavailable; the nearest lower version in the same major
is used.

### version-unsupported

No version in that major is available; the newest installed-plugin version is
used.

### varnish-vcl-ignored

The Varnish `configuration.vcl` value is in a form the local service cannot
apply.

### recipe-deprecated-alias

The legacy recipe identifier was detected. New Landofiles must use
`recipe: upsun`.
