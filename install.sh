#!/usr/bin/env bash
# install.sh — Einzeiler-Installer
# Aufruf auf dem Proxmox-Host:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/HatchetMan111/VeranstaltungsApp/main/install.sh)"
#
# Klont das Repo, ermittelt die nächste freie CTID und ruft provision-lxc.sh auf.
set -euo pipefail

REPO_URL="https://github.com/HatchetMan111/VeranstaltungsApp.git"
TARGET_DIR="/opt/veranstaltungsapp"

command -v pct >/dev/null 2>&1 || { echo "Muss auf einem Proxmox-Host laufen (pct nicht gefunden)."; exit 1; }
command -v git >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq git; }

echo "Lade Veranstaltungs-App-Vorlage…"
if [[ -d "$TARGET_DIR/.git" ]]; then
  git -C "$TARGET_DIR" pull -q
else
  git clone -q "$REPO_URL" "$TARGET_DIR"
fi
chmod +x "$TARGET_DIR"/*.sh
source "$TARGET_DIR/common.sh"

CTID="$(pvesh get /cluster/nextid)"
read -rp "Hostname für den LXC [veranstaltungsapp-${CTID}]: " HOSTNAME
HOSTNAME="${HOSTNAME:-veranstaltungsapp-${CTID}}"

"$TARGET_DIR/provision-lxc.sh" "$CTID" "$HOSTNAME"

banner "Repo installiert unter $TARGET_DIR" \
  "Der LXC steht, ist aber noch leer — jetzt ein Event befüllen:" \
  "" \
  "  cd $TARGET_DIR" \
  "  cp -r events/beispiel-pferdemarkt events/mein-event" \
  "  # config.json + exhibitors.geojson anpassen, tiles/ befüllen" \
  "  ./deploy-event.sh $CTID events/mein-event" \
  "" \
  "Danach zeigt deploy-event.sh Dashboard-URL, Admin-URL und Zugangsdaten an."
