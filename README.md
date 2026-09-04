# @lando/upsun

WIP revival of [`@lando/platformsh`](https://github.com/lando/platformsh) as a Lando plugin for **Upsun Fixed** projects.

**This release is Fixed-only.** It loads `.platform.app.yaml` and `.platform/{routes,services,applications}.yaml`. Flex (`.upsun/config.yaml`) is a hard error until Phase 3. An empty `.upsun/` directory is ignored.

## Parity floor

Seeded from [`lando/platformsh`](https://github.com/lando/platformsh) at:

`9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0`

That SHA is the behavioral floor for Fixed local runtime (config load, service builders, BOOT/BUILD/START/OPEN, `PLATFORM_RELATIONSHIPS`, `platform` CLI pull/push/ssh).

## What works (Fixed)

* Recipe `upsun` (deprecated alias: `platformsh`)
* Package `@lando/upsun`
* Token cache `upsun.tokens` with **read-old-write-new** from `platformsh.tokens`
* Host CLI tokens from `~/.platformsh/cache/tokens`
* Container CLI remains `platform` with `PLATFORMSH_CLI_TOKEN` (not an Upsun CLI cutover)
* `lando platform` tooling, `lando pull` / `lando push`, ssh wrap that preserves `PLATFORM_*`
* Init still uses pinned `platformsh-client@0.1.230` (`getAccountInfo`, `getProject`, `addSshKey`, `getAccessToken`)
* Flags `--upsun-auth` / `--upsun-site` plus deprecated `--platformsh-auth` / `--platformsh-site`

## What does not work

* **Flex** — if `.upsun/config.yaml` exists, the plugin fails with: `Flex unsupported until Phase 3; Fixed-only.`
* No claim of Flex OPEN, Flex relationship rewriting, or `upsun` CLI for Fixed sync
* Full Docker OPEN against `docker.registry.platform.sh` is **not verified** here (no Docker daemon). Registry spike: `/v2/` catalog is 403; `php-8.0` and `mariadb-10.4` manifests + layer blobs were anonymously readable (HTTP 200). That is not an OPEN proof.

## Migration from `@lando/platformsh`

```yaml
# Landofile
recipe: upsun   # platformsh still works as a deprecated alias
plugins:
  "@lando/upsun": ^1.0.0-alpha.0
```

```bash
# New flags (old --platformsh-* flags still accepted)
lando init --source upsun --upsun-auth "$PLATFORMSH_CLI_TOKEN" --upsun-site "$PROJECT_NAME"

# Fixed CLI inside the app container is still `platform`
lando platform auth:info
```

Existing Lando token caches named `platformsh.tokens` are read automatically. New writes go to `upsun.tokens`.

## platformsh-client call sites

| Site | Methods | Decision |
| --- | --- | --- |
| `recipes/upsun/init.js` autocomplete | `getAccountInfo` | **keep** |
| `recipes/upsun/init.js` post-key | `addSshKey` | **keep** |
| `recipes/upsun/init.js` git URL | `getAccountInfo`, `getProject`, `getAccessToken` | **keep** |
| `recipes/upsun/init.js` build | `getAccountInfo` | **keep** |
| `app.js` post-pull / post-push | `getAccountInfo` | **keep** |

Pinned at `0.1.230`. Not replaced; Fixed E2E of a REST/CLI swap is not proven.

## Manual test plan

Needs Lando + Docker on a workstation. This environment could not run a full OPEN cycle.

1. **Init (token)** — `lando init --source upsun --upsun-auth "$PLATFORMSH_CLI_TOKEN" --upsun-site <name>`
2. **Init (cwd Fixed PHP + MariaDB)** — copy `examples/mariadb-10.4`, set `recipe: upsun`, `lando start`
3. **`lando platform`** — `lando platform -V` / `auth:info` (uses `PLATFORMSH_CLI_TOKEN`)
4. **Pull dry-run** — `lando pull -r none -m none` (lists remotes; no token → auth error, expected)
5. **Flex hard error** — add `.upsun/config.yaml` and confirm start/init fails with the Phase 3 message
6. **Empty `.upsun/`** — directory only, Fixed app still starts

## Development

```bash
npm install
npm test          # lint + unit tests
```

Leia / Docker OPEN tests (`npm run test:leia`) need live Platform images and are not claimed green here.

## Maintainers

* [@AaronFeledy](https://github.com/AaronFeledy)

Original `@lando/platformsh` authors: [@pirog](https://github.com/pirog), [@reynoldsalec](https://github.com/reynoldsalec).

## License

MIT
