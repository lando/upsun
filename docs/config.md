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
  xdebug: null      # Xdebug mode for PHP apps; null follows runtime.xdebug.idekey
  build: []         # extra build steps on the closest app
  run: []           # extra run steps on the closest app; once per rebuild
  overrides: {}     # merged into the raw Upsun app/service config before mapping
  variables: {}     # legacy per-app Upsun variables, merged before overrides
  mail: true        # add Mailpit unless the project defines a mailpit service
  crons: false      # schedule crons in <app>--cron when true
  domains: []       # project domains that `{all}` routes should also answer on
```

## How configuration is read

**Flex.** First-level YAML files in `.upsun/` are merged on `applications`,
`services` and `routes`. `.upsun/local/` is not part of the application model.

**Fixed.** The loader reads `.platform.app.yaml`,
`.platform/applications.yaml`, per-app `.platform.app.yaml` files, and
`.platform/services.yaml` / `.platform/routes.yaml`. `!include` and `!archive`
are supported.

A repository containing both formats is an error.

**Adobe Commerce Cloud.** A project with `.magento.app.yaml`,
`.magento/services.yaml` and `.magento/routes.yaml` loads as a Fixed layout.
See [Adobe Commerce Cloud](#adobe-commerce-cloud).

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
| `runtime.extensions`, `runtime.disabled_extensions` | Installs or disables PHP extensions during rebuild. Extensions the Lando image ships but leaves off, such as `xdebug`, are enabled rather than reinstalled. |
| `runtime.xdebug.idekey` | Loads Xdebug with that IDE key. See [Debugging with Xdebug](./guides/xdebug.md). |
| `dependencies.nodejs` | Installs global npm packages; PHP apps also get Node.js. |
| `dependencies.php` | Installs global Composer packages; `composer/composer` preserves exact versions or selects a major. |
| `dependencies.python`, `python2`, `python3` | Installs user-level pip packages on Python apps; other runtimes warn and skip them. |
| `dependencies.ruby` | Installs gems. |
| `variables.php` | Generates a PHP ini fragment. Nested keys use dot notation; `xdebug.*` keys apply too. |
| `<source.root>/php.ini` | Linked to `/usr/local/etc/php/conf.d/zzz-upsun-app.ini` when present. |
| `build.flavor` | PHP defaults to the Upsun composer flavor; Node.js defaults to `npm install`; `none` skips the flavor step. |

`.environment` is sourced before hooks, crons, operations and generated tooling.

Location `rules` apply only inside their parent `web.locations` prefix and inherit
its root. Headers and `allow`/`scripts` settings also inherit unless the rule overrides them.
`web.locations` values are validated before rendering; location `root` must stay inside the application directory.

### Build flavor

PHP apps with a `composer.json` run the same command Upsun does:

```bash
composer --no-ansi --no-interaction install --no-progress --prefer-dist --optimize-autoloader
```

Set `build.flavor: none` and put your own install command in `hooks.build` when
you need different flags.

### Relationships to other applications

A relationship whose target is another application in the same project
resolves to that app's local HTTP service: `app_nginx:80` for PHP apps and apps
with `web.locations`, otherwise `<app>:8888`. The payload uses `rel: http`,
`scheme: http` and a null `path`, with no credentials.

`<rel>.internal` hostnames are not emulated. Use the `<REL>_HOST` and
`<REL>_PORT` variables or the `PLATFORM_RELATIONSHIPS` payload instead.

A relationship pointing at a name that is neither a service nor an application
is skipped with a `relationship-unresolved` warning; the app still starts.

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

Every application becomes a Lando service, and every app gets its own set of
generated commands (`lando php`, `lando composer`, `lando pull`, relationship
shells, and so on). Which set you get depends on where you run the command:

- Inside an app's `source.root`, commands target that app.
- Anywhere else in the project (including the Landofile directory when no app
  lives there), commands target the closest app: the one whose `source.root`
  contains the Landofile, the longest match winning. When no root matches, the
  first app in configuration order is used.
- `config.app` pins the closest app explicitly and must name a configured app.

Commands you define under `tooling:` in the Landofile are never rerouted. The
closest app is also the default for `lando ssh`. The generated
`db-import`/`db-export` defaults follow the app selected by the tooling route.

## Services

See the [supported service table](./index.md#supported-services). MariaDB,
MySQL and PostgreSQL schemas and endpoint users are provisioned idempotently on
every start before deploy hooks run.

| Database setup | Local value |
|---|---|
| default schema/database | `main` |
| default endpoint username | `upsun` |
| configured endpoint username | the endpoint name |
| replica endpoint username | `<replica>_<endpoint>` (default endpoint: `mysql` or `postgresql`) |
| MariaDB/MySQL password | `upsun` |
| PostgreSQL password | `upsun` |

`configuration.schemas` selects the databases to create. Endpoint names and
their `admin`, `rw` or `ro` privileges create users and grants.
`default_schema` / `default_database` selects the connection path reported to
that endpoint's relationship.

Replica services create no databases or containers. They use a read-only user on
the primary named by `relationships.primary`: MariaDB grants its `ro` privilege set;
PostgreSQL sets `default_transaction_read_only` and inherits primary endpoint
roles. Their local usernames differ from Upsun's to avoid primary user collisions.

Privilege changes apply on restart. PostgreSQL `rw` grants DML, not schema creation;
`ro` can read tables and sequences. Only the synthetic default endpoint of a
PostgreSQL service without configured endpoints is created as a superuser.

<a id="replica-primary-invalid"></a>

`replica-primary-invalid` means the primary is missing, unknown or the wrong
engine. Fix `relationships.primary`; Lando skips that replica until it resolves.

<a id="replica-version-mismatch"></a>

`replica-version-mismatch` means the replica and primary versions differ. Lando
still maps it locally, but Upsun requires matching versions for replication.

An endpoint without `default_schema` / `default_database` gets a null `path`,
as on Upsun: `<REL>_URL` has no database suffix, `<REL>_PATH` is not set, and a
`relationship-path-null` warning is emitted. The database container's own
default database is the first schema that endpoint has privileges on, or
`main`. Pass the database name explicitly in that case.

`mercure` uses its official image with local publisher/subscriber keys, and
Valkey relationships get a `valkey-cli` shell.

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

Wildcard routes such as `https://*.{default}/` match any subdomain, and exact
hosts like `www.{default}` still win over them, as on Upsun. After upgrading
the plugin, run `lando rebuild` once so existing apps pick up the ordering.

