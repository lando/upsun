#!/bin/bash
set -eo pipefail

# shellcheck disable=SC1090
. "${UPSUN_LOG_HELPER:-/helpers/log.sh}"

[ "$#" -eq 1 ] || { lando_red "Usage: upsun-install-node.sh <major>"; exit 2; }

major="$1"
CURL="${UPSUN_CURL:-curl}"
PREFIX="${UPSUN_NODE_PREFIX:-/usr/local}"
NODE_BIN="${UPSUN_NODE_BIN:-node}"
DIST="${UPSUN_NODE_DIST:-https://nodejs.org/dist}"
installed="$("$NODE_BIN" -v 2>/dev/null || true)"

case "$installed" in
  "v${major}."*)
    lando_green "Node.js $major already installed"
    exit 0
    ;;
esac

version="$("$CURL" -fsSL "$DIST/index.json" | jq -r --arg m "v$major." \
  '[.[] | select(.version | startswith($m))][0].version // empty')"
if [ -z "$version" ]; then
  lando_red "No Node.js $major release found"
  exit 1
fi

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) lando_red "Unsupported architecture $(uname -m)"; exit 1 ;;
esac

archive="node-${version}-linux-${ARCH}.tar.gz"
url="$DIST/$version/$archive"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

lando_pink "Installing Node.js $version ($ARCH)..."
"$CURL" -fsSL "$url" -o "$tmp/$archive"
if ! "$CURL" -fsSL "$DIST/$version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" ||
  ! (cd "$tmp" && awk -v asset="$archive" 'NF == 2 && $2 == asset {print}' SHASUMS256.txt | sha256sum -c -); then
  lando_red "Checksum verification failed for $archive"
  exit 6
fi
mkdir -p "$PREFIX"
tar -xzf "$tmp/$archive" --strip-components=1 -C "$PREFIX"
lando_green "Installed Node.js $version"
