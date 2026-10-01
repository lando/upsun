#!/bin/bash
#
# Run a command with the Upsun shell environment (.environment sourced).
# Used as the prefix for generated tooling and lando ssh.

. /helpers/upsun-env.sh
exec "$@"
