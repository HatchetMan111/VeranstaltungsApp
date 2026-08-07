#!/usr/bin/env bash
# deploy-event.sh <CTID> <event-ordner> [admin-passwort]
# Baut App-Code + individuelle Event-Daten zusammen, pusht sie in den LXC,
# installiert Abhängigkeiten und (neu-)startet den Dienst. Ohne drittes
# Argument wird ein zufälliges Admin-Passwort erzeugt und am Ende angezeigt.
set -euo pipefail

CTID="${1:?Usage: ./deploy-event.sh <CTID> <event-ordner> [admin-passwort]}"
EVENT_DIR="${2:?Usage: ./deploy-event.sh <CTID> <event-ordner> [admin-passwort]}"
ADMIN_PASSWORD="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
source "$SCRIPT_DIR/common.sh"

[[ -f "$EVENT_DIR/config.json" ]] || { echo "Fehlt: $EVENT_DIR/config.json"; exit 1; }
[[ -f "$EVENT_DIR/exhibitors.geojson" ]] || { echo "Fehlt: $EVENT_DIR/exhibitors.geojson"; exit 1; }
[[ -d "$EVENT_DIR/tiles" ]] || echo "Warnung: kein tiles/-Ordner in $EVENT_DIR – Besucher-Karte bleibt ohne Kartenbild."

[[ -n "$ADMIN_PASSWORD" ]] || ADMIN_PASSWORD="$(openssl rand -base64 12)"

EVENT_NAME=$(grep -o '"eventName" *: *"[^"]*"' "$EVENT_DIR/config.json" | cut -d'"' -f4)

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cp -r "$APP_DIR"/. "$WORKDIR/"
mkdir -p "$WORKDIR/data" "$WORKDIR/public/tiles"
cp "$EVENT_DIR/config.json" "$WORKDIR/data/config.json"
cp "$EVENT_DIR/exhibitors.geojson" "$WORKDIR/data/exhibitors.geojson"
[[ -d "$EVENT_DIR/tiles" ]] && cp -r "$EVENT_DIR/tiles/." "$WORKDIR/public/tiles/"

pct exec "$CTID" -- systemctl stop veranstaltungsapp 2>/dev/null || true
pct exec "$CTID" -- bash -c 'rm -rf /var/www/event/* /var/www/event/.[!.]* 2>/dev/null || true'
tar -C "$WORKDIR" -cf - . | pct exec "$CTID" -- tar -C /var/www/event -xf -
pct exec "$CTID" -- bash -c 'cd /var/www/event && npm install --omit=dev --silent'
pct exec "$CTID" -- chown -R appuser:appuser /var/www/event

pct exec "$CTID" -- bash -c "cat > /etc/veranstaltungsapp.env" << EOF
ADMIN_USER=admin
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PORT=80
EOF
pct exec "$CTID" -- chmod 600 /etc/veranstaltungsapp.env
pct exec "$CTID" -- systemctl restart veranstaltungsapp

IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"

banner "Event '${EVENT_NAME}' ist live" \
  "Dashboard (Besucher):  http://${IP}/" \
  "Admin (Bearbeiten):    http://${IP}/admin" \
  "Login:                 admin / ${ADMIN_PASSWORD}" \
  "" \
  "Passwort jetzt notieren – wird nicht erneut angezeigt. Neu setzen:" \
  "  ./deploy-event.sh $CTID $EVENT_DIR <neues-passwort>"
