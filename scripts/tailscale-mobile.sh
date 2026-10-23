#!/usr/bin/env bash
# Prepare the mobile-only Tailscale Serve ingress. No credentials are printed.
set -euo pipefail
mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]]; then
  echo 'Usage: scripts/tailscale-mobile.sh [--dry-run|--apply]' >&2
  exit 2
fi
command -v tailscale >/dev/null || { echo 'Installez/connectez Tailscale sur cet hôte.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3 est nécessaire pour vérifier la configuration.' >&2; exit 1; }
mobile_status="$(tailscale status --json | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("Self") or {}; state=d.get("BackendState"); name=(s.get("DNSName") or "").rstrip("."); print(name if state=="Running" and name.endswith(".ts.net") else "")')"
if [[ -z "$mobile_status" ]]; then
  echo 'Connectez Tailscale dans son interface, puis relancez ce guide.' >&2
  exit 1
fi
printf 'Adresse à configurer : CORNELIUS_MOBILE_REMOTE_URL=https://%s\n' "$mobile_status"
echo 'Entrée dédiée requise : http://127.0.0.1:3444 ; sous Docker, publier 127.0.0.1:3444:3444.'
echo 'Commande préparée : tailscale serve --bg --https=443 http://127.0.0.1:3444'
if [[ "$mode" == "--apply" ]]; then
  mobile_serve="$(tailscale serve status --json)"
  if ! python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if not d else 1)' <<< "$mobile_serve"; then
    echo 'Une configuration Serve existe déjà. Préservez-la et ajoutez manuellement un endpoint mobile distinct.' >&2
    exit 1
  fi
  tailscale serve --bg --https=443 http://127.0.0.1:3444
fi
