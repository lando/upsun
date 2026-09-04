---
title: Upsun Lando Plugin (Fixed)
description: Local Lando development for Upsun Fixed (.platform) projects. platform CLI / PLATFORMSH_CLI_TOKEN. Flex is not supported.
next: ./getting-started.html
---

::: warning Fixed-only
This plugin is a WIP revival of `@lando/platformsh`. It supports **Fixed** config only (`.platform.app.yaml` and `.platform/*`). If `.upsun/config.yaml` is present the plugin exits with a hard error. Flex is Phase 3. An empty `.upsun/` directory is ignored.
:::

# Upsun (Fixed)

[Upsun](https://upsun.com/) Fixed projects still use the Platform.sh yaml layout and images. This plugin:

* Starts Fixed PHP appservers and supported services from `.platform*` config
* Uses Platform.sh registry images and the BOOT/BUILD/OPEN lifecycle
* Uses the `platform` CLI, `PLATFORMSH_CLI_TOKEN`, and `~/.platformsh/` semantics
* Syncs database relationships and mounts via `lando pull` / `lando push`

It does **not** implement Flex local OPEN. Flex (`.upsun/config.yaml`) is a hard error until Phase 3.

PHP is the only supported application language. Workers, `network_storage`, and non-PHP runtimes still warn as unsupported.
