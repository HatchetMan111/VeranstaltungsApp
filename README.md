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

- Eventname, Akzentfarbe, Webseite-URL
- Logo (App-Icon) und Titelbild (in der Besucher-Info-Ansicht)
- Kartenmitte und Offline-Bereich (Südwest-/Nordost-Ecke) per Klick auf die Karte
- Aussteller: hinzufügen (auf Karte klicken → Formular ausfüllen), Position ändern,
  Name/Beschreibung bearbeiten, löschen
- Programm / Angebote des Tages (Uhrzeit, Titel, Beschreibung — unabhängig von einzelnen
  Ausstellern)
- Kartenkacheln für den markierten Bereich **automatisch von OpenStreetMap herunterladen**
  (Alternative: eigenes ZIP hochladen, falls ein individuell gerendertes Kachel-Paket
  gewünscht ist)
- Admin-Passwort ändern — am besten gleich zu Beginn, bevor die Adresse öffentlich
  (z. B. über Cloudflare) erreichbar gemacht wird

Änderungen wirken sofort auf der Besucher-Ansicht. Für die Admin-Karte werden Live-OSM-Kacheln
genutzt (Internet vorausgesetzt); die Besucher-Ansicht läuft weiterhin komplett offline mit dem
heruntergeladenen Tile-Paket.

## Besucher-Ansicht

Untere Navigationsleiste mit vier Tabs: **Karte** (Ausstellerpunkte + Offline-Kartenausschnitt),
**Aussteller** (volle Liste, Tippen zentriert die Karte auf den jeweiligen Stand), **Programm**
(Angebote des Tages) und **Info** (Webseite-Link, Titelbild). Alles läuft als installierbare PWA;
ein Service Worker cacht App-Shell, Kacheln und alle einmal geladenen Inhalte (auch Logo/Bilder)
automatisch für den Offline-Betrieb.

## Kartenkacheln automatisch laden

Im Dashboard einfach „Kacheln automatisch herunterladen“ klicken, nachdem der Bereich (Südwest-/
Nordost-Ecke) gesetzt ist. Der Server lädt die passenden Kacheln direkt von den öffentlichen
OpenStreetMap-Tile-Servern (mit eigenem User-Agent, moderatem Tempo, Obergrenze 3000 Kacheln pro
Anfrage — bei größeren Bereichen Zoomstufen oder Fläche reduzieren). Für einen individuell
gerenderten Kartenstil bleibt der manuelle ZIP-Upload als Alternative bestehen (z. B. mit
`planetiler` oder `tilemaker` aus einem Geofabrik-Auszug, Struktur `z/x/y.png`).

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
