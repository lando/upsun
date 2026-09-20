---
title: Caveats
description: Where local differs from Upsun.
---

# Caveats

## Not Upsun's images

Upsun's production images are not publicly published (the old
`docker.registry.platform.sh` registry froze in 2024 and is amd64-only), so
services run on Lando's own images. Consequences:

- PHP extensions and system packages differ from production. Use
  `config.overrides` or `config.build` to add what you need.
- `size`, `disk`, `resources` and `container_profile` are ignored.
- PostgreSQL uses the `postgres` superuser with an empty password.

## Emulation limits

- Crons are not scheduled; run them with `lando cron <name>`.
- `workers` run as extra services from the same image.
- Redirect routes are served by their upstream app instead of redirected.
- Composable images run only their primary runtime.
- `java`, `dotnet`, `elixir`, `rust`, `lisp` apps and `vault-kms` services are
  not created.
- Versions Lando does not ship fall back to the nearest lower minor.

## Proxy

Lando's proxy needs ports `80` and `443`. If they are taken, URLs move to
`:8888`/`:8443` or the proxy fails to start; the containers still work.

## `PLATFORM_RELATIONSHIPS` and the CLI

The Upsun CLI treats a set `PLATFORM_RELATIONSHIPS` as "running on Upsun".
`lando upsun`, `lando pull` and `lando push` unset it; if you call the CLI from
your own scripts inside the container, do the same.
