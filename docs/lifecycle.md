---
title: Lifecycle
description: What happens when an Upsun project starts under Lando.
---

# Lifecycle

1. **Load.** The recipe detects the flavor, reads `.upsun/*.yaml` or
   `.platform*`, and normalizes it into one model.
2. **Map.** Each application and service is mapped to a Lando service; routes
   become proxy entries; tooling is generated.
3. **Build** (first start and `lando rebuild`).
   - as root: install `mariadb-client`, `postgresql-client` and `jq`, install
     the `upsun` or `platform` CLI
   - as the app user: run the build flavor (`composer install` / `npm install`),
     then `hooks.build`, from the app directory with the `PLATFORM_*`
     environment and `.environment` sourced
4. **Start.** Containers come up with the full runtime environment.
5. **Run** (every start): create mount directories, run `hooks.deploy` then
   `hooks.post_deploy`.

Details of the model, environment and mapping contracts are in
[Architecture](./architecture.md).
