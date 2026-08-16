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

- Eventname, Akzentfarbe, Webseite-URL, freier **Beschreibungstext** (Öffnungszeiten, Adresse,
  worum es geht — erscheint auf der Info-Seite der App)
- Logo (App-Icon) und Titelbild (in der Besucher-Info-Ansicht)
- Kartenmitte und Offline-Bereich (Südwest-/Nordost-Ecke) per Klick auf die Karte
- Aussteller **und Orte** (WC, Parkplatz, Erste Hilfe, Bühne, Info-Punkt, Ausgang): hinzufügen
  (auf Karte klicken → Kategorie wählen → Formular ausfüllen), Position ändern, bearbeiten,
  löschen — Orte bekommen eigene Icons auf der Karte und tauchen nicht in der Ausstellerliste auf.
  Aussteller können zusätzlich ein **Bild** und ein **Angebot des Tages** bekommen (Bild-Upload
  erscheint im Formular, sobald der Punkt einmal gespeichert wurde)
- Programm / Angebote des Tages (Uhrzeit, Titel, Beschreibung — unabhängig von einzelnen
  Ausstellern)
- Kartenkacheln für den markierten Bereich **automatisch über MapTiler herunterladen**
  (kostenloser API-Key nötig, siehe unten; Alternative: eigenes ZIP hochladen, falls ein
  individuell gerendertes Kachel-Paket gewünscht ist)
- Admin-Passwort ändern — am besten gleich zu Beginn, bevor die Adresse öffentlich
  (z. B. über Cloudflare) erreichbar gemacht wird

Änderungen wirken **sofort** auf der Besucher-Ansicht — der Service Worker lädt Eventdaten
(Name, Kartenausschnitt, Aussteller, Programm) immer zuerst frisch vom Server und cacht sie nur
als Offline-Fallback. Nur App-Shell, Kacheln und Bilder bleiben Cache-zuerst, weil die sich
praktisch nie ändern. Für die Admin-Karte werden Live-OSM-Kacheln genutzt (Internet
vorausgesetzt); die Besucher-Ansicht läuft weiterhin komplett offline mit dem heruntergeladenen
Tile-Paket.

## Besucher-Ansicht

Untere Navigationsleiste mit vier Tabs: **Karte** (Ausstellerpunkte, POI-Icons für WC/Parkplatz/
Erste Hilfe/etc. und Offline-Kartenausschnitt), **Aussteller** (volle Liste mit ★-Favoriten-Filter,
Tippen zentriert die Karte auf den jeweiligen Stand), **Programm** (Angebote des Tages) und
**Info** (Webseite-Link, Titelbild). Favoriten werden rein lokal im Browser gespeichert, kein
Server-Roundtrip nötig. Alles läuft als installierbare PWA; ein Service Worker cacht App-Shell,
Kacheln und alle einmal geladenen Inhalte automatisch für den Offline-Betrieb.

## Kartenkacheln automatisch laden

Erst einen kostenlosen API-Key auf [maptiler.com](https://www.maptiler.com/) anlegen (keine
Kreditkarte nötig, 100.000 Kachel-Abrufe/Monat frei) und im Dashboard unter „Kartenkacheln“
eintragen. Danach „Kacheln automatisch herunterladen“ klicken, nachdem der Bereich (Südwest-/
Nordost-Ecke) gesetzt ist — Obergrenze 3000 Kacheln pro Anfrage, bei größeren Bereichen
Zoomstufen oder Fläche reduzieren.

**Wichtig:** Die öffentlichen OpenStreetMap-Tile-Server (`tile.openstreetmap.org`) sind
bewusst **nicht** die Quelle — deren Nutzungsbedingungen verbieten automatisiertes
Massen-Laden, die IP wird nach kurzer Zeit gesperrt oder gedrosselt. Das führte in einer
früheren Version genau zu dem Bug, dass höhere Zoomstufen (mehr Kacheln pro Fläche) grau
blieben, weil der Download dort abriss. MapTiler erlaubt Caching für Offline-Nutzung in
eingebetteten Karten ausdrücklich.

Für einen individuell gerenderten Kartenstil bleibt der manuelle ZIP-Upload als Alternative
bestehen (z. B. mit `planetiler` oder `tilemaker` aus einem Geofabrik-Auszug, Struktur
`z/x/y.png`) — dafür ist kein API-Key nötig.

## Bestehenden Container aktualisieren

Wenn sich der App-Code in diesem Repo weiterentwickelt hat (neue Version) und ein schon
laufendes Event-Dashboard das mitbekommen soll:

```bash
cd /opt/veranstaltungsapp   # oder wo das Repo lokal liegt
git pull
./update-lxc.sh 140         # 140 durch die eigene CTID ersetzen (siehe: pct list)
```

Ersetzt nur den Anwendungscode (`server.js`, `public/*.js|css|html`, `admin/*`,
`package.json`), installiert bei Bedarf neue Abhängigkeiten nach und startet den Dienst neu.
Event-Daten, hochgeladene Bilder und das Kartenkachel-Paket bleiben unangetastet. Die CTID
steht in Proxmox (`pct list`) oder in der Ausgabe vom ursprünglichen Anlegen.

## Passwort vergessen?

Einziger Fall, der noch das Terminal braucht:

```bash
pct exec 140 -- cat /var/www/event/data/admin.json   # 140 durch die eigene CTID ersetzen
```

## Cloudflare

Tunnel läuft bereits. Pro Event nur eine neue Ingress-Regel in der bestehenden
`cloudflared`-Config ergänzen (Hostname → interne IP:80 des Containers) plus passenden
DNS-CNAME. Container selbst bleibt auf HTTP, TLS übernimmt Cloudflare an der Edge.

## Architektur

Node.js + Express, ein einziger Prozess (systemd-Service `veranstaltungsapp`, läuft als
unprivilegierter `appuser` mit `cap_net_bind_service` für Port 80). Daten liegen als
`config.json` / `exhibitors.geojson` / `program.json` / `admin.json` auf der Container-Platte,
keine Datenbank. Jeder Container ist unabhängig — kein gemeinsamer Zustand, keine Vorlage, kein
Klonen nötig; `provision-lxc.sh` baut jedes Mal frisch. Nutzergenerierte Texte werden auf der
Besucher-Seite HTML-escaped ausgegeben, Bild-Uploads sind auf echte Bildtypen beschränkt, alte
Dateien werden beim Ersetzen/Löschen automatisch aufgeräumt.

## Dimensionierung

1 vCPU, 512 MB RAM, 4 GB Disk. Bei 1.000–2.000 Besuchern über einen Tag großzügig bemessen —
die Last ist ein kurzer Download-Peak (App-Shell + Kacheln einmalig pro Gerät), kein
Dauerbetrieb mit hoher Schreiblast.
