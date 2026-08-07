#!/usr/bin/env bash
# deploy-event.sh <CTID> <event-ordner>
# Baut die App-Shell + die individuellen Event-Daten zusammen und pusht sie
# in den laufenden LXC. Bei jedem neuen Auftrag: Ordner unter events/ kopieren,
# config.json / exhibitors.geojson / tiles/ anpassen, dieses Skript aufrufen.
set -euo pipefail

CTID="${1:?Usage: ./deploy-event.sh <CTID> <event-ordner>}"
EVENT_DIR="${2:?Usage: ./deploy-event.sh <CTID> <event-ordner>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"

[[ -f "$EVENT_DIR/config.json" ]] || { echo "Fehlt: $EVENT_DIR/config.json"; exit 1; }
[[ -f "$EVENT_DIR/exhibitors.geojson" ]] || { echo "Fehlt: $EVENT_DIR/exhibitors.geojson"; exit 1; }
[[ -d "$EVENT_DIR/tiles" ]] || echo "Warnung: kein tiles/-Ordner in $EVENT_DIR – Karte bleibt ohne Kartenbild."

EVENT_NAME=$(grep -o '"eventName" *: *"[^"]*"' "$EVENT_DIR/config.json" | cut -d'"' -f4)

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cp -r "$APP_DIR"/. "$WORKDIR/"
mkdir -p "$WORKDIR/data" "$WORKDIR/tiles"
cp "$EVENT_DIR/config.json" "$WORKDIR/config.json"
cp "$EVENT_DIR/exhibitors.geojson" "$WORKDIR/data/exhibitors.geojson"
[[ -d "$EVENT_DIR/tiles" ]] && cp -r "$EVENT_DIR/tiles/." "$WORKDIR/tiles/"

sed "s/{{EVENT_NAME}}/$EVENT_NAME/g" "$WORKDIR/manifest.template.json" > "$WORKDIR/manifest.json"
rm "$WORKDIR/manifest.template.json"

pct exec "$CTID" -- rm -rf /var/www/event/*
tar -C "$WORKDIR" -cf - . | pct exec "$CTID" -- tar -C /var/www/event -xf -
pct exec "$CTID" -- systemctl reload nginx

echo "Event '$EVENT_NAME' auf LXC $CTID deployt."
