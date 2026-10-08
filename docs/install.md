---
title: Installation
description: How to install the Lando Upsun plugin.
---

# Installation

```bash
lando plugin-add @lando/upsun
```

Verify with `lando config --path plugins`; it lists `@lando/upsun` and where it
is loaded from.

## Upgrading from @lando/platformsh

Remove the old plugin with `lando plugin-remove @lando/platformsh` and install `@lando/upsun` above.
`recipe: platformsh` still works as a deprecated alias; switch to `recipe: upsun` and run `lando rebuild`.
Re-authenticate with `lando auth upsun` instead of the old `lando init --source cwd --recipe platformsh` step.
See [Caveats](./caveats.md) for optional `@lando/*` plugins to install or update when `plugin-missing` or `plugin-outdated` warns.
