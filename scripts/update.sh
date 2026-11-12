#!/usr/bin/env bash
# Met à jour Cornelius installé par git clone, puis le relance.
# Usage : scripts/update.sh [--target COMMIT] [--check]
#   sans --target : dernière version publiée (tag vX.Y.Z) sur main, branche distante sinon
#   --check       : affiche la version proposée sans rien changer
# Lancé aussi par l’administration (« Mettre à jour Cornelius »), avec --from-server.
# Seule une avance rapide est faite : des fichiers modifiés à la main bloquent la mise à jour.
# En cas d’échec, le dépôt revient au commit de départ et Cornelius est relancé.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

# Tout le script est une fonction : bash la lit en entier avant de l’exécuter, alors que la
# mise à jour remplace ce fichier en cours de route.
main() {
target=""
check=0
from_server=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || { echo "Option --target : indiquez un commit." >&2; exit 2; }
      target="$2"
      shift
      ;;
    --check) check=1 ;;
    --from-server) from_server=1 ;;
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --help)" >&2; exit 2 ;;
  esac
  shift
done

init_dirs
cd "$ROOT"
result="$RUN_DIR/update-result.json"
if [ "$from_server" = 1 ]; then
  exec >>"$LOG_DIR/update.log" 2>&1
  echo
  echo "=== Mise à jour du $(date '+%Y-%m-%d %H:%M:%S') ==="
fi

json_text() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n'; }
write_result() {
  printf '{"ok":%s,"message":"%s","at":%s,"from":"%s","to":"%s"}\n' \
    "$1" "$(json_text "$2")" "$(date +%s)" "${3:-}" "${4:-}" >"$result"
}
fail() {
  echo "$1" >&2
  [ "$check" = 1 ] || write_result false "$1" "${old:-}" "${target:-}"
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git est introuvable."
[ -d .git ] || fail "Ce dossier n’est pas un dépôt git : réinstallez avec git clone."
old="$(git rev-parse HEAD)"
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  fail "Des fichiers de Cornelius ont été modifiés à la main : mise à jour annulée (git status)."

git fetch --quiet --tags --force origin || fail "Dépôt de Cornelius injoignable."
branch="$(git symbolic-ref --short -q HEAD || true)"
if [ -z "$target" ]; then
  if [ -z "$branch" ] || [ "$branch" = main ]; then
    tag="$(git for-each-ref --sort=-v:refname --count=1 --format='%(refname:short)' 'refs/tags/v*')"
    [ -n "$tag" ] || fail "Aucune version publiée (tag vX.Y.Z)."
    target="$(git rev-parse "$tag^{commit}")"
  else
    target="$(git rev-parse '@{u}' 2>/dev/null)" ||
      fail "La branche « $branch » ne suit aucune branche distante."
  fi
fi
target="$(git rev-parse --verify --quiet "$target^{commit}")" || fail "Commit introuvable : $target"

if [ "$target" = "$old" ] || git merge-base --is-ancestor "$target" "$old"; then
  echo "Cornelius est déjà à jour ($(git describe --tags --always "$old"))."
  [ "$check" = 1 ] || write_result true "Cornelius est déjà à jour." "$old" "$old"
  exit 0
fi
git merge-base --is-ancestor "$old" "$target" ||
  fail "L’historique local a divergé : mettez à jour à la main (git pull)."

version="$(git show "$target:package.json" | sed -n 's/^  "version": "\(.*\)",$/\1/p' | head -n 1)"
echo "Mise à jour : $(git describe --tags --always "$old") → ${version:-?} ($(git rev-list --count "$old..$target") commits)"
git log --format='  %h %s' -n 15 "$old..$target"
[ "$check" = 0 ] || exit 0

changed="$(git diff --name-only "$old" "$target")"
uses_systemd() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled --quiet cornelius.service 2>/dev/null
}

# Relance Cornelius tel qu’il est installé : services systemd, ou scripts/start.sh.
relaunch() {
  if uses_systemd; then
    if ! dependencies_ready; then npm ci || return 1; fi
    npm run build || return 1
    systemctl --user restart cornelius.service || return 1
    systemctl --user try-restart cornelius-perception.service || true
  else
    "$ROOT/scripts/restart.sh" --build || return 1
  fi
}

apply() {
  if [ -n "$branch" ]; then git merge --ff-only --quiet "$target"; else git checkout --quiet --detach "$target"; fi
  python="$(perception_python)"
  if [ -n "$python" ] && printf '%s\n' "$changed" | grep -q '^perception/requirements.txt$'; then
    echo "Dépendances Python modifiées : installation…"
    requirements="$(mktemp)"
    # Une variante GPU d’ONNX Runtime installée reste en place : la version processeur de
    # requirements.txt l’abîmerait (docs/installation/gpu.md).
    if "$python" -m pip show --quiet onnxruntime >/dev/null 2>&1; then
      cp perception/requirements.txt "$requirements"
    else
      grep -v '^onnxruntime==' perception/requirements.txt >"$requirements"
    fi
    "$python" -m pip install --disable-pip-version-check --quiet -r "$requirements"
    rm -f "$requirements"
  fi
  relaunch
}

if apply; then
  write_result true "Cornelius ${version:-} installé." "$old" "$target"
  echo "Mise à jour terminée."
  exit 0
fi

echo "Échec : retour au commit de départ…" >&2
if [ -n "$branch" ]; then git reset --keep --quiet "$old"; else git checkout --quiet --detach "$old"; fi
relaunch || true
fail "La mise à jour a échoué, Cornelius est revenu à la version précédente (voir data/run/logs/update.log)."
}

main "$@"
