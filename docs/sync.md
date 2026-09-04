---
description: Sync databases, files, relationships and mounts between local Lando and a remote Upsun Fixed environment.
---

# Syncing

`lando pull` and `lando push` copy **database relationships** and **mounts** between your local Lando app and a remote **Upsun Fixed** environment.

::: warning Fixed CLI contract
This plugin talks to Fixed with the **`platform`** binary and **`PLATFORMSH_CLI_TOKEN`**. That is the official Fixed CLI contract. Do not switch sync to `upsun` or `UPSUN_CLI_TOKEN`.

Flex (`.upsun/config.yaml`) is a hard abort. Flex sync is not this phase.
:::

::: warning Not live-proven here
Pull/push are **code shipped** on main @ `9bf288b`. Unit tests cover flag parsing, project-id wiring, and resume/activate fallback. They are **not** an E2E proof. A live `PLATFORMSH_CLI_TOKEN` run is still required before calling this E2E.
:::

Only database relationships are syncable.

## CLI and project id

| Thing | Value |
| --- | --- |
| Binary inside the app container | `platform` |
| Token | `PLATFORMSH_CLI_TOKEN` (or `lando pull --auth`) |
| Project id | Landofile `config.id`, then `--project`, then `platform project:info` / `.platform/local/project.yaml` |
| Environment id | Current git branch, or `--env` |

`lando init --source upsun` writes `config.id`. Pull/push export that as `PLATFORM_PROJECT`, call `platform project:set-remote`, and pass `-p` on Fixed CLI calls so sync does not depend on auto-detect alone.

Git branch should match the remote Fixed environment id. Override with `--env` when it does not.

During pull/push the scripts **unset** `PLATFORM_RELATIONSHIPS` and `PLATFORM_APPLICATION` so `platform` talks to the remote site instead of localhost.

## Inactive and paused environments

If the target environment is not in the active list (`platform env -I`):

1. Read `platform environment:info status`
2. **paused** → `platform environment:resume -y`
3. **inactive** → `platform environment:activate -y`
4. Only if that fails (or is not allowed) fall back to the environment's **parent**
5. After wake or parent switch, the chosen branch must appear in `platform env -I` (parent is woken if paused/inactive) or pull/push fails
6. `--no-parent` or an explicit `--env` disables parent fallback (fail instead)

Push still refuses production (`master`), including after a parent fallback.

## Pulling

```bash
lando pull

Pull relationships and/or mounts from the remote Fixed environment

Options:
  --help              Shows lando or delegated command help if applicable
  --verbose, -v       Runs with extra verbosity
  --auth              Upsun Fixed API token (PLATFORMSH_CLI_TOKEN)
  --mount, -m         A mount to download
  --relationship, -r  A relationship to import
  --env, -e           Remote Fixed environment ID
  --project, -p       Fixed project ID
  --no-parent         Do not fall back to the parent environment
```

```bash
# Interactively pull relationships and mounts
lando pull

# Import one remote database relationship and one Drupal files mount
lando pull -r database -m web/sites/default/files

# Space-form and equals-form both work
lando pull --relationship database --mount=web/sites/default/files

# Multiple relationships and mounts
lando pull -r database -r migrate -r readonly -m tmp -m private

# Pull -m SOURCE:TARGET = remote mount SOURCE downloaded into local TARGET
lando pull -m tmp:/var/www/tmp -m private:/somewhere/else

# Pull -r RELATIONSHIP:SCHEMA = remote relationship imported into local schema
lando pull -r admin:legacy

# Skip mounts or do nothing
lando pull -r database -m none
lando pull -r none -m none

# Target a specific env / project
lando pull --env feat --project PROJECTID -r database
```

## Pushing

```bash
lando push

Push relationships and/or mounts to the remote Fixed environment

Options:
  --help              Shows lando or delegated command help if applicable
  --verbose, -v       Runs with extra verbosity
  --auth              Upsun Fixed API token (PLATFORMSH_CLI_TOKEN)
  --mount, -m         A mount to push up
  --relationship, -r  A relationship to push up
  --env, -e           Remote Fixed environment ID
  --project, -p       Fixed project ID
  --no-parent         Do not fall back to the parent environment
```

```bash
# Interactively push relationships and mounts
lando push

# Export one local database relationship and one Drupal files mount
lando push -r database -m web/sites/default/files

# Multiple relationships and mounts
lando push -r database -r migrate -r readonly -m tmp -m private

# Push -m SOURCE:TARGET = local SOURCE uploaded into remote mount TARGET
lando push -m tmp:/var/www/tmp -m private:/somewhere/else

# Push -r RELATIONSHIP:SCHEMA = local schema exported into that remote schema
lando push -r admin:legacy -r admin:main

# Skip relationships or do nothing
lando push -r none -m tmp
lando push -r none -m none
```

Pushing to `master` is blocked.
