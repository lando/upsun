#!/bin/bash
set -eo pipefail

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

SUPERCRONIC_VERSION="0.2.49"
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
  x86_64|amd64) ARCH=amd64; SHA1=e63c11a9726b775a6a11801e81af4f3fb926aa68 ;;
  aarch64|arm64) ARCH=arm64; SHA1=0b6c5bb743e0b0dafed1132198c81807927ac413 ;;
  *) lando_red "Unsupported architecture $(uname -m)"; exit 1 ;;
esac
SHA1="${UPSUN_SUPERCRONIC_SHA1-$SHA1}"

url="https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_VERSION}/supercronic-linux-${ARCH}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

lando_pink "Installing supercronic $SUPERCRONIC_VERSION ($ARCH)..."
"$CURL" -fsSL "$url" -o "$tmp/supercronic"
if ! (cd "$tmp" && printf '%s  supercronic\n' "$SHA1" | sha1sum -c -); then
  lando_red "Checksum verification failed for supercronic $SUPERCRONIC_VERSION ($ARCH); expected SHA1 $SHA1"
  exit 6
fi
mkdir -p "$INSTALL_DIR"
install -m 0755 "$tmp/supercronic" "$binary"
lando_green "Installed supercronic $SUPERCRONIC_VERSION"
