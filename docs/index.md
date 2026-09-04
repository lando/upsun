---
title: Upsun Lando Plugin (Fixed)
description: Local Lando development for Upsun Fixed (.platform) projects. platform CLI / PLATFORMSH_CLI_TOKEN. Flex is not supported.
next: ./getting-started.html
---

::: warning Fixed-only
This plugin is a WIP revival of `@lando/platformsh`. Phase-0/1 loads **Fixed** config only (`.platform.app.yaml` and `.platform/*`). If `.upsun/config.yaml` is present the plugin aborts. Flex is Phase 3. An empty `.upsun/` directory is ignored. OPEN is not claimed.
:::

# Upsun (Fixed)

[Upsun](https://upsun.com/) Fixed projects still use the Platform.sh yaml layout and images. Phase-0/1 of this plugin:

* Renames the package/recipe to `@lando/upsun` / `upsun`
* Loads Fixed `.platform*` config and rejects Flex (`.upsun/config.yaml`)
* Keeps the `platform` CLI, `PLATFORMSH_CLI_TOKEN`, and `~/.platformsh/` auth path

OPEN / `PLATFORM_RELATIONSHIPS` at runtime is **deferred** until a live Docker proof. Flex local OPEN is a hard error until Phase 3.

PHP is the only supported application language. Workers, `network_storage`, and non-PHP runtimes still warn as unsupported.
