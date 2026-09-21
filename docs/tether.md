---
title: Tethering
description: Run the local app against services in a remote Upsun environment.
---

# Tethering

Tether mode keeps application containers local and connects their relationships
to an Upsun environment through CLI-managed tunnels.

```yaml
name: my-project
recipe: upsun
config:
  tethered: true       # current git branch, or main when detached
  # tethered: staging  # explicit environment ID
```

The recipe does not create the configured local relationship services. It starts
the app services and generated sidecars, leaves `PLATFORM_RELATIONSHIPS` empty,
then opens the tether during the every-start runner. Mailpit remains local unless
`config.mail: false` disables it.

## How it connects

`lando tether` reads the selected application's remote relationship payload and
opens one `tunnel:single` process per relationship. Local ports start at `30000`
and increment in relationship-name order. The rewritten environment is stored in
`/tmp/upsun-tether.env`; tunnel PID and log files live under
`/run/upsun-tether/` (root-owned). `lando tether --info` redacts passwords.

PHP apps also receive
`/usr/local/etc/php-fpm.d/zzz-upsun-tether.conf`, and PHP-FPM is reloaded so web
requests see the tunneled variables. Non-PHP apps use the start wrapper and wait
up to 120 seconds for the environment file before starting without remote
relationships.

Remote workers are not connected. The tether reads relationships for the
selected application and does not attach to remote worker processes.

## Manage the tether

```bash
lando tether          # open or refresh
lando tether --info   # list the environment, ports and process status
lando tether --close  # stop tunnels and remove generated environment files
```

Starting or restarting the app opens the tether automatically. The command needs
a cached or configured API token. It uses the Upsun CLI and API to create the
tunnels; no SSH private key is needed inside the container.

## Limits

- Every service call crosses the network, so expect remote latency.
- There is no local database copy while tethered.
- `lando pull` and `lando push` skip databases with a warning; mount sync still
  works.
- The remote environment must be active. The sync helper attempts to resume or
  activate it before opening tunnels.
