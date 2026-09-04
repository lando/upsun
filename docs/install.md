---
title: Installation
description: How to install the Lando Upsun (Fixed) plugin.
---

# Installation

This plugin is **not** bundled with Lando. Install it explicitly.

::: code-group
```sh [lando 3.21+]
lando plugin-add @lando/upsun
```

```sh [docker]
mkdir -p ~/.lando/plugins
docker run --rm -it -v ${HOME}/.lando/plugins:/plugins -w /tmp node:18-alpine sh -c \
  "npm init -y \
  && npm install @lando/upsun --production --flat --no-default-rc --no-lockfile --link-duplicates \
  && npm install --production --cwd /tmp/node_modules/@lando/upsun \
  && mkdir -p /plugins/@lando \
  && mv --force /tmp/node_modules/@lando/upsun /plugins/@lando/upsun"
lando --clear
```
:::

Verify with `lando config --path plugins` and look for `@lando/upsun`.
