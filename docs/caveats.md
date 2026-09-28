---
title: Caveats
description: Where local differs from Upsun.
---

# Caveats

## Not Upsun's images

Upsun's production images are not publicly published (the old
`docker.registry.platform.sh` registry froze in 2024 and is amd64-only), so
services run on Lando's own images. Consequences:

- PHP extensions and system packages differ from production. Requested PHP
  extensions use `install-php-extensions`; `blackfire`, `newrelic`,
  `sourceguardian` and `ioncube` are skipped with a warning.
- `size`, `disk`, `resources` and `container_profile` are ignored.
- MariaDB and PostgreSQL endpoint users are created with password `upsun` on
  every start. The endpoint name is the username; the default is `upsun`.

### Plugin versions

Install the Lando service plugins your project uses. They are optional peer
dependencies: a Node.js-only project doesn't need the PHP plugin.

<a id="plugin-missing"></a>

- `plugin-missing`: a required plugin isn't installed. The built-in version list
  lets mapping continue, but it doesn't install the plugin needed to start the service.

<a id="plugin-outdated"></a>

- `plugin-outdated`: an installed plugin's version list lacks the newest entry in
  this recipe's built-in list. Some requested versions may fall back.

Install or update the plugin named in the warning, for example:

```bash
lando plugin-add @lando/php
```

Only plugins used by your mapped local apps and services are checked. Tethered
projects still check app runtimes, but skip remote services.

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
- `java`, `dotnet`, `elixir`, `rust`, `lisp` apps and `vault-kms` services are
  not created.
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

## Tethering

Tethering adds remote latency and depends on the remote environment being
available. No local relationship services or local database copies are created,
and `lando pull` skips databases. Remote workers are not connected; the tether
uses the selected application's relationship payload.

## `PLATFORM_RELATIONSHIPS` and the CLI

The Upsun CLI treats a set `PLATFORM_RELATIONSHIPS` as "running on Upsun".
`lando upsun`, `lando pull` and `lando push` unset it; if you call the CLI from
your own scripts inside the container, do the same.

## Apple Silicon and arm64

Every compose-only service image this plugin maps was verified to publish both
`linux/amd64` and `linux/arm64` builds via registry manifests on September 27, 2026.
The tags below, including the init image, support both architectures; this does
not guarantee that every Upsun version has a matching image tag.

| Image | Verified tags | arm64 |
|---|---|---|
| `opensearchproject/opensearch` | `2`, `2.19.0`, `latest` | Yes |
| `valkey/valkey` | `8.0`, `latest` | Yes |
| `rabbitmq` | `3.13-management`, `4.1-management`, `management` | Yes |
| `apache/kafka` | `3.9.1`, `4.0.0`, `latest` | Yes |
| `influxdb` | `2.7`, `latest` | Yes |
| `chromedp/headless-shell` | `132.0.6834.83`, `latest` | Yes |
| `gotenberg/gotenberg` | `8`, `latest` | Yes |
| `clickhouse/clickhouse-server` | `25.1`, `latest` | Yes |
| `dunglas/mercure` | `latest` | Yes |
| `chromadb/chroma` | `0.6.3`, `latest` | Yes |
| `qdrant/qdrant` | `v1.12.0`, `latest` | Yes |
| `node` (init) | `20-bookworm` | Yes |

**Installers.** The Supercronic, Upsun/Platform CLI and Node.js installers select
arm64 artifacts via `uname -m`, accepting both `aarch64` and `arm64`. PHP extensions
delegate to `install-php-extensions` inside the image.

### Version tags

Upsun versions such as `kafka:4.0`, `opensearch:2.19`, `clickhouse:25`, `chroma:0.6`,
`qdrant:1.12` and `chrome-headless:132` may not have matching Docker Hub tags:
some images publish major-only or full patch tags instead. If `lando start`
fails with a `manifest unknown` pull error, pin a published image tag in your
Landofile using [`config.overrides`](./config.md#overrides), at
`config.overrides.<service-name>.services.image` (for example, `apache/kafka:4.0.0`
for your Kafka service), then run `lando rebuild`.
