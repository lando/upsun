#!/bin/bash
set -e

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

CONF_DIR="${UPSUN_PHP_CONF_DIR:-/usr/local/etc/php/conf.d}"
FPM_POOL_DIR="${UPSUN_FPM_POOL_DIR:-/usr/local/etc/php-fpm.d}"
EXT_ENABLE="${UPSUN_PHP_EXT_ENABLE:-docker-php-ext-enable}"
PGREP="${UPSUN_PGREP:-pgrep}"
KILL="${UPSUN_KILL:-kill}"

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
    mkdir -p "$CONF_DIR" "$FPM_POOL_DIR"
    "$EXT_ENABLE" xdebug
    printf 'xdebug.mode=%s\n' "$mode" > "$CONF_DIR/zzz-upsun-xdebug.ini"
    printf '[www]\nenv[XDEBUG_MODE]=%s\n' "$mode" > "$FPM_POOL_DIR/zzz-upsun-xdebug.conf"
    reload_fpm
    lando_green "Xdebug enabled (mode $mode)"
    ;;
  off)
    rm -f \
      "$CONF_DIR/zzz-upsun-xdebug.ini" \
      "$CONF_DIR/docker-php-ext-xdebug.ini" \
      "$FPM_POOL_DIR/zzz-upsun-xdebug.conf"
    reload_fpm
    lando_green "Xdebug disabled"
    ;;
  *)
    lando_red "Usage: upsun-xdebug.sh on [mode] | off"
    exit 2
    ;;
esac
