# (6) Image spike

Goal: can we pull Platform.sh Fixed images from `docker.registry.platform.sh` well enough to run OPEN?

**Result: proven (local)** for `examples/mariadb-10.4` only. Pinchy ran a live `lando start` on Pinchy's computer against lando/upsun#221 @ `836c0b001d824477d4c372cbd809caa842b4ab73`. Logs are under `/workspace/upsun-open-spike-logs/`. Claw reviewed those logs and PASSed Fixed local OPEN for this example only. That is one Fixed example, not product-complete OPEN and not a full matrix. Host `PLATFORMSH_CLI_TOKEN` / pull-push were not exercised. Flex was not tested.

## Live local spike (Pinchy)

* Repo/PR: [lando/upsun#221](https://github.com/lando/upsun/pull/221) @ `836c0b001d824477d4c372cbd809caa842b4ab73`
* Operator: Pinchy (live local OPEN on Pinchy's computer); logs `/workspace/upsun-open-spike-logs/`; Claw reviewed and PASSed
* Example: `examples/mariadb-10.4` (Fixed `.platform*`, recipe `upsun`, `config.id` DISCONNECTED)
* Anonymous pulls: `docker.registry.platform.sh/php-7.3` + `docker.registry.platform.sh/mariadb-10.4`
* `lando start` EXIT 0; Opening platform.sh containers; app / mariadb / multi green; URLs 502 then 200
* `PLATFORM_RELATIONSHIPS` present and usable (PHP `mariadb.php` / `database.php` returned seeded astronaut rows)
* In-app `platform` CLI 4.24.0
* Host `PLATFORMSH_CLI_TOKEN` / pull-push **not** exercised
* Bounds: one example only; Flex not tested; Docker Engine 29.x untested-by-Lando warning present

## What this does and does not mean

This is a local OPEN proof for **one** Fixed PHP+MariaDB example. It is **not**:

* product-complete OPEN parity
* a Leia / example-matrix pass (Leia stays quarantined)
* a Flex proof
* a host-token, pull, or push proof

## Prior cloud-agent HTTP probe (not an OPEN proof)

The Cursor cloud agent (2026-09-04) has no `docker` / `dockerd`. It only probed the registry anonymously. That probe is **not** an OPEN proof and **not** a `docker pull` proof. Kept here as the earlier registry check.

Base: `https://docker.registry.platform.sh`

| Request | Result |
| --- | --- |
| `GET /v2/` | **403** `AccessDenied` (Amazon S3 / CloudFront XML error). Catalog listing is not public. |
| `GET /v2/php-8.0/manifests/latest` | **200** Docker manifest schema 2 |
| `GET /v2/mariadb-10.4/manifests/latest` | **200** Docker manifest schema 2 |
| `HEAD` config + layer blobs for both | **200** |

### `php-8.0` (HTTP probe only; not the live OPEN example)

* Manifest last-modified: 2021-10-28
* Config digest: `sha256:4b4443f7f89da5d97174fed5b6768330f546c4eead04bf74e06a284920c49bb3`
* Config created: `2021-10-28T18:06:30Z`
* OS/arch: `linux` / `amd64`
* Layers: 1
* Layer digest: `sha256:f1836c25b90fb38be5461e3f4777b2b428015b84921cb96e02d6f68c53f7f0c6`
* Layer `Content-Length`: **1961072640** (~1.96 GiB)

### `mariadb-10.4` (HTTP probe)

* Manifest last-modified: 2021-08-24
* Config digest: `sha256:e738ec510d9df6d3ebdc8cace6a625da8fa72df32cd85fa98ed07292696b8e49`
* Config created: `2021-08-24T22:38:28Z`
* OS/arch: `linux` / `amd64`
* Layers: 1
* Layer digest: `sha256:f952f7922b37c28b59a093eb99e5b08c009c9e52247793ff323d427690dd825b`
* Layer `Content-Length`: **533719040** (~509 MiB / ~534 MB)

Anonymous GET of those two image names succeeds. The images are **2021-era**. The live OPEN proof above used `php-7.3` + `mariadb-10.4` on `examples/mariadb-10.4`, not `php-8.0`.
