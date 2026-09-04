# (8) `platformsh-client` call-site map

Pinned dependency: `platformsh-client@0.1.230` (also in `bundleDependencies`).

Phase-1 **keeps** this client. Init, autocomplete, SSH key post, git URL resolve, and post-pull/push token refresh still go through it. Nothing here is deleted or replaced.

Token passed into the client is the Platform.sh API token (`--upsun-auth` / deprecated `--platformsh-auth` / `answers.auth` on pull/push). That is the same secret as `PLATFORMSH_CLI_TOKEN`.

## Call sites

| Site | Lines | Methods | Decision |
| --- | --- | --- | --- |
| `recipes/upsun/init.js` autocomplete `getAutoCompleteSites` | ~44–56 | `getAccountInfo` | **keep** — lists Fixed projects for `lando init --source upsun` |
| `recipes/upsun/init.js` source `build` constructor | ~148–151 | constructs `PlatformshApiClient` | **keep** |
| `recipes/upsun/init.js` `post-key` | ~154–161 | `addSshKey` | **keep** — posts `platformsh.lando.id_rsa.pub` |
| `recipes/upsun/init.js` `get-git-url` | ~163–175 | `getAccountInfo`, `getProject`, `getAccessToken` | **keep** — resolves repo URL + clone token |
| `recipes/upsun/init.js` recipe `build` | ~198–214 | `getAccountInfo` | **keep** — writes token cache (`upsun.tokens`) + Landofile `id` |
| `recipes/platformsh/init.js` | alias | re-exports `recipes/upsun/init.js` | **keep** — deprecated source name |
| `app.js` `post-pull` / `post-push` | ~173–190 | `getAccountInfo` | **keep** — refreshes cache when `answers.auth` is set |

## Not call sites

These talk to the **`platform` CLI**, not `platformsh-client`:

* `scripts/upsun-pull.sh` — `platform auth:info`, `project:info`, `db:dump`, `mount:download`
* `scripts/upsun-push.sh` — `platform auth:info`, `project:info`, `db:sql`, `mount:upload`
* `scripts/upsun-build.sh` — `platform mounts`, `platform local:build`
* `scripts/upsun-exec.sh` — preserves `PLATFORM_*` so `platform` remote vs local stays correct
* `lib/tooling.js` `getPlatformCliTooling` — exposes `lando platform`

Host token files are still read from `~/.platformsh/cache/tokens` (`lib/utils.js` `getPlatformshTokens`). Lando app cache writes only `upsun.tokens` (`lib/tokens.js`).

## Replace / wrap?

| Option | Phase-1 |
| --- | --- |
| keep | **yes** — all rows above |
| wrap | not needed; branding flags already normalize to the same client |
| replace | **no** — no Fixed E2E of a REST/CLI swap |

Unit lock: `test/client-sites.spec.js` asserts the pin and that init/app still `require('platformsh-client')` and call the methods above.
