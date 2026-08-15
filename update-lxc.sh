#!/usr/bin/env bash
# update-lxc.sh <CTID>
# Aktualisiert einen bereits laufenden Container auf den aktuellen App-Code aus
# diesem Repo-Checkout. Event-Daten (data/config.json, data/exhibitors.geojson,
# data/program.json, data/admin.json), hochgeladene Bilder (public/uploads) und
# das Kartenkachel-Paket (public/tiles) bleiben unangetastet — nur der
# Anwendungscode wird ersetzt.
#
# Zuerst im lokalen Repo-Checkout `git pull`, dann:
#   ./update-lxc.sh <CTID>
set -euo pipefail

CTID="${1:?Usage: ./update-lxc.sh <CTID>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

pct status "$CTID" &>/dev/null || { echo "LXC $CTID existiert nicht."; exit 1; }

echo "Kopiere aktuellen App-Code (Event-Daten, Bilder und Kacheln bleiben erhalten)…"
tar -C "$SCRIPT_DIR/app" \
  --exclude='./data' \
  --exclude='./public/uploads' \
  --exclude='./public/tiles' \
  -cf - . | pct exec "$CTID" -- tar -C /var/www/event -xf -

pct exec "$CTID" -- bash -c 'cd /var/www/event && npm install --omit=dev --silent'
pct exec "$CTID" -- chown -R appuser:appuser /var/www/event
pct exec "$CTID" -- systemctl restart veranstaltungsapp

sleep 2
STATUS="$(pct exec "$CTID" -- systemctl is-active veranstaltungsapp 2>/dev/null || echo unbekannt)"
IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"

if [[ "$STATUS" == "active" ]]; then
  banner "LXC $CTID aktualisiert" \
    "Dienst läuft: ${STATUS}" \
    "Dashboard: http://${IP}/"
else
  echo "Warnung: Dienst ist nicht aktiv (Status: ${STATUS}). Log prüfen:"
  echo "  pct exec $CTID -- journalctl -u veranstaltungsapp -n 50 --no-pager"
fi
