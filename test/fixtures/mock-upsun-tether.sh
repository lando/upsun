#!/bin/bash
set -e

printf '%s %s\n' "${PLATFORM_RELATIONSHIPS:-unset}" "${UPSUN_CLI_CONTEXT:-}" >> "$MOCK_TETHER_LOG"
printf '%s\n' "$*" >> "$MOCK_TETHER_LOG"

case "$1" in
  auth:info|project:set-remote)
    exit 0
    ;;
  env)
    [ -n "${MOCK_ACTIVE:-}" ] && tr ' ' '\n' <<< "$MOCK_ACTIVE"
    ;;
  environment:info)
    case " $* " in
      *' status '*) printf '%s\n' "${MOCK_STATUS:-}" ;;
      *' parent '*) printf '%s\n' "${MOCK_PARENT:-master}" ;;
      *' type '*) printf '%s\n' "${MOCK_ENV_TYPE:-development}" ;;
    esac
    ;;
  ssh)
    [ "${MOCK_SSH_RC:-0}" -eq 0 ] || exit "$MOCK_SSH_RC"
    base64 < "$MOCK_RELATIONSHIPS_FILE" | tr -d '\n'
    ;;
  tunnel:single)
    printf 'pid %s\n' "$$" >> "$MOCK_TETHER_LOG"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -r) rel="$2"; shift ;;
        --port) port="$2"; shift ;;
      esac
      shift
    done
    if [ "${MOCK_TUNNEL_LISTEN:-0}" = 1 ] && [ "${MOCK_TUNNEL_NO_LISTEN:-}" != "$rel" ]; then
      exec node -e 'require("net").createServer(socket => socket.end()).listen(Number(process.argv[1]), "127.0.0.1")' "$port"
    fi
    exec sleep "${MOCK_TUNNEL_SLEEP:-30}"
    ;;
esac
