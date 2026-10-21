#!/usr/bin/env bash
# Installe Cornelius sur macOS (Mac à puce Apple : M1 ou plus récent).
#
# Usage : scripts/install-macos.sh [options]
#   --system-deps         installe git, Node.js 24 et Python 3.12 avec Homebrew
#   --wake                installe le mot d’appel local (openWakeWord)
#   --no-models           ne télécharge pas les modèles (visages, voix, vision 450m)
#   --no-build            ne compile pas l’interface
#   --launchd             installe et démarre les services launchd (serveur, perception)
#   -h, --help            affiche cette aide
#
# Le script est rejouable : il garde .env, l’environnement Python et les modèles déjà vérifiés.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

system_deps=0
wake=0
models=1
build=1
launchd=0
while [ $# -gt 0 ]; do
  case "$1" in
    --system-deps) system_deps=1 ;;
    --wake) wake=1 ;;
    --no-models) models=0 ;;
    --no-build) build=0 ;;
    --launchd) launchd=1 ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --help)" >&2; exit 2 ;;
  esac
  shift
done

# Version de uv utilisée seulement si Python 3.12 manque au système.
UV_VERSION=0.12.23
# Préfixe des services launchd (~/Library/LaunchAgents).
LABEL=fr.cornelius

step() { printf '\n== %s\n' "$1"; }
warn() { printf 'Attention : %s\n' "$1" >&2; }
die() { printf 'Erreur : %s\n' "$1" >&2; exit 1; }

cd "$ROOT"
init_dirs

# --- Système --------------------------------------------------------------------------
[ "$(uname -s)" = Darwin ] || die "ce script est réservé à macOS (Linux : scripts/install-linux.sh)."
# ONNX Runtime 1.30 et PyTorch 2.9 ne publient plus de version pour les Mac Intel.
[ "$(uname -m)" = arm64 ] || die "Cornelius demande un Mac à puce Apple (M1 ou plus récent)."
echo "macOS $(sw_vers -productVersion) ($(uname -m))."

brew_bin="$(command -v brew || true)"
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -z "$brew_bin" ] && [ -x "$candidate" ]; then brew_bin="$candidate"; fi
done
if [ -n "$brew_bin" ]; then
  # Node.js 24 et Python 3.12 de Homebrew sont « keg-only » : ils ne sont pas dans le PATH.
  for formula in node@24 python@3.12; do
    prefix="$("$brew_bin" --prefix "$formula" 2>/dev/null || true)"
    if [ -n "$prefix" ] && [ -d "$prefix/bin" ]; then PATH="$prefix/bin:$PATH"; fi
  done
  export PATH
fi

if [ "$system_deps" = 1 ]; then
  step "Paquets Homebrew"
  [ -n "$brew_bin" ] || die "Homebrew est absent : installez-le depuis https://brew.sh puis relancez."
  "$brew_bin" install git node@24 python@3.12
  for formula in node@24 python@3.12; do
    PATH="$("$brew_bin" --prefix "$formula")/bin:$PATH"
  done
  export PATH
fi

# --- Node.js 24 (fichier .nvmrc) -----------------------------------------------------
step "Node.js"
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a===24&&b>=2?0:1)'
}
if ! node_ok && command -v fnm >/dev/null 2>&1; then
  fnm install "$(cat .nvmrc)" && eval "$(fnm env)" && fnm use "$(cat .nvmrc)"
fi
if ! node_ok && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm install && nvm use
fi
if ! node_ok; then
  die "Node.js 24.2 ou plus récent (version 24) est requis, voir .nvmrc. Avec Homebrew :
  brew install node@24
ou relancez ce script avec --system-deps."
fi
NODE_BIN="$(node -p 'process.execPath')"
echo "Node $(node --version) : $NODE_BIN"

step "Dépendances Node et configuration"
npm ci
npm run setup
if [ "$build" = 1 ]; then npm run build; fi

# --- Python 3.12 pour la perception -------------------------------------------------------
step "Python 3.12 (perception)"
venv_is_312() {
  .venv/bin/python -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)'
}
if [ -x .venv/bin/python ]; then
  # Un environnement existant est gardé : le supprimer reste un choix explicite.
  venv_is_312 || warn ".venv n’utilise pas Python 3.12 (version validée) ; supprimez-le pour le recréer."
else
  if command -v python3.12 >/dev/null 2>&1; then
    python3.12 -m venv .venv
  else
    # Sans Python 3.12 (Homebrew ou python.org), uv installe un Python 3.12 autonome.
    uv_bin="$(command -v uv || true)"
    if [ -z "$uv_bin" ]; then
      command -v python3 >/dev/null 2>&1 ||
        die "Python 3 est introuvable : brew install python@3.12, ou relancez avec --system-deps."
      python3 -m venv .local/uv
      .local/uv/bin/python -m pip install --quiet "uv==$UV_VERSION"
      uv_bin="$ROOT/.local/uv/bin/uv"
    fi
    "$uv_bin" venv --seed --python 3.12 .venv
  fi
