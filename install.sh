#!/usr/bin/env bash
# install.sh — Einzeiler-Installer für die einmalige technische Einrichtung
# Aufruf auf dem Proxmox-Host:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/HatchetMan111/VeranstaltungsApp/main/install.sh)"
#
# Klont das Repo, ermittelt die nächste freie CTID und baut daraus die
# Proxmox-Vorlage (siehe provision-lxc.sh). Danach läuft alles Weitere nur
# noch über die Proxmox-Weboberfläche und den Browser — kein Terminal mehr.
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

CTID="$(pvesh get /cluster/nextid)"
read -rp "Hostname für die Vorlage [veranstaltungsapp-vorlage]: " HOSTNAME
HOSTNAME="${HOSTNAME:-veranstaltungsapp-vorlage}"

"$TARGET_DIR/provision-lxc.sh" "$CTID" "$HOSTNAME"
