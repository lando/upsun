---
title: Upsun Lando Plugin
description: Run Upsun Flex and Upsun Fixed projects locally with Lando.
next: ./getting-started.html
---

# Upsun

This plugin runs [Upsun](https://upsun.com/) projects locally. It reads your
Upsun configuration, builds the equivalent Lando services, and gives the app
container the same runtime contract it gets on Upsun:

- `PLATFORM_*` variables (`PLATFORM_RELATIONSHIPS`, `PLATFORM_ROUTES`,
  `PLATFORM_APPLICATION`, `PLATFORM_VARIABLES`, ...)
- per-relationship service variables (`DATABASE_HOST`, `DATABASE_URL`, ...)
- `build`, `deploy` and `post_deploy` hooks, mounts, `.environment`
- the `upsun` CLI inside the container, `lando pull` and `lando push`

Both Upsun configuration flavors are supported:

| Flavor | Config | CLI |
|---|---|---|
| **Upsun Flex** | `.upsun/config.yaml` | `upsun` |
| **Upsun Fixed** (formerly Platform.sh) | `.platform.app.yaml` + `.platform/` | `platform` |

```yaml
name: my-project
recipe: upsun
```

Services run on Lando's own service plugins (PHP, MariaDB, PostgreSQL, Redis,
...) rather than Upsun's production images, so current versions and ARM hosts
work. See [Caveats](./caveats.md) for what that means.

## Supported runtimes

| Upsun `type` | Lando service |
|---|---|
| `php` | `php` (nginx) |
| `nodejs` | `node` |
| `python` | `python` |
| `ruby` | `ruby` |
| `golang` | `go` |
| `composable` | the primary runtime in the `stack` (php, nodejs, python, ruby, golang) |

`java`, `dotnet`, `elixir`, `rust` and `lisp` are not supported and produce a warning.

## Supported services

| Upsun `type` | Lando service |
|---|---|
| `mariadb`, `mysql` | `mariadb` |
| `oracle-mysql` | `mysql` |
| `postgresql` | `postgres` |
| `redis`, `redis-persistent` | `redis` |
| `memcached` | `memcached` |
| `mongodb`, `mongodb-enterprise` | `mongo` |
| `solr` | `solr` |
| `elasticsearch`, `elasticsearch-enterprise` | `elasticsearch` |
| `varnish` | `varnish` |
| `opensearch`, `valkey`, `rabbitmq`, `kafka`, `influxdb`, `chrome-headless`, `gotenberg`, `clickhouse` | official upstream image via `compose` |
| `network-storage` | shared volume |
| `vault-kms` | not supported |

Versions are matched exactly when Lando supports them; otherwise the nearest
lower minor (or the newest supported) is used with a warning.

## Requirements

- Lando `3.21.0` or newer
- Ports `80` and `443` free on the host for Lando's proxy
