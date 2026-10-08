---
title: Syncing
description: Pull databases and mounts from Upsun, or push them back.
---

# Syncing

`lando pull` and `lando push` use the Upsun CLI inside the app container to
move databases and mounts between your local app and a remote environment.

Pull, push and switch do not offer replica relationships and reject them when
passed with `--relationship`. Pull the primary relationship instead: local replicas use read-only users on that same database
and see imported data immediately. Push through the primary relationship too.

## Authentication

To connect an existing app without pulling data, run:

```bash
lando auth upsun
```

Choose a saved account, **Log in with your browser**, or **Paste an API token**.
Lando validates the token, saves it for this app's vendor and prints the connected
email address. It runs no container command and does not touch a remote environment.
This command is available for Flex and Fixed, but not Adobe Commerce Cloud.
The account saved for this app by auth, pull, push or switch is preferred by `lando upsun`
/ `lando platform` while its token remains cached.

Once an account is saved for the app, `lando pull`, `lando push` and
`lando switch` use it without asking. Pass `--auth` to use a different token;
a token passed explicitly is validated and saved for next time. Saving a new
account, or removing a rejected one, refreshes the app's cached commands so
the next command picks it up.
The `--auth` picker also offers the token saved on disk in your `upsun` or `platform`
CLI's active session, labeled `upsun CLI token` or `platform CLI token`.
The account picker for `lando auth upsun`, `lando pull`, `lando push` and `lando switch` offers
**Log in with your browser** and **Paste an API token**, even when no tokens
are cached. Browser login creates and immediately saves a token named
`Lando (<hostname>)`, which you can revoke in the Console's API Tokens tab.
Press **Enter** to skip browser login and paste a token; any login failure
also falls back to pasting. Over SSH or in a remote shell, skip browser login
because your browser can't reach Lando's local callback. Passing `--auth API_TOKEN`
bypasses these prompts.
If validation rejects a selected cached token, Lando removes it from its token and
app authentication caches and warns you to run the command again with a new token.

If a command still looks stale after upgrading the plugin, run `lando --clear`
to drop the cached tooling and rebuild it from the current configuration.

| Flavor | CLI | Token variable |
|---|---|---|
| Flex | `upsun` | `UPSUN_CLI_TOKEN` |
| Fixed | `platform` | `PLATFORMSH_CLI_TOKEN` |

## Pull

**Pulling a database replaces the local one.** Existing tables, views and
sequences in the target database are dropped before the dump is imported.
Pulling a mount overwrites local files in that mount. Use `--skip-db`,
`--skip-files` or `none` to leave either alone.

```bash
lando pull
lando pull -r database -m /web/files
lando pull -r database:reports --no-files
lando pull -r none -m none --env staging
```

| Option | Meaning |
|---|---|
| `-r`, `--relationship` | Database relationship to import (repeatable), optionally `NAME:DATABASE`. `none` skips databases. |
| `-m`, `--mount` | Mount to download (repeatable). `none` skips mounts. |
| `-e`, `--env` | Remote environment. Defaults to your git branch. |
| `-p`, `--project` | Remote project. Defaults to `config.id`, then the CLI's local project file, then `lando`. |
| `--auth` | API token. Defaults to the app's saved account. |
| `--no-parent` | Do not fall back to the parent environment. |
| `--all-mounts` | Pull every remote mount into `PLATFORM_APP_DIR`. Pull only. |
| `--skip-db`, `--no-db` | Skip database sync. Equivalent to `-r none`. |
| `--skip-files`, `--no-files` | Skip mount sync. Equivalent to `-m none`. |
| `-A`, `--app` | Remote Upsun application. Defaults to `PLATFORM_APPLICATION_NAME`. |

A relationship normally syncs the database its endpoint reports as
`<RELATIONSHIP>_PATH`. Append `:DATABASE` to target another one, on both
sides: `-r database:reports` dumps the remote `reports` schema and imports it
into the local `reports` database. An endpoint without a default database
needs the explicit form; otherwise the command stops before touching anything.

Each database is dumped with `db:dump --gzip`, decompressed completely and
checked for content before that database's local data is cleared. An unsupported
scheme or a missing target aborts the run before the first database is changed.
A bad or empty dump stops the run without clearing its target; databases already
imported earlier in the run are not rolled back. MariaDB/MySQL imports first back
up local tables, views and triggers; a failed backup stops before anything is
dropped. They then drop existing tables and views and load the remote dump. If
cleanup or import fails, pull clears any partially loaded objects and restores
the backup. The command still fails, even when restoration succeeds. If restoration
also fails, it keeps the backup and prints its path for manual recovery.
Before the first drop, the backup is preserved outside the temporary import
directory. Ctrl-C or SIGTERM keeps that copy and prints its path too; only a
successful import removes it.
PostgreSQL imports drop tables, views, materialized views, sequences, public
non-extension routines, standalone types and large objects, then load the dump in a
single transaction, so an import error rolls back to the previous data.
The connection uses the local `postgres` superuser, but cleanup and ordinary
objects run as the endpoint user with `SET ROLE`, preserving their ownership.
Extension drops and creation run as the superuser and extension comments are
dropped. Other SQL errors still roll back the import.
Remote grants are not imported; local endpoint
privileges come from Lando's own setup. Run `lando restart` after pulling to
reapply them. Mounts are downloaded with `mount:download` into the mount path under `/app`.

