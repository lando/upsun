#!/bin/bash
#
# Install the Upsun (or Upsun Fixed "platform") CLI from the upsun/cli GitHub releases.
#
# Usage: upsun-install-cli.sh <upsun|platform> [version]
#
# Both binaries are published from https://github.com/upsun/cli. We download the
# tarball directly rather than piping the vendor installer because we need a
# deterministic, non-interactive install that works for any container user.

set -eo pipefail

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

BINARY="${1:-upsun}"
VERSION="${2:-}"
INSTALL_DIR="${UPSUN_CLI_INSTALL_DIR:-/usr/local/bin}"
CURL="${UPSUN_CURL:-curl}"

case "$BINARY" in
  upsun|platform) ;;
  *) lando_red "Unknown CLI binary: $BINARY"; exit 2 ;;
esac

if [ -x "$INSTALL_DIR/$BINARY" ] && [ -z "$VERSION" ]; then
  lando_green "$BINARY CLI already installed: $("$INSTALL_DIR/$BINARY" --version 2>/dev/null | head -n1)"
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) lando_red "Unsupported architecture $(uname -m)"; exit 1 ;;
esac

if [ -z "$VERSION" ]; then
  VERSION="$("$CURL" -fsSLI --retry 3 -o /dev/null -w '%{url_effective}' \
    https://github.com/upsun/cli/releases/latest | sed 's#.*/tag/v\{0,1\}##')"
fi
VERSION="${VERSION#v}"

RELEASE="https://github.com/upsun/cli/releases/download/v${VERSION}"
ASSET="${BINARY}_${VERSION}_linux_${ARCH}.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

lando_pink "Installing $BINARY CLI $VERSION ($ARCH)..."
# GitHub release downloads occasionally fail with a transient 5xx; --retry covers 5xx, 408, 429 and timeouts
"$CURL" -fsSL --retry 3 "$RELEASE/$ASSET" -o "$TMP/$ASSET"
if ! "$CURL" -fsSL --retry 3 "$RELEASE/checksums.txt" -o "$TMP/checksums.txt" ||
  ! (cd "$TMP" && awk -v asset="$ASSET" 'NF == 2 && $2 == asset {print}' checksums.txt | sha256sum -c -); then
  lando_red "Checksum verification failed for $ASSET"
  exit 6
fi
tar -xzf "$TMP/$ASSET" -C "$TMP" "$BINARY"
mkdir -p "$INSTALL_DIR"
install -m 0755 "$TMP/$BINARY" "$INSTALL_DIR/$BINARY"
lando_green "Installed $("$INSTALL_DIR/$BINARY" --version 2>/dev/null | head -n1) to $INSTALL_DIR/$BINARY"