### Project domains

`{all}` covers only the Lando host by default. List your project's domains in
`config.domains` to answer on a local alias for each one:

```yaml
name: my-project
recipe: upsun
config:
  domains:
    - example.com
    - shop.example.org
```

Each domain becomes a label (lowercase, runs of anything other than `a-z0-9`
collapse to `-`) in front of the Lando host, so `https://{all}/` now serves
`my-project.lndo.site`, `example-com.my-project.lndo.site` and
`shop-example-org.my-project.lndo.site`. `PLATFORM_ROUTES` lists every expanded
URL and keeps the placeholder form in `original_url`.

Redirects expand alongside their targets: `https://www.{all}/` redirecting to
`https://{all}/` produces one paired redirect per host. `{default}` always
resolves to the Lando host, and when an expanded `{all}` URL collides with a
`{default}` route, the `{default}` route wins.

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

### `env_file` and `variables.env`

`variables.env` is promoted to plain container variables. Any key that also
appears in a Landofile `env_file` is left out of that promotion, so the value
from your env file wins:

```yaml
# .lando.yml
name: my-project
recipe: upsun
env_file:
  - .env.local
```

```yaml
# .upsun/config.yaml
applications:
  app:
    variables:
      env:
        APP_ENV: production
        APP_DEBUG: "0"
```

With `APP_ENV=dev` in `.env.local`, the container sees `APP_ENV=dev` and
`APP_DEBUG=0`. `PLATFORM_*` and relationship variables are always set by the
recipe. Unreadable env files are ignored.

## Adobe Commerce Cloud

A project with `.magento.app.yaml`, `.magento/services.yaml` and
`.magento/routes.yaml` is detected as a Fixed layout and mapped like any other
Fixed project. Mixing it with `.upsun/` or `.platform*` files is an error.

- Every `PLATFORM_*` variable is mirrored as `MAGENTO_CLOUD_*`
  (`MAGENTO_CLOUD_RELATIONSHIPS`, `MAGENTO_CLOUD_ROUTES`, and so on).
- `lando pull`, `lando push` and `lando switch` are not available; they exit 1
  and point you at the `magento-cloud` CLI.
- `.magento.env.yaml` is not read. Manage those settings in your app.

## Overrides

`config.overrides` is keyed by Upsun application or service name and is merged
into that raw Upsun configuration **before** it is turned into Lando services.
Use it to change what the recipe reads without editing `.upsun/` or
`.platform*`, for example to bump a runtime version, add a local-only PHP
extension or set a local-only PHP ini value:

```yaml
config:
  overrides:
    app:
      type: "php:8.4"
      runtime:
        extensions: [imagick]
      variables:
        php:
          xdebug.client_port: 9004
    db:
      type: "mariadb:11.4"
```

Keys that don't match an existing application or service are ignored. Objects
deep-merge; arrays merge by index, so an override list replaces entries at the
same positions rather than appending.

`config.variables` is the legacy shorthand for `overrides.<app>.variables`.
It's applied first, then `overrides`, so an override wins when both set a key.

To change the generated **Lando** service instead (ports, image, compose
overrides), use the top-level `services:` block, which is merged over the
generated definition like in any recipe:

```yaml
services:
  db:
    portforward: 3307
```

## Warnings

### composable-runtime-picked

A composable application declares a secondary runtime that cannot be emulated.
This warning is emitted only when a runtime is ignored; Node.js beside a PHP
primary is installed instead.

### dependency-runtime-missing

`dependencies.python` is declared on an app whose local image has no Python,
so those packages are skipped.

### php-extension-unsupported

`blackfire`, `newrelic`, `sourceguardian` and `ioncube` cannot be installed by
the local extension helper and are skipped.

### relationship-path-null

A database endpoint has no `default_schema` / `default_database`, so its
relationship reports a null path and no `<REL>_PATH` variable.

### relationship-unknown-service

A relationship points at a service that is not defined.

### relationship-unresolved

A relationship points at a name that has no local service or application. The
relationship is skipped.

### runtime-unsupported

The application runtime has no bundled Lando service plugin.

### service-config-ignored

A Redis or Valkey `configuration` key other than persistence (for example
`maxmemory_policy`) is not applied locally.

### service-unsupported

The service type has no local mapping, so no container is created.

### solr-cores-collapsed

The Solr service defines more than one core or endpoint; only the first core is
created locally.

### version-fallback

The exact version is unavailable; the nearest lower version in the same major
is used.

### version-unsupported

No version in that major is available; the newest installed-plugin version is
used.

### varnish-vcl-ignored

The Varnish `configuration.vcl` value is in a form the local service cannot
apply.

### web-upstream-unsupported

A PHP app declares `web.commands.start`, or a non-PHP app uses a Unix socket
upstream. Locally PHP runs under PHP-FPM and other runtimes are reached over TCP.

### recipe-deprecated-alias

The legacy recipe identifier was detected. New Landofiles must use
`recipe: upsun`.
