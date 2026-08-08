# Event-Aussteller-Karte – Proxmox-Vorlage

Offline-fähige PWA mit Karte + Ausstellerliste für Tagesevents (z. B. Pferdemärkte).
Alles bis auf die einmalige technische Einrichtung läuft über den Browser: Proxmox-
Weboberfläche zum Klonen, Admin-Dashboard zum Befüllen. Kein Terminal, kein `cd /opt/...`
pro Event.

## 1. Einmalige technische Einrichtung (nur einmal, Terminal)

Auf der Proxmox-Host-Shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/HatchetMan111/VeranstaltungsApp/main/install.sh)"
```

Das lädt das Repo, baut einen Container mit der fertigen App darin, fragt nur nach einem
Hostnamen für die Vorlage — und wandelt den Container am Ende automatisch in eine
**Proxmox-Vorlage** um. Dieser Schritt passiert nur einmal, beim Aufbau des Produkts, nicht
pro Kunde/Event.

## 2. Pro Event (nur Browser, kein Terminal)

1. In der Proxmox-Weboberfläche die Vorlage **rechtsklicken → Klonen**, Namen vergeben,
   klonen
2. Geklonten Container **starten**
3. Im Reiter „Übersicht“ des Containers die IP-Adresse ablesen, im Browser öffnen
4. Es erscheint eine **Ersteinrichtungs-Seite** mit dem generierten Admin-Login
5. Im Admin-Dashboard (`/admin`, Login von Schritt 4) alles Weitere einrichten:
   - Eventname, Akzentfarbe
   - Kartenmitte und Offline-Bereich (Südwest-/Nordost-Ecke) per Klick auf die Karte
   - Aussteller hinzufügen (auf Karte klicken → Formular), Position ändern, bearbeiten, löschen
   - Kartenkacheln als ZIP hochladen (siehe unten, wie die entstehen)
   - Eigenes Passwort setzen — **bevor** die Adresse öffentlich (z. B. über Cloudflare)
     erreichbar gemacht wird, da die Ersteinrichtungs-Seite das Startpasswort offen anzeigt

Änderungen wirken sofort auf der Besucher-Karte. Für die Admin-Karte werden Live-OSM-Kacheln
genutzt (Internet vorausgesetzt); die Besucher-Karte läuft weiterhin komplett offline mit dem
hochgeladenen Tile-Paket.

## Kartenkacheln erzeugen (externer, einmaliger Schritt pro Event)

Für den im Dashboard markierten Kartenausschnitt ein kleines Tile-Paket rendern, z. B. mit
`planetiler` oder `tilemaker` aus einem Geofabrik-Auszug, Zoomstufen 15–19, PNG-Kacheln in der
Struktur `z/x/y.png`. Das Ganze als ZIP packen (Wurzel des ZIP = die `z`-Ordner direkt) und im
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
unprivilegierter `appuser` mit `cap_net_bind_service` für Port 80). Der App-Code inkl.
`node_modules` steckt schon in der Proxmox-Vorlage — Klonen dauert Sekunden, kein `npm install`
pro Event. Daten liegen als `config.json` / `exhibitors.geojson` / `admin.json` auf der
Container-Platte, keine Datenbank. Jeder frisch gestartete Klon erzeugt beim allerersten Start
eigene Daten inkl. eines zufälligen Admin-Passworts — deshalb wird der Dienst beim Bau der
Vorlage aktiviert, aber nie gestartet.

## Dimensionierung

1 vCPU, 512 MB RAM, 4 GB Disk. Bei 1.000–2.000 Besuchern über einen Tag großzügig bemessen —
die Last ist ein kurzer Download-Peak (App-Shell + Kacheln einmalig pro Gerät), kein
Dauerbetrieb mit hoher Schreiblast.
