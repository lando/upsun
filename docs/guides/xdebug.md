---
title: Debugging with Xdebug
description: Step-debug a PHP app locally with the same Xdebug settings it has on Upsun.
guide: true
---

Upsun loads Xdebug when an app declares an IDE key:

```yaml
applications:
  app:
    type: "php:8.4"
    runtime:
      xdebug:
        idekey: PHPSTORM
```

The recipe reads the same key. On `lando start` the app container gets Xdebug
with `xdebug.mode=debug` and `xdebug.idekey=PHPSTORM`, pointed at your host on
port `9003`. Nothing needs to change in the Landofile.

To debug a project that has no IDE key on Upsun, or to force Xdebug off, set
`config.xdebug` in the Landofile and run `lando rebuild`:

```yaml
config:
  xdebug: true          # debug mode; a string such as "develop,debug" picks other modes
  # xdebug: false       # keep Xdebug off even when the app declares an IDE key
```

`runtime.extensions: [xdebug]` also works: the extension is loaded with the
mode off until one of the switches above, or `lando xdebug-on`, turns it on.
Listing `xdebug` in `runtime.disabled_extensions` prevents build-time loading,
even with an IDE key or `config.xdebug` set. You can still load it with `lando xdebug-on`.

## Connecting your IDE

Set the IDE to listen on port `9003` and map the repository root to `/app`.
If your IDE opens only a nested app, map that directory to `/app/<source.root>`.
Lando's guides cover the client side:

- [PhpStorm](https://docs.lando.dev/guides/lando-phpstorm.html)
- [Visual Studio Code](https://docs.lando.dev/guides/lando-with-vscode.html)

Then start listening, set a breakpoint and load a page. Xdebug reports the
file as `file:///app/...` and sends the IDE key from your Upsun config.

On Upsun only requests that carry the `XDEBUG_SESSION` cookie are debugged.
Locally, Xdebug connects on every web request and every `lando php` command
while the mode includes `debug`, because Lando's `XDEBUG_CONFIG` environment
counts as a trigger. Requests continue normally when nothing is listening.

## Turning it on and off

```bash
lando xdebug-on                # debug
lando xdebug-on develop,debug
lando xdebug-off
```

The toggles take effect immediately for web requests and `lando php`. A
`lando rebuild` goes back to the mode the configuration asks for.
Xdebug 3 stays loaded with its mode off. On older images with Xdebug 2,
`xdebug-off` unloads the extension instead; mode strings and `xdebug_info` require Xdebug 3.

## Changing Xdebug settings

Any `xdebug.*` key in `variables.php` lands in the generated `php.ini`:

```yaml
applications:
  app:
    variables:
      php:
        xdebug.client_port: 9004
        xdebug.log: /tmp/xdebug.log
```

For local-only values use `config.overrides` in the Landofile, which merges
into the app configuration before it is read:

```yaml
config:
  overrides:
    app:
      variables:
        php:
          xdebug.client_port: 9004
```

These values override the generated mode and IDE key, but do not load the extension.

Run `lando restart` after changing either; the generated `php.ini` is
regenerated and mounted on every start.

## Checking the state

```bash
lando php -r 'var_dump(xdebug_info("mode"));'   # effective modes, [] when off
lando exec app -- tail /tmp/xdebug.log           # connection attempts and errors
```
