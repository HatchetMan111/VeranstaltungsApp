#!/usr/bin/env bash
# provision-lxc.sh <CTID> <hostname>
# Einmalig auf dem Proxmox-Host ausführen. Legt einen schlanken LXC an,
# installiert nginx als reinen Static-File-Server. Danach als Proxmox-Template
# klonen (siehe README), statt für jedes Event neu zu provisionieren.
set -euo pipefail

CTID="${1:?Usage: ./provision-lxc.sh <CTID> <hostname>}"
HOSTNAME="${2:?Usage: ./provision-lxc.sh <CTID> <hostname>}"

# ponytail: feste Defaults statt Config-Datei für Werte, die sich praktisch nie ändern.
# Bei Bedarf hier direkt anpassen.
STORAGE="local-lvm"
TEMPLATE_FILE="debian-12-standard_12.7-1_amd64.tar.zst"
TEMPLATE="local:vztmpl/${TEMPLATE_FILE}"
BRIDGE="vmbr0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

pct exec "$CTID" -- bash -c "
  apt-get update -qq
  apt-get install -y --no-install-recommends nginx
  rm -f /etc/nginx/sites-enabled/default
  mkdir -p /var/www/event
"

pct push "$CTID" "$SCRIPT_DIR/nginx-event.conf" /etc/nginx/sites-available/event
pct exec "$CTID" -- ln -sf /etc/nginx/sites-available/event /etc/nginx/sites-enabled/event
pct exec "$CTID" -- systemctl reload nginx

IP=""
for i in $(seq 1 15); do
  IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$IP" ]] && break
  sleep 2
done

echo "LXC $CTID ($HOSTNAME) ist bereit."
if [[ -n "$IP" ]]; then
  echo "Dashboard: http://${IP}/"
  echo "Bearbeiten: pct enter $CTID   (Dateien unter /var/www/event)"
else
  echo "Konnte IP nicht automatisch ermitteln, siehe: pct exec $CTID -- hostname -I"
fi
echo "Nächster Schritt: ./deploy-event.sh $CTID events/<eventordner>"
echo "Für Wiederverwendung: pct template $CTID  (danach per 'pct clone' pro neuem Auftrag vervielfältigen)"
