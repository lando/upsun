#!/bin/bash
set -e

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

PHP_BIN="${UPSUN_PHP_BIN:-php}"
EXT_INSTALLER="${UPSUN_PHP_EXT_INSTALLER:-install-php-extensions}"
EXT_ENABLE="${UPSUN_PHP_EXT_ENABLE:-docker-php-ext-enable}"
CONF_DIR="${UPSUN_PHP_CONF_DIR:-/usr/local/etc/php/conf.d}"
enable=""
disable=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --enable)
      [ "$#" -ge 2 ] || exit 2
      enable="$2"
      shift 2
      ;;
    --disable)
      [ "$#" -ge 2 ] || exit 2
      disable="$2"
      shift 2
      ;;
    *)
      lando_red "Unknown PHP extension option: $1"
      exit 2
      ;;
  esac
done

[ -n "$enable$disable" ] || exit 0

loaded="$("$PHP_BIN" -m | tr '[:upper:]' '[:lower:]' | sed 's/^zend opcache$/opcache/')"
# Lando's PHP images ship some extensions (xdebug) built but not enabled; the installer refuses to reinstall those.
ext_dir="${UPSUN_PHP_EXT_DIR:-$("$PHP_BIN" -r 'echo ini_get("extension_dir");')}"
failed=0

if [ -n "$enable" ]; then
  IFS=',' read -r -a extensions <<< "$enable"
  for extension in "${extensions[@]}"; do
    [ -n "$extension" ] || continue
    if printf '%s\n' "$loaded" | grep -Fxq "${extension,,}"; then
      lando_green "$extension already enabled"
    elif [ -f "$ext_dir/$extension.so" ]; then
      lando_pink "Enabling PHP extension $extension"
      if ! "$EXT_ENABLE" "$extension"; then
        lando_red "Failed to enable $extension"
        failed=1
      fi
    else
      lando_pink "Installing PHP extension $extension"
      if ! "$EXT_INSTALLER" "$extension"; then
        lando_red "Failed to install $extension"
        failed=1
      fi
    fi
  done
fi

if [ -n "$disable" ]; then
  IFS=',' read -r -a extensions <<< "$disable"
  for extension in "${extensions[@]}"; do
    [ -n "$extension" ] || continue
    ini="$CONF_DIR/docker-php-ext-$extension.ini"
    if [ -f "$ini" ]; then
      rm -f "$ini"
      lando_green "Disabled $extension"
    elif printf '%s\n' "$loaded" | grep -Fxq "${extension,,}"; then
      lando_yellow "$extension is compiled in and cannot be disabled"
    else
      lando_green "$extension already disabled"
    fi
  done
fi

exit "$failed"
