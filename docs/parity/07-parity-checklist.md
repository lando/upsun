# (7) Parity checklist

Floor: `lando/platformsh` `9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0` (tip; 50 commits ahead of tag `v0.10.0`; seed `package.json` said `0.9.0`).

Phase-1 is **Fixed-only**. Branding is `@lando/upsun` / recipe `upsun`. Fixed ops stay on `platform` + `PLATFORMSH_CLI_TOKEN`. Flex is not supported.

| Item | Status | Notes |
| --- | --- | --- |
| Init (`platformsh-client` + flags) | **ship** | `--upsun-auth` / `--upsun-site`; deprecated `--platformsh-*` aliases still work. No live token E2E here. |
| Multi-app Fixed config | **ship** | Root `.platform.app.yaml` and `.platform/applications.yaml`-only covered by unit fixtures. Empty `.upsun/` is ignored. |
| Service builders | **ship** | Type names still `platformsh-*`; dirs are `services/upsun-*` / `types/upsun-*`. |
| BOOT / BUILD / START / OPEN + `/run/config.json` | **defer** | Code path kept from the floor SHA. Needs live Docker OPEN. |
| `PLATFORM_RELATIONSHIPS` | **ship** (code) | Unchanged OPEN injection. Runtime unverified. |
| `lando platform` tooling | **ship** (code) | `getPlatformCliTooling` still exposes `platform`. |
| pull / push / ssh | **ship** (code) | Scripts still call `platform` (`db:dump`, `db:sql`, `mount:*`, `auth:info`, `project:info`) with `PLATFORMSH_CLI_TOKEN`. |
| Token cache | **ship** | Write `upsun.tokens`; read-old `platformsh.tokens`. Host tokens still `~/.platformsh/cache/tokens`. |
| Proxy / routes | **ship** (code) | Same `{default}` parser. |
| Mounts sync | **ship** (code) | Same `platform mount:*` scripts. |
| Flex local OPEN | **wontfix** (Phase 3) | Hard error if `.upsun/config.yaml` exists: `Flex unsupported until Phase 3; Fixed-only.` |

## Explicit non-goals for this phase

* Flex config, Flex OPEN, or Flex relationship rewriting
* Inventing a new auth token env var
* Claiming Docker OPEN / Leia green without a daemon

## Verify in this environment

```bash
npm test   # lint + unit tests
```

Live `lando start` / `docker pull` was not possible here. See [(6) Image spike](06-image-spike.md).
