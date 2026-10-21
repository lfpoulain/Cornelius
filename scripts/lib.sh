# Fonctions partagées par les scripts Linux (Debian, Ubuntu, Arch) et macOS de Cornelius.
# Ce fichier se charge avec : . "$(dirname "$0")/lib.sh"
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/data/run"
LOG_DIR="$RUN_DIR/logs"

init_dirs() {
  mkdir -p "$LOG_DIR"
}

# Port du serveur : celui de .env, sinon 3000.
server_port() {
  local port=""
  if [ -f "$ROOT/.env" ]; then
    port="$(sed -n 's/^PORT=\([0-9][0-9]*\).*/\1/p' "$ROOT/.env" | tail -n 1)"
  fi
  echo "${port:-3000}"
}

perception_python() {
  local python="$ROOT/.venv/bin/python"
  if [ -x "$python" ]; then echo "$python"; fi
}

pid_alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

read_pid() {
  cat "$RUN_DIR/$1.pid" 2>/dev/null || true
}

# Lance une commande détachée du terminal ; journaux dans data/run/logs.
start_service() {
  local name="$1"
  shift
  nohup "$@" >"$LOG_DIR/$name.out.log" 2>"$LOG_DIR/$name.err.log" </dev/null &
  echo "$!" >"$RUN_DIR/$name.pid"
  echo "$name lancé (PID $!)."
}

# Arrêt propre (SIGTERM), puis forcé après 5 s : le serveur ferme d’abord la session distante.
stop_pid() {
  local pid="$1"
  pid_alive "$pid" || return 1
  kill -TERM "$pid" 2>/dev/null || true
  local _
  for _ in $(seq 1 50); do
    pid_alive "$pid" || return 0
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
  return 0
}

# Processus qui écoute un port TCP local : ss (iproute2), sinon lsof ou fuser. Vide si aucun
# outil n’est installé ; les fichiers PID suffisent alors.
port_owner() {
  local pid=""
  if command -v ss >/dev/null 2>&1; then
    pid="$(ss -Hltnp "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
  elif command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pid="$(fuser "$1/tcp" 2>/dev/null | tr -s ' ' '\n' | sed -n 's/[^0-9]//g;/./p' | head -n 1 || true)"
  fi
  echo "$pid"
}

# Processus d’un script Python de CETTE installation : le chemin absolu est dans la ligne de
# commande, une autre copie de Cornelius sur la même machine n’est jamais touchée.
worker_pids() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f -- "$ROOT/$1" 2>/dev/null || true
  else
    local entry
    for entry in /proc/[0-9]*/cmdline; do
      if tr '\0' ' ' <"$entry" 2>/dev/null | grep -qF -- "$ROOT/$1"; then
        entry="${entry#/proc/}"
        echo "${entry%/cmdline}"
      fi
    done
  fi
}

# Attend une réponse HTTP (quel que soit son statut) ; Node suffit, sans curl ni wget.
# Avec un PID en troisième argument, renonce dès que ce processus s’arrête.
wait_http() {
  node "$ROOT/scripts/wait-server.mjs" "$1" "${2:-60}" "${3:-}"
}

# Vérifie ce dont le serveur a besoin (Node 24.2, dépendances, .env) ; arrête le script sinon.
check_prerequisites() {
  local problems=()
  if ! command -v node >/dev/null 2>&1; then
    problems+=("Node.js est introuvable dans le PATH : installez Node.js 24 (fichier .nvmrc).")
  elif ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||(a===24&&b>=2)?0:1)'; then
    problems+=("Node.js $(node --version) détecté : Cornelius demande Node.js 24.2 ou plus récent (node:sqlite, --env-file-if-exists). Voir .nvmrc.")
  fi
  [ -f "$ROOT/.env" ] || problems+=("Fichier .env absent : lancez « npm run setup » à la racine du projet.")
  if [ "${#problems[@]}" -gt 0 ]; then
    printf 'Attention : %s\n' "${problems[@]}" >&2
    echo "Cornelius ne peut pas démarrer : corrigez les points ci-dessus puis relancez." >&2
    exit 1
  fi
}

