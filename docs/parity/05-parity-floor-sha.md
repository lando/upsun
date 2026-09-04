# (5) Parity floor SHA

Phase-1 Fixed local runtime is measured against this commit, not against the historical npm version string.

| Field | Value |
| --- | --- |
| Parity floor SHA | `9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0` |
| Meaning | Current [`lando/platformsh`](https://github.com/lando/platformsh) `main` tip |
| Subject | `AUTODEPLOYED @lando/vitepress-theme-default-plus@1.2.0` |
| Date | 2026-07-30 |
| Seeded repo | This fork (`lando/upsun`) `main` at clone time |

## Relation to tag `v0.10.0`

| Field | Value |
| --- | --- |
| Tag | [`v0.10.0`](https://github.com/lando/platformsh/releases/tag/v0.10.0) |
| Tag SHA | `111845db63b31092e80ef9f5386b97c31eba2987` |
| Tag date | 2024-03-08 |
| Tag subject | `Update to latest database services. (#204)` |
| Distance | **50 commits** on `main` after the tag (`git rev-list --count v0.10.0..9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0` = 50) |

Do not treat `v0.10.0` as the floor. The floor is the tip SHA above.

## Historical `package.json` version

`package.json` at **both** the tip and at `v0.10.0` said `"version": "0.9.0"` and `"name": "@lando/platformsh"`.

The published tag name (`v0.10.0`) and the in-tree version field (`0.9.0`) were already out of sync upstream. Phase-1 does not inherit that version number. This package is `@lando/upsun` `1.0.0-alpha.0`.

## What the floor covers

Behavioral contract copied from that SHA for **Fixed** projects:

* Load `.platform.app.yaml` and `.platform/{routes,services,applications}.yaml`
* Service builders (`platformsh-*` type names)
* BOOT / BUILD / START / OPEN and `/run/config.json`
* `PLATFORM_RELATIONSHIPS` injection
* Container CLI `platform` + `PLATFORMSH_CLI_TOKEN` + `~/.platformsh/`
* `platform` pull / push / ssh helpers
* `platformsh-client@0.1.230` init / post-pull / post-push

## What the floor does not cover

* Flex (`.upsun/config.yaml`) — hard error until Phase 3
* A live Docker OPEN proof on current Moby (not run in this environment)
