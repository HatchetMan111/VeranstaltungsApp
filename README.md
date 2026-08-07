# Event-Aussteller-Karte – LXC-Vorlage

Offline-fähige PWA mit Karte + Ausstellerliste für Tagesevents (z. B. Pferdemärkte),
plus ein geschütztes **Admin-Dashboard**, über das sich Eventname, Farbe, Kartenausschnitt
und alle Aussteller direkt im Browser bearbeiten lassen — keine Dateibearbeitung per SSH
mehr nötig.

## Einzeiler-Install (Proxmox-Host)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/HatchetMan111/VeranstaltungsApp/main/install.sh)"
```

Klont das Repo nach `/opt/veranstaltungsapp`, lädt bei Bedarf das Debian-12-Template,
legt den LXC mit der nächsten freien CTID an und installiert Node.js darin. Fragt nur
nach dem Hostnamen. Der Dienst läuft danach noch **nicht** — das ist Absicht, siehe unten.

## Manuell: LXC anlegen

Falls das Repo bereits lokal liegt (z. B. schon mal per Einzeiler installiert):

```bash
./provision-lxc.sh 150 pferdemarkt-template
```

## Pro Auftrag: Event individualisieren

1. Ordner kopieren: `cp -r events/beispiel-pferdemarkt events/<neuer-auftrag>`
2. `config.json` anpassen: Eventname, Farbe, Kartenmittelpunkt, `bounds` (Süd/West, Nord/Ost) —
   das sind nur die Startwerte, alles Weitere läuft über das Admin-Dashboard
3. `exhibitors.geojson` optional mit Startdaten befüllen (kann auch leer bleiben und komplett
   über das Dashboard gepflegt werden)
4. `tiles/` mit den Kartenkacheln für genau den `bounds`-Ausschnitt befüllen (siehe unten)
5. Deployen:

```bash
./deploy-event.sh 151 events/<neuer-auftrag>
```

Am Ende erscheint eine deutlich hervorgehobene Zusammenfassung:

```
✔ Event 'Pferdemarkt Musterstadt 2026' ist live
────────────────────────────────────────────────────
  Dashboard (Besucher):  http://192.168.1.42/
  Admin (Bearbeiten):    http://192.168.1.42/admin
  Login:                 admin / xK9mP2qLtR7w

  Passwort jetzt notieren – wird nicht erneut angezeigt. Neu setzen:
    ./deploy-event.sh 151 events/<neuer-auftrag> <neues-passwort>
────────────────────────────────────────────────────
```

## Admin-Dashboard

Unter `/admin` (HTTP-Basic-Auth, Login siehe oben) lässt sich bearbeiten:

- Eventname und Akzentfarbe
- Kartenmitte und der Offline-Bereich (Südwest-/Nordost-Ecke) per Klick auf die Karte
- Aussteller: hinzufügen (auf Karte klicken → Formular ausfüllen), Position ändern,
  Name/Beschreibung bearbeiten, löschen

Änderungen wirken sofort auf der Besucher-Karte — kein erneutes Deployen nötig. Für die
Admin-Karte werden Live-OSM-Kacheln genutzt (Internet vorausgesetzt); die Besucher-Karte
läuft weiterhin komplett offline mit dem vorbereiteten Tile-Paket.

## Kartenkacheln erzeugen (nicht Teil dieses Pakets)

Für den `bounds`-Ausschnitt einmalig ein kleines Tile-Paket rendern, z. B. mit `planetiler`
oder `tilemaker` aus einem Geofabrik-Auszug, Zoomstufen 15–19, Ausgabe als PNG-Kacheln
unter `tiles/{z}/{x}/{y}.png`. Öffentliche OSM-Tile-Server nicht direkt einbinden/cachen
(verstößt gegen deren Nutzungsbedingungen) – immer selbst rendern.

## Cloudflare

Tunnel läuft bereits. Nur eine neue Ingress-Regel in der bestehenden `cloudflared`-Config
ergänzen (Hostname → interne IP:80 des LXC) plus passenden DNS-CNAME. Container selbst
bleibt auf HTTP, TLS übernimmt Cloudflare an der Edge.

## Architektur

Node.js + Express, ein einziger Prozess (systemd-Service `veranstaltungsapp`, läuft als
unprivilegierter `appuser` mit `cap_net_bind_service` für Port 80). Daten liegen als
`config.json` / `exhibitors.geojson` auf der Container-Platte, keine Datenbank. Kein nginx
mehr nötig — Express liefert Besucher-Seite, Admin-Dashboard und API aus einem Prozess.

## Dimensionierung

1 vCPU, 512 MB RAM, 4 GB Disk. Bei 1.000–2.000 Besuchern über einen Tag großzügig bemessen —
die Last ist ein kurzer Download-Peak (App-Shell + Kacheln einmalig pro Gerät), kein
Dauerbetrieb mit hoher Schreiblast.
