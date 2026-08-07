#!/usr/bin/env bash
# provision-lxc.sh <CTID> <hostname>
# Einmalig auf dem Proxmox-Host ausführen. Legt einen schlanken LXC an,
# installiert Node.js und richtet den Systemd-Service ein. Der Service wird
# nur aktiviert, nicht gestartet — das passiert erst mit dem ersten
# ./deploy-event.sh, wenn tatsächlich Daten und Admin-Passwort vorhanden sind.
# Danach als Proxmox-Template klonen (siehe README) statt für jedes Event neu
# zu provisionieren.
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
  apt-get install -y -qq --no-install-recommends nodejs npm
  id -u appuser &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin appuser
  setcap "cap_net_bind_service=+ep" "$(readlink -f "$(command -v node)")"
  mkdir -p /var/www/event
  chown -R appuser:appuser /var/www/event
'

pct push "$CTID" "$SCRIPT_DIR/veranstaltungsapp.service" /etc/systemd/system/veranstaltungsapp.service
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable -q veranstaltungsapp

IP=""
for i in $(seq 1 15); do
  IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$IP" ]] && break
  sleep 2
done

banner "LXC $CTID ($HOSTNAME) ist bereit" \
  "Läuft noch nicht — der Service startet erst mit dem ersten Deploy." \
  "" \
  "Nächster Schritt:" \
  "  cd $SCRIPT_DIR && ./deploy-event.sh $CTID events/<eventordner>" \
  "" \
  "Für Wiederverwendung als Vorlage:" \
  "  pct template $CTID   (danach per 'pct clone' pro Auftrag vervielfältigen)"
