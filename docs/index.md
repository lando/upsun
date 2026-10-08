---
title: Lando Upsun Plugin
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
- build and every-start hooks, mounts, workers, operations and optional scheduled crons
- real local redirects, Mailpit and Xdebug toggles
- the `upsun` CLI inside the container, plus `lando pull` and `lando push`

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

`java`, `dotnet`, `elixir` and `rust` are not supported and produce a warning.

## Supported services

| Upsun `type` | Lando service |
|---|---|
| `mariadb`, `mysql` | `mariadb` |
| `mariadb-replica` | read-only user on its primary; no container |
| `oracle-mysql` | `mysql` |
| `postgresql` | `postgres` |
| `postgresql-replica`, `postgres-replica` | read-only user on its primary; no container |
| `redis`, `redis-persistent` | `redis` |
| `memcached` | `memcached` |
| `mongodb`, `mongodb-enterprise` | `mongo` |
| `solr` | `solr` |
| `elasticsearch`, `elasticsearch-enterprise` | `elasticsearch` |
| `varnish` | `varnish` |
| `opensearch`, `valkey`, `valkey-persistent`, `rabbitmq`, `kafka`, `influxdb`, `chrome-headless`, `gotenberg`, `clickhouse`, `mercure` | official upstream image via `compose` |
| `network-storage` | mount directories only; no local service |
| `vault-kms` | not supported |

Versions are matched exactly when Lando supports them; otherwise the nearest
lower version in the same major (or the newest supported) is used with a
warning.

`mariadb-replica`, `postgresql-replica` (Flex) and `postgres-replica` (Fixed)
run on their primary through a read-only user, without another container. Reads
see primary writes immediately, with no replication lag. MariaDB uses SELECT
grants; PostgreSQL uses `default_transaction_read_only`. Local usernames are
`<replica>_<endpoint>`, unlike Upsun's endpoint usernames. Pull, push and switch
skip replica relationships: pull the primary instead.

`valkey-persistent` uses a named data volume and append-only writes to retain
data across restarts and rebuilds. `lando destroy` deletes its local data.
`lando pull` only imports SQL databases, not Valkey data.

## Requirements

- Lando `3.21.0` or newer
- Ports `80` and `443` free on the host for Lando's proxy
- `jq` is installed in app containers
