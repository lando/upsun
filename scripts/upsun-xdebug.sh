#!/bin/bash
set -e

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

# The app container runs with an empty XDEBUG_MODE, so this ini decides the mode for php-fpm and the CLI.
# Reloading php-fpm re-executes the master process, which is when Xdebug reads the mode.
CONF_DIR="${UPSUN_PHP_CONF_DIR:-/usr/local/etc/php/conf.d}"
PHP_BIN="${UPSUN_PHP_BIN:-php}"
EXT_ENABLE="${UPSUN_PHP_EXT_ENABLE:-docker-php-ext-enable}"
PGREP="${UPSUN_PGREP:-pgrep}"
KILL="${UPSUN_KILL:-kill}"
MODE_INI="$CONF_DIR/zzz-upsun-xdebug.ini"

reload_fpm() {
  local pid
  pid="$("$PGREP" -o php-fpm 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    "$KILL" -USR2 "$pid"
  else
    lando_yellow "php-fpm is not running; settings apply on next start"
  fi
}

case "${1:-}" in
  on)
    mode="${2:-debug}"
    if ! [[ "$mode" =~ ^[a-z_]+(,[a-z_]+)*$ ]]; then
      lando_red "Invalid Xdebug mode: $mode"
      exit 2
    fi
    mkdir -p "$CONF_DIR"
    if ! "$PHP_BIN" -m | grep -qix xdebug; then
      "$EXT_ENABLE" xdebug
    fi
    printf 'xdebug.mode=%s\n' "$mode" > "$MODE_INI"
    reload_fpm
    lando_green "Xdebug enabled (mode $mode)"
    ;;
  off)
    mkdir -p "$CONF_DIR"
    printf 'xdebug.mode=off\n' > "$MODE_INI"
    reload_fpm
    lando_green "Xdebug disabled"
    ;;
  *)
    lando_red "Usage: upsun-xdebug.sh on [mode] | off"
    exit 2
    ;;
esac
