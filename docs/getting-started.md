---
description: Learn how to get started with the Lando Upsun Fixed recipe.
---

# Getting Started

## Requirements

1. [Installed Lando](https://docs.lando.dev/getting-started/installation.html)
2. A **Fixed** project (`.platform.app.yaml` and/or `.platform/applications.yaml`)
3. An Upsun Fixed API token (`PLATFORMSH_CLI_TOKEN`) for init/pull/push
4. Landofile `config.id` set to the Fixed project ID (written by `lando init`); git branch matching the remote environment

Flex projects (`.upsun/config.yaml`) are rejected until Phase 3.

## Quick Start

```bash
# Interactive clone (Fixed)
lando init --source upsun

# Non-interactive
lando init \
  --source upsun \
  --upsun-auth "$PLATFORMSH_CLI_TOKEN" \
  --upsun-site "$PLATFORMSH_SITE_NAME"

# Deprecated aliases still work
lando init \
  --source platformsh \
  --platformsh-auth "$PLATFORMSH_CLI_TOKEN" \
  --platformsh-site "$PLATFORMSH_SITE_NAME"

# Already have Fixed code locally
cd /path/to/repo
lando init --source cwd --recipe upsun

lando start
lando pull -r database -m web/sites/default/files
lando info
```

Inside the app container the CLI is still `platform`:

```bash
lando platform auth:info
```

Remote dashboard variables are not pulled automatically. Set them locally as before.
