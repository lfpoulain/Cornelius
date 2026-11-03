#!/usr/bin/env bash
# Développement : serveur, interface Vite (port 5173 ou CORNELIUS_DEV_PORT, rechargement à chaud) et perception locale.
# Usage : scripts/dev.sh [--no-frontend] [--no-perception] [--timeout SECONDES]
# Arrêt : scripts/stop.sh. Production (interface compilée, sans Vite) : scripts/start.sh.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

frontend=1
perception=1
timeout=60
while [ $# -gt 0 ]; do
  case "$1" in
    --no-frontend) frontend=0 ;;
    --no-perception) perception=0 ;;
    --timeout)
      [ $# -ge 2 ] || { echo "Option --timeout : indiquez un nombre de secondes." >&2; exit 2; }
      timeout="$2"
      shift
      ;;
    -h | --help) sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --help)" >&2; exit 2 ;;
  esac
  shift
done

init_dirs
cd "$ROOT"
check_prerequisites
sync_dependencies
port="$(server_port)"
web_port="$(dev_port)"

# --- Serveur (Fastify, port de .env) -------------------------------------------------
launch_server "$port"

# --- Interface de développement (Vite, port CORNELIUS_DEV_PORT) ----------------------
if [ "$frontend" = 1 ]; then
  owner="$(port_owner "$web_port")"
  if pid_alive "$owner"; then
    echo "Interface Vite déjà active sur le port $web_port (PID $owner)."
  else
    start_service frontend node node_modules/vite/bin/vite.js --host 127.0.0.1
  fi
fi

# --- Perception locale (worker Python) -----------------------------------------------
if [ "$perception" = 1 ]; then launch_perception; fi

echo
status=0
wait_server "$port" "$timeout" || status=1
if [ "$frontend" = 1 ]; then
  if wait_http "http://127.0.0.1:$web_port/" "$timeout"; then
    echo "Interface prête : http://127.0.0.1:$web_port"
  else
    echo "Interface non confirmée après $timeout s." >&2
    show_log_tail frontend
    status=1
  fi
fi
exit "$status"
