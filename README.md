# @lando/upsun

Lando plugin for Upsun Fixed (ex-Platform.sh). WIP revival of [`lando/platformsh`](https://github.com/lando/platformsh).

**Phase-0/1 is not product-complete OPEN parity.** It is a rename, a Fixed-only gate, and a preserved auth path (code). Flex (`.upsun`) is not supported. One Fixed local OPEN is proven (`examples/mariadb-10.4` on #221 @ `836c0b0`; `PLATFORM_RELATIONSHIPS` usable). Pull/push are **code shipped** on main @ `9bf288b` (resume/activate, Landofile `config.id`, space-form flags, unit tests) but still **not E2E-proven** without a live `PLATFORMSH_CLI_TOKEN`. Flex and the broader OPEN matrix are still **deferred**.

Branding is `@lando/upsun` / recipe `upsun`. Fixed ops still use the `platform` binary, `PLATFORMSH_CLI_TOKEN`, and `~/.platformsh/` semantics.

## Seed SHA (not a runtime claim)

Seeded from [`lando/platformsh`](https://github.com/lando/platformsh) tip:

`9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0`

That SHA **is** the current `lando/platformsh` `main` tip. It is **50 commits ahead** of tag [`v0.10.0`](https://github.com/lando/platformsh/releases/tag/v0.10.0) (`111845db63b31092e80ef9f5386b97c31eba2987`). The seed `package.json` historically said `0.9.0` (both at the tip and at `v0.10.0`).

This is the code we forked. That seed SHA **alone** is **not** a claim that BOOT/BUILD/START/OPEN or `PLATFORM_RELATIONSHIPS` work on current Docker. The later local proof for `examples/mariadb-10.4` is recorded separately above and in [(6) Image spike](docs/parity/06-image-spike.md).

Review artifacts:

* [(5) Seed SHA](docs/parity/05-parity-floor-sha.md)
* [(6) Image spike](docs/parity/06-image-spike.md)
* [(7) Checklist](docs/parity/07-parity-checklist.md)
* [(8) platformsh-client call-site map](docs/parity/08-platformsh-client-map.md)

## What Phase-0/1 changes (code)

* Package `@lando/upsun`, recipe `upsun` (deprecated alias: `platformsh`)
* Fixed gate: `.upsun/config.yaml` is a hard abort (`warnings.flexUnsupported` + `flavor.assertFixedOnly()` throw). Empty `.upsun/` is ignored.
* Fixed config load: `.platform.app.yaml` and `.platform/{routes,services,applications}.yaml`
* Auth path preserved: container CLI is `platform` with `PLATFORMSH_CLI_TOKEN`
* Token cache `upsun.tokens` with **read-old-write-new** from `platformsh.tokens`
* Host CLI tokens from `~/.platformsh/cache/tokens`
* Init still uses pinned `platformsh-client@0.1.230` (`getAccountInfo`, `getProject`, `addSshKey`, `getAccessToken`)
* Flags `--upsun-auth` / `--upsun-site` plus deprecated `--platformsh-auth` / `--platformsh-site`
* `lando platform` / ssh scripts still call `platform` (code kept, not runtime-proven)
* `lando pull` / `lando push` use `platform` + `PLATFORMSH_CLI_TOKEN`, Landofile `config.id`, and resume/activate before parent fallback (**code shipped** on main @ `9bf288b`; **not E2E-proven**)

## What is deferred

* **OPEN / `PLATFORM_RELATIONSHIPS` runtime** — **proven (local)** for `examples/mariadb-10.4` only; broader matrix still **defer**
* **Pull/push live token E2E** — **code shipped** on main @ `9bf288b` (unit tests only); do not claim proven without a live `PLATFORMSH_CLI_TOKEN`
* Flex OPEN or Flex relationship rewriting — hard error until Phase 3
* Leia / Docker example jobs — still quarantined on PRs (one local spike is not a Leia matrix)
* Broader Docker OPEN against `docker.registry.platform.sh` is still **defer**. Registry HTTP probe: `/v2/` catalog is 403; `php-8.0` and `mariadb-10.4` manifests + layer blobs were anonymously readable (HTTP 200). Live local OPEN used `php-7.3` + `mariadb-10.4`; see [(6) Image spike](docs/parity/06-image-spike.md).

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

# Fixed CLI inside the app container is `platform`
lando platform auth:info
```

Existing Lando token caches named `platformsh.tokens` are read automatically. New writes go to `upsun.tokens`.

## Manual test plan

Needs Lando + Docker on a workstation. This cloud agent cannot run Docker OPEN; the local spike was already done once by Pinchy.

1. **Init (token)** — `lando init --source upsun --upsun-auth "$PLATFORMSH_CLI_TOKEN" --upsun-site <name>`
2. **Init (cwd Fixed PHP + MariaDB)** — copy `examples/mariadb-10.4`, set `recipe: upsun`, `lando start`
3. **`lando platform`** — `lando platform -V` / `auth:info` (uses `PLATFORMSH_CLI_TOKEN`)
4. **Pull** — `lando pull -r none -m none` (lists remotes). Live token + resume of a paused env still **needs proof**; this cloud agent does not run that E2E.
5. **Flex hard abort** — add `.upsun/config.yaml` and confirm start/init fails with the Phase 3 warning + error
6. **Empty `.upsun/`** — directory only, Fixed yaml still loads

## Development

```bash
npm install
npm test          # lint + unit tests
```

Leia / Docker OPEN tests (`npm run test:leia`) stay quarantined. Packaging/CI hygiene does not restore the Leia matrix. One local `examples/mariadb-10.4` spike is not a Leia matrix.

## Maintainers

* [@AaronFeledy](https://github.com/AaronFeledy)

Original `@lando/platformsh` authors: [@pirog](https://github.com/pirog), [@reynoldsalec](https://github.com/reynoldsalec).

## License

MIT
