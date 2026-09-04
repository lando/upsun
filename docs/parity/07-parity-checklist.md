# (7) Phase-0/1 checklist

Seed: `lando/platformsh` `9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0` (tip; 50 commits ahead of tag `v0.10.0`; seed `package.json` said `0.9.0`).

Phase-0/1 is **rename + Fixed gate + auth path preserved (code)**. Not product-complete OPEN parity. Branding is `@lando/upsun` / recipe `upsun`. Fixed ops stay on `platform` + `PLATFORMSH_CLI_TOKEN`. Flex is not supported.

One Fixed local OPEN is **proven (local)** for `examples/mariadb-10.4` on #221 @ `836c0b001d824477d4c372cbd809caa842b4ab73`. Pull/push, live token, Flex, and the broader OPEN matrix are still **defer**. See [(6) Image spike](06-image-spike.md).

| Item | Status | Notes |
| --- | --- | --- |
| Rename (`@lando/upsun`, recipe `upsun`) | **ship** | Deprecated `platformsh` recipe/init aliases. |
| Fixed gate | **ship** | `.upsun/config.yaml` → `warnings.flexUnsupported` + `flavor.assertFixedOnly()` throw. Empty `.upsun/` ignored. |
| Fixed config load | **ship** | Root `.platform.app.yaml` and `.platform/applications.yaml`-only covered by unit fixtures. |
| Auth path (`platform` + `PLATFORMSH_CLI_TOKEN` + `platformsh-client`) | **ship** (code) | Kept. No live host-token E2E. In-app `platform` 4.24.0 seen on the local spike. |
| Token cache | **ship** | Write `upsun.tokens`; read-old `platformsh.tokens`. |
| Service builders | **ship** | Type names still `platformsh-*`; dirs are `services/upsun-*` / `types/upsun-*`. |
| BOOT / BUILD / START / OPEN + `/run/config.json` | **proven (local)** | `examples/mariadb-10.4` only (`lando start` EXIT 0; app/mariadb/multi green; URLs 502 then 200). Broader matrix still **defer**. |
| `PLATFORM_RELATIONSHIPS` runtime | **proven (local)** | Same spike: PHP `mariadb.php` / `database.php` returned seeded astronaut rows. Broader matrix still **defer**. |
| `lando platform` / pull / push / ssh | **defer** (runtime) | Scripts still call `platform`. Host token / pull / push not exercised. |
| Proxy / routes | **ship** (code) | Same `{default}` parser. Local spike URLs reached 200 after OPEN. |
| Flex local OPEN | **wontfix** (Phase 3) | Hard abort if `.upsun/config.yaml` exists. Not tested in the local spike. |
| Leia example jobs | **quarantine** | Still disabled on PRs. One local spike is not a Leia un-quarantine. |

## Explicit non-goals for this phase

* Claiming product-complete OPEN or a full OPEN / `PLATFORM_RELATIONSHIPS` matrix on current Docker
* Flex config, Flex OPEN, or Flex relationship rewriting
* Inventing a new auth token env var
* Un-quarantining Leia from one local example

## Verify in this environment

```bash
npm test   # lint + unit tests
```

This cloud agent still cannot run Docker. The live local proof is Pinchy's `lando start` on `examples/mariadb-10.4` (logs under `/workspace/upsun-open-spike-logs/`; Claw reviewed and PASSed). See [(6) Image spike](06-image-spike.md).
