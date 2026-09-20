#!/bin/bash
set -e

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

SUPERCRONIC_VERSION="0.2.33"
CURL="${UPSUN_CURL:-curl}"
INSTALL_DIR="${UPSUN_INSTALL_DIR:-/usr/local/bin}"
binary="$INSTALL_DIR/supercronic"

installed=""
if [ -x "$binary" ]; then
  installed="$("$binary" -version 2>/dev/null || true)"
elif command -v supercronic >/dev/null 2>&1; then
  installed="$(supercronic -version 2>/dev/null || true)"
fi
if [[ "$installed" == *"$SUPERCRONIC_VERSION"* ]]; then
  lando_green "supercronic $SUPERCRONIC_VERSION already installed"
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) lando_red "Unsupported architecture $(uname -m)"; exit 1 ;;
esac

url="https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-${ARCH}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

lando_pink "Installing supercronic $SUPERCRONIC_VERSION ($ARCH)..."
"$CURL" -fsSL "$url" -o "$tmp/supercronic"
mkdir -p "$INSTALL_DIR"
install -m 0755 "$tmp/supercronic" "$binary"
lando_green "Installed supercronic $SUPERCRONIC_VERSION"