fi
[ -x .venv/bin/python ] || die "impossible de créer .venv avec Python 3.12."
.venv/bin/python -m pip install --disable-pip-version-check --quiet --upgrade pip
.venv/bin/python -m pip install --disable-pip-version-check -r perception/requirements.txt

# Sur Mac, ONNX Runtime n’a pas de fournisseur GPU pris en charge par Cornelius : la vision
# locale tourne sur le processeur (graphes q4), les puces Apple s’en sortent bien.
step "Vision locale : moteur ONNX"
echo "Vision sur le CPU (graphes q4)."

if [ "$models" = 1 ]; then
  step "Modèles locaux (vérifiés par SHA-256)"
  .venv/bin/python perception/download_models.py --device auto
fi

if [ "$wake" = 1 ]; then
  step "Mot d’appel local"
  .venv/bin/python -m pip install --disable-pip-version-check -r perception/requirements-wake.txt
  .venv/bin/python -m pip install --disable-pip-version-check --no-deps openwakeword==0.6.0
  .venv/bin/python perception/install_wake_features.py
  [ -f models/cornelius.onnx ] || warn "placez le modèle du mot d’appel dans models/cornelius.onnx (docs/fonctionnalites/mot-d-appel.md)."
fi

# --- Caméra ---------------------------------------------------------------------------------
step "Caméra"
if cameras="$(.venv/bin/python -c 'from cv2_enumerate_cameras import enumerate_cameras
import cv2
print(", ".join(c.name for c in enumerate_cameras(cv2.CAP_AVFOUNDATION)))' 2>/dev/null)"; then
  if [ -n "$cameras" ]; then echo "Caméras : $cameras"; else warn "aucune caméra détectée."; fi
else
  warn "la liste des caméras n’a pas pu être lue (PyObjC AVFoundation)."
fi
echo "macOS demande l’accès à la caméra au premier démarrage de la perception : acceptez-le."
echo "Sinon : Réglages Système → Confidentialité et sécurité → Caméra."

# --- Services launchd (agents utilisateur) ---------------------------------------------
if [ "$launchd" = 1 ]; then
  step "Services launchd (utilisateur)"
  agents="$HOME/Library/LaunchAgents"
  mkdir -p "$agents"
  domain="gui/$(id -u)"
  # Échappement XML des chemins (un dossier peut contenir & ou <).
  xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
  # agent NOM DESCRIPTION PROGRAMME [ARGUMENTS…]
  agent() {
    local name="$1" description="$2" argument
    shift 2
    {
      cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL.$name</string>
  <!-- $description -->
  <key>ProgramArguments</key>
  <array>
PLIST
      for argument in "$@"; do printf '    <string>%s</string>\n' "$(xml "$argument")"; done
      cat <<PLIST
  </array>
  <key>WorkingDirectory</key><string>$(xml "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>3</integer>
  <key>ExitTimeOut</key><integer>20</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG_DIR/$name.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_DIR/$name.err.log")</string>
</dict>
</plist>
PLIST
    } >"$agents/$LABEL.$name.plist"
    launchctl bootout "$domain/$LABEL.$name" 2>/dev/null || true
    launchctl bootstrap "$domain" "$agents/$LABEL.$name.plist"
  }
  # Anciens services d’abord (launchd les relancerait), puis une instance de scripts/start.sh :
  # elle occuperait le port des services.
  launchctl bootout "$domain/$LABEL.perception" 2>/dev/null || true
  launchctl bootout "$domain/$LABEL.server" 2>/dev/null || true
  "$ROOT/scripts/stop.sh"
  agent server "Cornelius, serveur du miroir" \
    "$NODE_BIN" --env-file-if-exists=.env --import tsx server/index.ts
  agent perception "Cornelius, perception locale (caméra, voix, vision)" \
    "$ROOT/.venv/bin/python" "$ROOT/perception/worker.py"
  echo "Services actifs. Journaux : $LOG_DIR"
fi

step "Terminé"
port="$(server_port)"
echo "Administration : http://127.0.0.1:$port/admin (mot de passe dans .env, à changer)."
grep -q '^OPENAI_API_KEY=.' .env || echo "Renseignez OPENAI_API_KEY dans .env pour la conversation."
[ "$launchd" = 1 ] || echo "Démarrage : scripts/start.sh (arrêt : scripts/stop.sh), ou relancez avec --launchd."
