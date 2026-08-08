#!/usr/bin/env bash
# provision-lxc.sh <CTID> <hostname>
# Erstellt einen laufenden LXC mit der fertigen App, startet den Dienst und
# gibt am Ende IP + generierte Admin-Zugangsdaten aus. Für jedes neue Event
# einfach mit einer neuen CTID erneut aufrufen (oder den Einzeiler aus der
# README, der die nächste freie CTID automatisch ermittelt).
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

echo "Kopiere App-Code…"
tar -C "$SCRIPT_DIR/app" -cf - . | pct exec "$CTID" -- tar -C /var/www/event -xf -
pct exec "$CTID" -- bash -c 'cd /var/www/event && npm install --omit=dev --silent'
pct exec "$CTID" -- chown -R appuser:appuser /var/www/event

pct push "$CTID" "$SCRIPT_DIR/veranstaltungsapp.service" /etc/systemd/system/veranstaltungsapp.service
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable -q veranstaltungsapp
pct exec "$CTID" -- systemctl start veranstaltungsapp

echo "Warte auf ersten Start…"
ADMIN_JSON=""
for i in $(seq 1 15); do
  ADMIN_JSON="$(pct exec "$CTID" -- cat /var/www/event/data/admin.json 2>/dev/null || true)"
  [[ -n "$ADMIN_JSON" ]] && break
  sleep 2
done

IP=""
for i in $(seq 1 15); do
  IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$IP" ]] && break
  sleep 2
done

if [[ -n "$ADMIN_JSON" ]]; then
  ADMIN_USER="$(echo "$ADMIN_JSON" | grep -o '"username" *: *"[^"]*"' | cut -d'"' -f4)"
  ADMIN_PASS="$(echo "$ADMIN_JSON" | grep -o '"password" *: *"[^"]*"' | cut -d'"' -f4)"
else
  ADMIN_USER="admin"
  ADMIN_PASS="(Dienst noch nicht bereit — Zugangsdaten stehen auf der Startseite im Browser)"
fi

banner "LXC $CTID ($HOSTNAME) ist live" \
  "Dashboard:  http://${IP}/" \
  "Admin:      http://${IP}/admin" \
  "Login:      ${ADMIN_USER} / ${ADMIN_PASS}" \
  "" \
  "Direkt im Browser öffnen und das Event einrichten — Name, Farbe," \
  "Kartenbereich, Aussteller, Kacheln (ZIP-Upload) und Passwort" \
  "alles im Admin-Dashboard, kein Terminal mehr nötig."
