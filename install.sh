#!/usr/bin/env bash
# install.sh — Einzeiler
# Aufruf auf dem Proxmox-Host, für jedes neue Event erneut ausführbar:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/HatchetMan111/VeranstaltungsApp/main/install.sh)"
#
# Klont/aktualisiert das Repo, ermittelt die nächste freie CTID und ruft
# provision-lxc.sh auf. Am Ende steht eine laufende, im Browser erreichbare
# Instanz mit eigenen Zugangsdaten.
set -euo pipefail

REPO_URL="https://github.com/HatchetMan111/VeranstaltungsApp.git"
TARGET_DIR="/opt/veranstaltungsapp"

command -v pct >/dev/null 2>&1 || { echo "Muss auf einem Proxmox-Host laufen (pct nicht gefunden)."; exit 1; }
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }

echo "Lade Veranstaltungs-App…"
if [[ -d "$TARGET_DIR/.git" ]]; then
  git -C "$TARGET_DIR" pull -q
else
  git clone -q "$REPO_URL" "$TARGET_DIR"
fi
chmod +x "$TARGET_DIR"/*.sh

CTID="$(pvesh get /cluster/nextid)"
read -rp "Hostname für dieses Event [veranstaltungsapp-${CTID}]: " HOSTNAME
HOSTNAME="${HOSTNAME:-veranstaltungsapp-${CTID}}"

"$TARGET_DIR/provision-lxc.sh" "$CTID" "$HOSTNAME"
