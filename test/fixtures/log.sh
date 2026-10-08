#!/bin/bash
set -e

lando_pink() { printf 'PINK %s\n' "$*"; }
lando_green() { printf 'GREEN %s\n' "$*"; }
lando_yellow() { printf 'YELLOW %s\n' "$*"; }
lando_red() { printf 'RED %s\n' "$*" >&2; }
lando_info() { printf 'INFO %s\n' "$*"; }
lando_warn() { printf 'WARN %s\n' "$*" >&2; }