# Dépendances npm complètes et à jour : outils présents, et package-lock.json inchangé depuis la
# dernière installation réussie (npm écrit node_modules/.package-lock.json en dernier).
dependencies_ready() {
  local file
  for file in .package-lock.json tsx/package.json typescript/package.json vite/package.json .bin/tsc; do
    [ -e "$ROOT/node_modules/$file" ] || return 1
  done
  [ ! -f "$ROOT/package-lock.json" ] ||
    [ "$(mtime "$ROOT/package-lock.json")" -le "$(($(mtime "$ROOT/node_modules/.package-lock.json") + 10))" ]
}

# Date de modification en secondes : stat GNU (Linux), sinon stat BSD (macOS).
mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

# Installe les dépendances exactes (npm ci) si elles manquent, sont incomplètes ou ont changé.
sync_dependencies() {
  dependencies_ready && return 0
  command -v npm >/dev/null 2>&1 || { echo "npm est introuvable dans le PATH." >&2; exit 1; }
  echo "Dépendances absentes, incomplètes ou à mettre à jour : installation (npm ci)…"
  "$ROOT/scripts/stop.sh"
  if ! (cd "$ROOT" && npm ci) || ! dependencies_ready; then
    echo "L’installation des dépendances a échoué (npm ci) : supprimez node_modules, puis relancez." >&2
    exit 1
  fi
}

# Affiche la fin des journaux d’un service, pour comprendre un arrêt au démarrage.
show_log_tail() {
  local file
  for file in "$LOG_DIR/$1.err.log" "$LOG_DIR/$1.out.log"; do
    if [ -s "$file" ]; then
      echo "--- $file (fin) ---" >&2
      tail -n 25 "$file" >&2
    fi
  done
}

# Serveur (Fastify) sur le port donné, sauf s’il écoute déjà. Node directement, sans npm : le PID
# suivi est celui du serveur. SERVER_PID reste vide si le serveur tournait déjà.
launch_server() {
  local owner
  SERVER_PID=""
  owner="$(port_owner "$1")"
  if pid_alive "$owner"; then
    echo "Serveur déjà actif sur le port $1 (PID $owner)."
  else
    start_service backend node --env-file-if-exists=.env --import tsx server/index.ts
    SERVER_PID="$(read_pid backend)"
  fi
}

# Perception locale (worker Python de .venv), sauf si elle tourne déjà.
launch_perception() {
  local python
  python="$(perception_python)"
  if [ -z "$python" ]; then
    echo "Python de perception introuvable (.venv). Lancez scripts/install-linux.sh (scripts/install-macos.sh sous macOS)." >&2
  elif [ -n "$(worker_pids 'perception/worker.py')" ]; then
    echo "Perception déjà active (PID $(worker_pids 'perception/worker.py' | tr '\n' ' '))."
  else
    start_service perception "$python" "$ROOT/perception/worker.py"
  fi
}

# Attend /api/health ; en cas d’échec, dit si le serveur s’est arrêté et affiche son journal.
wait_server() {
  local port="$1" timeout="$2" code=0
  if wait_http "http://127.0.0.1:$port/api/health" "$timeout" "${SERVER_PID:-}"; then
    echo "Serveur prêt : http://127.0.0.1:$port"
    return 0
  fi
  if [ -n "${SERVER_PID:-}" ] && ! pid_alive "$SERVER_PID"; then
    wait "$SERVER_PID" 2>/dev/null || code=$?
    echo "Le serveur s’est arrêté au démarrage (code $code)." >&2
  else
    echo "Serveur non confirmé après $timeout s." >&2
  fi
  show_log_tail backend
  echo "Journaux complets : $LOG_DIR" >&2
  return 1
}
