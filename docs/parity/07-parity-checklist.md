# (7) Phase-0/1 checklist

Seed: `lando/platformsh` `9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0` (tip; 50 commits ahead of tag `v0.10.0`; seed `package.json` said `0.9.0`).

Phase-0/1 is **rename + Fixed gate + auth path preserved (code)**. Not runtime OPEN parity. Branding is `@lando/upsun` / recipe `upsun`. Fixed ops stay on `platform` + `PLATFORMSH_CLI_TOKEN`. Flex is not supported.

| Item | Status | Notes |
| --- | --- | --- |
| Rename (`@lando/upsun`, recipe `upsun`) | **ship** | Deprecated `platformsh` recipe/init aliases. |
| Fixed gate | **ship** | `.upsun/config.yaml` → `warnings.flexUnsupported` + `lando.log.error`. Empty `.upsun/` ignored. |
| Fixed config load | **ship** | Root `.platform.app.yaml` and `.platform/applications.yaml`-only covered by unit fixtures. |
| Auth path (`platform` + `PLATFORMSH_CLI_TOKEN` + `platformsh-client`) | **ship** (code) | Kept. No live token E2E here. |
| Token cache | **ship** | Write `upsun.tokens`; read-old `platformsh.tokens`. |
| Service builders | **ship** | Type names still `platformsh-*`; dirs are `services/upsun-*` / `types/upsun-*`. |
| BOOT / BUILD / START / OPEN + `/run/config.json` | **defer** | Code path kept from the seed SHA. Needs live Docker OPEN. |
| `PLATFORM_RELATIONSHIPS` runtime | **defer** | Injection code kept. Not proven without OPEN. |
| `lando platform` / pull / push / ssh | **defer** (runtime) | Scripts still call `platform`. Not proven without a live app. |
| Proxy / routes | **ship** (code) | Same `{default}` parser. |
| Flex local OPEN | **wontfix** (Phase 3) | Hard abort if `.upsun/config.yaml` exists. |
| Leia example jobs | **quarantine** | Disabled on PRs until a Docker OPEN spike exists. |

## Explicit non-goals for this phase

* Claiming OPEN / `PLATFORM_RELATIONSHIPS` work on current Docker
* Flex config, Flex OPEN, or Flex relationship rewriting
* Inventing a new auth token env var

## Verify in this environment

```bash
npm test   # lint + unit tests
```

Live `lando start` / `docker pull` was not possible here. See [(6) Image spike](06-image-spike.md).
