#!/usr/bin/env bash
# provision-lxc.sh <CTID> <hostname>
# Einmalige technische Einrichtung auf dem Proxmox-Host. Baut die Vorlage:
# Node.js installieren, App-Code hineinkopieren, npm install, Dienst
# aktivieren (nicht starten!) — und wandelt den Container danach automatisch
# in eine Proxmox-Vorlage um. Ab dann läuft jedes Event ausschließlich über
# die Proxmox-Weboberfläche (Klonen) und das Admin-Dashboard im Browser.
# Kein CLI-Zugriff mehr pro Event nötig.
set -euo pipefail

CTID="${1:?Usage: ./provision-lxc.sh <CTID> <hostname>}"
HOSTNAME="${2:?Usage: ./provision-lxc.sh <CTID> <hostname>}"

STORAGE="local-lvm"
TEMPLATE_FILE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE="local:vztmpl/${TEMPLATE_FILE}"
BRIDGE="vmbr0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

if ! pveam list local 2>/dev/null | grep -q "$TEMPLATE_FILE"; then
  echo "Debian-12-Template fehlt, lade herunter…"
  pveam update -q
  pveam download local "$TEMPLATE_FILE"
fi

pct create "$CTID" "$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --cores 1 \
  --memory 512 \
  --swap 512 \
  --rootfs "${STORAGE}:4" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --unprivileged 1 \
  --features nesting=0 \
  --start 1

sleep 5  # kurz warten, bis Netzwerk im Container steht

pct exec "$CTID" -- bash -c '
  set -e
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends nodejs npm unzip
  id -u appuser &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin appuser
  setcap "cap_net_bind_service=+ep" "$(readlink -f "$(command -v node)")"
  mkdir -p /var/www/event
'

echo "Kopiere App-Code in die Vorlage…"
tar -C "$SCRIPT_DIR/app" -cf - . | pct exec "$CTID" -- tar -C /var/www/event -xf -
pct exec "$CTID" -- bash -c 'cd /var/www/event && npm install --omit=dev --silent'
pct exec "$CTID" -- chown -R appuser:appuser /var/www/event

pct push "$CTID" "$SCRIPT_DIR/veranstaltungsapp.service" /etc/systemd/system/veranstaltungsapp.service
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable -q veranstaltungsapp

# Bewusst NICHT starten: Der Dienst legt beim ersten echten Start pro
# geklontem Container eigene Daten inkl. zufälligem Admin-Passwort an.
# Würde er hier schon laufen, würden alle Klone dasselbe Passwort erben.

echo "Wandle Container in Proxmox-Vorlage um…"
pct stop "$CTID"
sleep 2
pct template "$CTID"

banner "Vorlage $CTID ($HOSTNAME) ist fertig" \
  "Ab jetzt läuft jedes Event komplett über die Proxmox-Weboberfläche:" \
  "" \
  "  1. Vorlage $CTID rechtsklicken → Klonen → Namen vergeben → Klonen" \
  "  2. Geklonten Container starten" \
  "  3. IP im Reiter „Übersicht“ des Containers ablesen, im Browser öffnen" \
  "  4. Zugangsdaten stehen direkt auf der Startseite (Ersteinrichtung)" \
  "" \
  "Kein Terminal mehr nötig — Name, Farbe, Kartenbereich, Aussteller," \
  "Kacheln (ZIP-Upload) und Passwort werden alle im Admin-Dashboard gepflegt."
