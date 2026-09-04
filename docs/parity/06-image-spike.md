# (6) Image spike

Goal: can this environment pull Platform.sh Fixed images from `docker.registry.platform.sh` well enough to run OPEN?

**Result: not proven.** There is no `docker` binary / daemon here. The spike is an anonymous HTTP probe of the registry only. That is **not** an OPEN proof and **not** a `docker pull` proof.

## Environment

* Host: Cursor cloud agent (2026-09-04)
* `docker` / `dockerd`: not installed
* Auth: none (no registry token, no `PLATFORMSH_CLI_TOKEN` used for this probe)

## Probe

Base: `https://docker.registry.platform.sh`

| Request | Result |
| --- | --- |
| `GET /v2/` | **403** `AccessDenied` (Amazon S3 / CloudFront XML error). Catalog listing is not public. |
| `GET /v2/php-8.0/manifests/latest` | **200** Docker manifest schema 2 |
| `GET /v2/mariadb-10.4/manifests/latest` | **200** Docker manifest schema 2 |
| `HEAD` config + layer blobs for both | **200** |

## `php-8.0`

* Manifest last-modified: 2021-10-28
* Config digest: `sha256:4b4443f7f89da5d97174fed5b6768330f546c4eead04bf74e06a284920c49bb3`
* Config created: `2021-10-28T18:06:30Z`
* OS/arch: `linux` / `amd64`
* Layers: 1
* Layer digest: `sha256:f1836c25b90fb38be5461e3f4777b2b428015b84921cb96e02d6f68c53f7f0c6`
* Layer `Content-Length`: **1961072640** (~1.96 GiB)

## `mariadb-10.4`

* Manifest last-modified: 2021-08-24
* Config digest: `sha256:e738ec510d9df6d3ebdc8cace6a625da8fa72df32cd85fa98ed07292696b8e49`
* Config created: `2021-08-24T22:38:28Z`
* OS/arch: `linux` / `amd64`
* Layers: 1
* Layer digest: `sha256:f952f7922b37c28b59a093eb99e5b08c009c9e52247793ff323d427690dd825b`
* Layer `Content-Length`: **533719040** (~509 MiB / ~534 MB)

## What this does and does not mean

Anonymous GET of those two image names succeeds. The images are **2021-era**. Privileged BOOT/OPEN against current Docker/Moby is still unknown.

Claw / workstation next:

```bash
docker pull docker.registry.platform.sh/php-8.0
docker pull docker.registry.platform.sh/mariadb-10.4
# then lando start on examples/php-8.0 or examples/mariadb-10.4
```

Capture OPEN and `PLATFORM_RELATIONSHIPS` failures. Do not claim image/OPEN parity until that run exists.
