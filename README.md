# Event-Aussteller-Karte – LXC-Vorlage

Offline-fähige PWA mit Karte + Ausstellerliste für Tagesevents (z. B. Pferdemärkte).
Pro Auftrag wird nur `config.json`, `exhibitors.geojson` und der `tiles/`-Ordner
ausgetauscht – die App selbst bleibt gleich.

## Einmalig: LXC anlegen

```bash
./provision-lxc.sh 150 pferdemarkt-template
```

Danach als Proxmox-Vorlage sichern, um pro neuem Auftrag schnell zu klonen:

```bash
pct template 150
pct clone 150 151 --hostname pferdemarkt-musterstadt
```

## Pro Auftrag: Event individualisieren

1. Ordner kopieren: `cp -r events/beispiel-pferdemarkt events/<neuer-auftrag>`
2. `config.json` anpassen: Eventname, Farbe, Kartenmittelpunkt, `bounds` (Süd/West, Nord/Ost)
3. `exhibitors.geojson` mit den echten Ständen befüllen (Name, Beschreibung, Koordinaten)
4. `tiles/` mit den Kartenkacheln für genau den `bounds`-Ausschnitt befüllen (siehe unten)
5. `vendor/icon-192.png` / `icon-512.png` im Eventordner ablegen, falls ein eigenes Logo gewünscht ist – sonst bleiben die Standard-Icons
6. Deployen:

```bash
./deploy-event.sh 151 events/<neuer-auftrag>
```

Der Service Worker liest `bounds`/`minZoom`/`maxZoom` aus `config.json` und cacht beim ersten
Laden automatisch genau die dazu passenden Kacheln – kein manuelles Kachel-Manifest nötig.

## Kartenkacheln erzeugen (nicht Teil dieses Pakets)

Für den `bounds`-Ausschnitt einmalig ein kleines Tile-Paket rendern, z. B. mit `planetiler`
oder `tilemaker` aus einem Geofabrik-Auszug, Zoomstufen 15–19, Ausgabe als PNG-Kacheln
unter `tiles/{z}/{x}/{y}.png`. Öffentliche OSM-Tile-Server nicht direkt einbinden/cachen
(verstößt gegen deren Nutzungsbedingungen) – immer selbst rendern.

## Cloudflare

Tunnel läuft bereits. Nur eine neue Ingress-Regel in der bestehenden `cloudflared`-Config
ergänzen (Hostname → interne IP:80 des LXC) plus passenden DNS-CNAME. Container selbst
bleibt auf HTTP, TLS übernimmt Cloudflare an der Edge.

## Dimensionierung

1 vCPU, 512 MB RAM, 4 GB Disk – reiner Static-File-Server, kein Backend, keine Datenbank.
Bei 1.000–2.000 Besuchern über einen Tag großzügig bemessen.
