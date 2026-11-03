#!/usr/bin/env bash
# Arrête le serveur, l’interface Vite, la perception locale et le worker d’images, lancés par
# scripts/start.sh (production) ou scripts/dev.sh (développement).
# Usage : scripts/stop.sh
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

init_dirs
stopped=()
for name in perception frontend backend; do
  pid="$(read_pid "$name")"
  if [ -n "$pid" ] && stop_pid "$pid"; then stopped+=("$name (PID $pid)"); fi
  rm -f "$RUN_DIR/$name.pid"
done

# Processus orphelins : ceux qui écoutent les ports, puis les workers Python.
for port in "$(dev_port)" "$(server_port)"; do
  owner="$(port_owner "$port")"
  if [ -n "$owner" ] && stop_pid "$owner"; then stopped+=("port $port (PID $owner)"); fi
done
for pattern in 'perception/worker.py' 'image_generation/worker.py'; do
  for pid in $(worker_pids "$pattern"); do
    if stop_pid "$pid"; then stopped+=("$pattern (PID $pid)"); fi
  done
done

if [ "${#stopped[@]}" -gt 0 ]; then
  echo "Arrêté : ${stopped[*]}"
else
  echo "Aucun processus Cornelius actif."
fi
