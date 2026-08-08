# Event-Aussteller-Karte

Offline-fähige PWA mit Karte + Ausstellerliste für Tagesevents (z. B. Pferdemärkte).
Ein Befehl erstellt einen laufenden Container und zeigt am Ende IP und Admin-Zugangsdaten —
alles Weitere läuft im Browser über das Admin-Dashboard, kein Datei-Editieren oder `cd` mehr
nötig.

## Neues Event anlegen

Auf der Proxmox-Host-Shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/HatchetMan111/VeranstaltungsApp/main/install.sh)"
```

Fragt nur nach einem Hostnamen, erstellt einen Container mit der nächsten freien CTID,
installiert Node.js, kopiert die App hinein und startet sie. Am Ende erscheint eine
hervorgehobene Zusammenfassung:

```
✔ LXC 138 (pferdemarkt-musterstadt) ist live
────────────────────────────────────────────────────
  Dashboard:  http://192.168.1.42/
  Admin:      http://192.168.1.42/admin
  Login:      admin / 1a4f348e4dc4

  Direkt im Browser öffnen und das Event einrichten — Name, Farbe,
  Kartenbereich, Aussteller, Kacheln (ZIP-Upload) und Passwort
  alles im Admin-Dashboard, kein Terminal mehr nötig.
────────────────────────────────────────────────────
```

Für ein weiteres Event einfach den Einzeiler erneut ausführen — jeder Aufruf legt einen
eigenen, unabhängigen Container mit eigenen Zugangsdaten an.

Falls das Repo schon lokal liegt, geht es auch direkt ohne erneutes Klonen:

```bash
./provision-lxc.sh 139 naechstes-event
```

## Admin-Dashboard

Unter `http://<IP>/admin` (Login siehe Ausgabe oben) lässt sich bearbeiten:

- Eventname und Akzentfarbe
- Kartenmitte und Offline-Bereich (Südwest-/Nordost-Ecke) per Klick auf die Karte
- Aussteller: hinzufügen (auf Karte klicken → Formular ausfüllen), Position ändern,
  Name/Beschreibung bearbeiten, löschen
- Kartenkacheln als ZIP hochladen (siehe unten, wie die entstehen)
- Admin-Passwort ändern — am besten gleich zu Beginn, bevor die Adresse öffentlich
  (z. B. über Cloudflare) erreichbar gemacht wird

Änderungen wirken sofort auf der Besucher-Karte. Für die Admin-Karte werden Live-OSM-Kacheln
genutzt (Internet vorausgesetzt); die Besucher-Karte läuft weiterhin komplett offline mit dem
hochgeladenen Tile-Paket.

## Kartenkacheln erzeugen (externer, einmaliger Schritt pro Event)

Für den im Dashboard markierten Kartenausschnitt ein kleines Tile-Paket rendern, z. B. mit
`planetiler` oder `tilemaker` aus einem Geofabrik-Auszug, Zoomstufen 15–19, PNG-Kacheln in der
Struktur `z/x/y.png`. Als ZIP packen (Wurzel des ZIP = die `z`-Ordner direkt) und im
Admin-Dashboard hochladen. Öffentliche OSM-Tile-Server nicht direkt einbinden/cachen (verstößt
gegen deren Nutzungsbedingungen) — immer selbst rendern.

## Passwort vergessen?

Einziger Fall, der noch das Terminal braucht:

```bash
pct exec <CTID> -- cat /var/www/event/data/admin.json
```

## Cloudflare

Tunnel läuft bereits. Pro Event nur eine neue Ingress-Regel in der bestehenden
`cloudflared`-Config ergänzen (Hostname → interne IP:80 des Containers) plus passenden
DNS-CNAME. Container selbst bleibt auf HTTP, TLS übernimmt Cloudflare an der Edge.

## Architektur

Node.js + Express, ein einziger Prozess (systemd-Service `veranstaltungsapp`, läuft als
unprivilegierter `appuser` mit `cap_net_bind_service` für Port 80). Daten liegen als
`config.json` / `exhibitors.geojson` / `admin.json` auf der Container-Platte, keine Datenbank.
Jeder Container ist unabhängig — kein gemeinsamer Zustand, keine Vorlage, kein Klonen nötig;
`provision-lxc.sh` baut jedes Mal frisch.

## Dimensionierung

1 vCPU, 512 MB RAM, 4 GB Disk. Bei 1.000–2.000 Besuchern über einen Tag großzügig bemessen —
die Last ist ein kurzer Download-Peak (App-Shell + Kacheln einmalig pro Gerät), kein
Dauerbetrieb mit hoher Schreiblast.