If you select nothing in the relationship or mount prompt, nothing is synced
for that category and the command prints a notice pointing at `-r`/`-m` or the
skip flags. Pass `-r none` or `-m none` to skip on purpose and silence it.

Sync decides what to do from the environment's reported status
(`upsun environment:info <env> status`), not from the environment listing.
If the status is `paused` the environment is resumed; if it is `inactive` it is
activated. Sync checks readiness again after either wake command finishes.
Pull falls back to the parent only when a paused/inactive environment cannot be
resumed or activated; `--env` or `--no-parent` disables that fallback.
If the parent lookup fails or returns no parent, sync exits 2 without importing
anything. It never guesses `master`.

If an activity leaves the environment `dirty`, sync checks its status every
30 seconds for up to ten minutes, including after waking. It never repeats the
wake or starts a download/import while waiting. Terminal output shows a spinner
and countdown; Lando's piped tooling output prints a readable line per retry.
Press Ctrl-C to abort. A timeout, failed status query, or any status other than
`dirty` or `active` during this wait stops sync without parent fallback.

Other unsafe statuses stop the sync instead of falling back to the parent, because
importing the parent would replace the data you asked for with different data:

| Status | Result |
| --- | --- |
| `active` | Sync proceeds. |
| `paused` | Resumed, then synced. |
| `inactive` | Activated, then synced. |
| `dirty` | Checked every 30 seconds for up to ten minutes; sync proceeds only once `active`. |
| `deleting` | The environment is being torn down. |
| anything else, or unreadable | Reported verbatim and refused. |

## Push

```bash
lando push -r database -m /web/files --env feature-x
```

The database, mount, environment, project, app and skip options also apply to
`push`, including `NAME:DATABASE` targeting; `--all-mounts` is pull-only. Push
writes a plain SQL dump because it is streamed to `db:sql`. Pushing to the production environment (type `production`,
or branch `main`/`master`) is refused without `--force` (exit 6).
Without `--force`, only verified `development` and `staging` types are accepted.
A failed type lookup, empty type or unrecognized type exits 7; retry the command
or explicitly pass `--force`.

| Option | Meaning |
|---|---|
| `--force` | Bypass the remote environment type safety check. |

The push relationship prompt pre-selects nothing. Push never falls back to a
parent environment and takes a remote MySQL/MariaDB safety dump before importing;
an import failure prints the restore command.

PostgreSQL pushes use `pg_dump --clean --if-exists --no-owner --no-acl` to
replace existing objects without copying local owners or grants. The stream
enables `ON_ERROR_STOP` and wraps the replacement in one transaction. Large-object
transaction wrappers, `DROP EXTENSION` and `COMMENT ON EXTENSION` statements are
removed (extensions come from the Upsun service configuration) without changing
COPY data, so SQL errors stop the push and roll back the replacement rather than
reporting partial success.

## Switch

```bash
lando switch                       # pick an environment from a list
lando switch feature-x -r database -m /web/files
lando switch --env feature-x --no-db --no-files
```

`lando switch [environment]` checks out the git branch for a remote environment,
then pulls its databases and mounts. **Pulling replaces your selected local
data**, the same way `lando pull` does. Leave the environment out to pick one
from the project's environments, or pass it as a positional, `--env` or `-e`.
Your `.lando.yml` is restored if the target branch has none; an existing
Landofile on that branch is left alone.

| Option | Meaning |
|---|---|
| `-e`, `--env`, `--environment` | Remote environment to check out. Same as the positional. |
| `-r`, `--relationship` | Database relationship to import (repeatable), optionally `NAME:DATABASE`. `none` skips databases. |
| `-m`, `--mount` | Mount to download (repeatable). `none` skips mounts. |
| `-p`, `--project` | Remote project. Defaults to `config.id`, then the CLI's local project file, then `lando`. |
| `--auth` | API token. Defaults to the app's saved account. |
| `-A`, `--app` | Remote Upsun application. Defaults to `PLATFORM_APPLICATION_NAME`. |
| `--skip-db`, `--no-db` | Skip database sync. |
| `--skip-files`, `--no-files` | Skip mount sync. Use both skip flags for checkout only. |
| `--no-parent` | Disable parent fallback (already disabled by the explicit environment). |

There is no `--all-mounts` option for switch.

Adobe Commerce Cloud projects cannot use `lando switch`; use the
`magento-cloud` CLI instead.

## Adobe Commerce Cloud

`lando pull`, `lando push` and `lando switch` are not available for `.magento.app.yaml`
projects. They exit 1 with a message; use the `magento-cloud` CLI to move data.
For a local dump, `lando db-import` and `lando db-export` still work. See
[Tooling](./tooling.md#database-import-and-export).
