---
title: Caveats
description: Where local differs from Upsun.
---

# Caveats

## Not Upsun's images

Upsun's production images are not publicly published (the old
`docker.registry.platform.sh` registry froze in 2024 and is amd64-only), so
services run on Lando's own images or upstream Docker Hub images. Compose-backed
images are pinned to the upstream versions Upsun ships, using the public
`upsun/meta` registry, when Docker Hub publishes a matching tag for both
`linux/amd64` and `linux/arm64`. If the exact tag is unavailable, the newest
compatible multi-arch patch tag in the same Upsun version line is used; without
a verified pin, the existing tag behavior stays unchanged. Consequences:

- PHP extensions and system packages differ from production. Requested PHP
  extensions use `install-php-extensions`; `blackfire`, `newrelic`,
  `sourceguardian` and `ioncube` are skipped with a warning.
- `size`, `disk`, `resources` and `container_profile` are ignored.
- MariaDB and PostgreSQL endpoint users are created with password `upsun` on
  every start. The endpoint name is the username; the default is `upsun`.
  Replica users instead use `<replica>_<endpoint>` to avoid primary user collisions.

### Plugin versions

Install the Lando service plugins your project uses. They are optional peer
dependencies: a Node.js-only project doesn't need the PHP plugin.

<a id="plugin-missing"></a>

- `plugin-missing`: a required plugin isn't installed. The built-in version list
  lets mapping continue, but it doesn't install the plugin needed to start the service.

<a id="plugin-outdated"></a>

- `plugin-outdated`: an installed plugin's version list lacks the newest entry in
  this recipe's built-in list. Some requested versions may fall back.

<a id="plugin-unreadable"></a>

- `plugin-unreadable`: a service plugin could not be loaded. Mapping uses the built-in version list; repair or update the plugin before starting the service.

Install or update the plugin named in the warning, for example:

```bash
lando plugin-add @lando/php
```

Only plugins used by your mapped local apps and services are checked.

### Upsun version lifecycle

<a id="upsun-version-deprecated"></a>

- `upsun-version-deprecated`: Upsun marks the requested app runtime or service
  version deprecated. Plan an upgrade to a supported version in your Upsun config.

<a id="upsun-version-retired"></a>

- `upsun-version-retired`: Upsun marks the requested version retired or
  decommissioned. Upgrade your Upsun config; running locally does not mean Upsun
  still supports it. The warning includes the upstream end-of-life date when known.

Lifecycle status comes from the bundled registry snapshot, not a runtime network
request. Unknown types and versions do not warn because the registry is beta.
Composable apps and replicas (their primary already warns) are skipped.

## Emulation limits

- Crons always run on demand with `lando cron <name>`. Set `config.crons: true`
  to schedule them in `<app>--cron`; jobs run as the container user.
- `workers` run as extra services from the same image.
- Relationships to other applications resolve to the target app's local Lando
  service (for example `app_nginx:80`). `<rel>.internal` hostnames are not
  emulated; read `<REL>_HOST` / `<REL>_PORT` or `PLATFORM_RELATIONSHIPS`.
- Database endpoints without `default_schema` / `default_database` report a
  null path and no `<REL>_PATH`, exactly as Upsun does.
- Redirect routes and `redirects.paths` are real Traefik redirects. Redirect
  routes are permanent 301s; a path can request 302.
- Composable images use the first declared runtime. A secondary Node.js runtime
  beside PHP is installed in the PHP container; other secondary runtimes warn.
- `java`, `dotnet`, `elixir` and `rust` apps and `vault-kms` services are not
  created.
- `mariadb-replica` and `postgresql-replica` (`postgres-replica` on Fixed) are
  read-only users on their primary, not separate containers. They see primary
  writes immediately, without Upsun's replication lag. MariaDB uses the `ro` grant set;
  PostgreSQL uses `default_transaction_read_only`, a session default rather than
  a real hot standby. Pull, push and switch skip or reject replica relationships; pull the primary instead.
- `lando pull` only imports SQL databases, not Valkey data.
- Versions Lando does not ship use the nearest lower version in the same major,
  or the newest supported version when that major is unavailable.

## Proxy

Lando's proxy needs ports `80` and `443`. If they are taken, URLs move to
fallback ports such as `:8888`/`:8443`, or the proxy fails to start; the
containers still work. Host-level app, redirect and Mailpit URLs carry the
fallback port when Lando moves the proxy.

## Lifecycle configuration

Lando lock-gates `config.run` steps, so they run once per rebuild. Put work that
must run on every start in `hooks.deploy` or `hooks.post_deploy`; the plugin runs
those through its `post-start` runner every time.

## `PLATFORM_RELATIONSHIPS` and the CLI

The Upsun CLI treats a set `PLATFORM_RELATIONSHIPS` as "running on Upsun".
`lando upsun`, `lando pull` and `lando push` unset it; if you call the CLI from
your own scripts inside the container, do the same.

## Apple Silicon and arm64

The registry generator verifies both `linux/amd64` and `linux/arm64` on Docker Hub
before saving a pin. Examples from the bundled snapshot are below; this does not
guarantee that every Upsun version has a matching image tag.

| Image | Verified tags | arm64 |
|---|---|---|
| `opensearchproject/opensearch` | `2.19.6`, `3.9.0` | Yes |
| `valkey/valkey` | `8.0.11`, `9.0.6` | Yes |
| `rabbitmq` | `4.3.6-management` | Yes |
| `apache/kafka` | `3.7.2`, `4.1.2`, `4.3.1` | Yes |
| `influxdb` | `2.3.0`, `2.7.12` | Yes |
| `chromedp/headless-shell` | No verified pin for Upsun `113` or `120` | Not verified |
| `gotenberg/gotenberg` | `8.37.0` | Yes |
| `clickhouse/clickhouse-server` | `26.8.15.10` | Yes |
| `dunglas/mercure` | `v0.24.2` | Yes |

**Installers.** The Supercronic, Upsun/Platform CLI and Node.js installers select
arm64 artifacts via `uname -m`, accepting both `aarch64` and `arm64`. PHP extensions
delegate to `install-php-extensions` inside the image.

### Version tags

Known registry versions use the saved pins automatically, including
`kafka:4.3` → `apache/kafka:4.3.1` and `mercure:0` → `dunglas/mercure:v0.24.2`.
Unpinned versions retain their old tags and may still lack a Docker Hub manifest.
InfluxDB 3 is not pinned because its `-core` images require a different entrypoint;
Chrome `113`/`120` and Kafka `3.6` have no verified matching multi-arch pin.
If `lando start` fails with a
`manifest unknown` pull error, pin a published image tag in your Landofile's
top-level [`services:` block](./config.md#overrides), at
`services.<service-name>.services.image` (for example, `apache/kafka:4.3.1`
for your Kafka service), then run `lando rebuild`.
