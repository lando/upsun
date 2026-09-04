## v1.0.0-alpha.0 - [September 4, 2026](https://github.com/AaronFeledy/upsun)

* Rebrand package/recipe to `@lando/upsun` / `upsun` (deprecated `platformsh` alias).
* Fixed-only: Flex (`.upsun/config.yaml`) is a hard error until Phase 3.
* Token cache `upsun.tokens` with read-old-write-new from `platformsh.tokens`.
* Keep `platform` CLI, `PLATFORMSH_CLI_TOKEN`, `platformsh-client@0.1.230`, and `PLATFORM_RELATIONSHIPS`.
* Parity floor: lando/platformsh `9f3bda60ec14cfd72abd3aa92ec0ba04fc73a5c0`.

## v0.10.0 - [March 8, 2024](https://github.com/lando/platformsh/releases/tag/v0.10.0)
  * Updated to latest database services.

## v0.9.0 - [July 3, 2023](https://github.com/lando/platformsh/releases/tag/v0.9.0)
  * Removed bundle-dependencies and version-bump-prompt from plugin.
  * Updated package to use prepare-release-action.
  * Updated documentation to reflect new release process.

## v0.8.0 - [April 20, 2023](https://github.com/lando/platformsh/releases/tag/v0.8.0)

* Updated to `platformsh-client` 0.1.230 and pinned to that release to resolve issue with fetching site list. [#184](https://github.com/lando/platformsh/issues/184)

## v0.7.0 - [December 12, 2022](https://github.com/lando/platformsh/releases/tag/v0.7.0)

* Added bundle-dependencies to release process.
* Fixed bug in plugin dogfooding test.

## v0.6.1 - [September 8, 2022](https://github.com/lando/platformsh/releases/tag/v0.6.1)

* HYPERDRIVED

## v0.6.0 - [October 29, 2021](https://github.com/lando/platformsh/releases/tag/v0.6.0)

Lando is **free** and **open source** software that relies on contributions from developers like you! If you like Lando then help us spend more time making, updating and supporting it by [contributing](https://github.com/sponsors/lando).

* Updated to more recent `php` images, resolves [#23](https://github.com/lando/platformsh/issues/23) [#60](https://github.com/lando/platformsh/issues/60) [#116](https://github.com/lando/platformsh/issues/116)

## v0.5.0 - [October 6, 2021](https://github.com/lando/platformsh/releases/tag/v0.5.0)

Lando is **free** and **open source** software that relies on contributions from developers like you! If you like Lando then help us spend more time making, updating and supporting it by [contributing](https://github.com/sponsors/lando).

* First release of `platformsh` as an external plugin!
* Added testing for most `services` [#3](https://github.com/lando/platformsh/issues/3)
* Fixed some bugs
