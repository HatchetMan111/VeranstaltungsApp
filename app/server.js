const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 80;

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const EXHIBITORS_FILE = path.join(DATA_DIR, 'exhibitors.geojson');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const TILES_DIR = path.join(__dirname, 'public', 'tiles');
const UPLOAD_DIR = '/tmp/veranstaltungsapp-uploads';

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Beim allerersten Start (frisch geklonter Container) Standarddaten anlegen,
// inkl. eines zufälligen Admin-Passworts. Das macht jeden Klon der Proxmox-
// Vorlage sofort eigenständig nutzbar, ohne dass von außen etwas gepusht
// werden muss.
function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(TILES_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_FILE)) {
    writeJSON(CONFIG_FILE, {
      eventName: 'Neues Event',
      accentColor: '#c9822b',
      center: [51.1657, 10.4515],
      defaultZoom: 6,
      minZoom: 15,
      maxZoom: 19,
      bounds: [[51.1557, 10.4415], [51.1757, 10.4615]],
      setupComplete: false
    });
  }
  if (!fs.existsSync(EXHIBITORS_FILE)) {
    writeJSON(EXHIBITORS_FILE, { type: 'FeatureCollection', features: [] });
  }
  if (!fs.existsSync(ADMIN_FILE)) {
    writeJSON(ADMIN_FILE, { username: 'admin', password: crypto.randomBytes(6).toString('hex') });
  }
}
ensureData();

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const admin = readJSON(ADMIN_FILE);
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    const passBuf = Buffer.from(pass || '');
    const expectedBuf = Buffer.from(admin.password || '');
    const userOk = user === admin.username;
    const passOk = passBuf.length > 0 && passBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(passBuf, expectedBuf);
    if (userOk && passOk) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  res.status(401).send('Zugriff verweigert.');
}

function setupPageHtml(username, password) {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ersteinrichtung</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:3rem auto;padding:0 1.2rem;color:#1a1a1a}
  h1{font-size:1.3rem}
  .box{background:#f7f2e7;border:1px solid #e0d5b8;border-radius:8px;padding:1rem 1.2rem;margin:1.2rem 0}
  code{background:#fff;padding:.15rem .4rem;border-radius:4px;font-size:1.05rem}
  a.button{display:inline-block;margin-top:1rem;background:#c9822b;color:#fff;text-decoration:none;padding:.7rem 1.2rem;border-radius:6px}
  footer{margin-top:2rem;font-size:.75rem;color:#888}
</style></head>
<body>
  <h1>Ersteinrichtung</h1>
  <p>Dieses Event ist noch nicht eingerichtet. Zugangsdaten fürs Admin-Dashboard:</p>
  <div class="box">
    Benutzername: <code>${username}</code><br>
    Passwort: <code>${password}</code>
  </div>
  <p>Bitte notieren und im Dashboard unter „Sicherheit“ ein eigenes Passwort setzen — am besten
     bevor die Adresse öffentlich (z. B. über Cloudflare) erreichbar gemacht wird.</p>
  <a class="button" href="/admin">Zum Admin-Dashboard →</a>
  <footer>Umgesetzt von LichtValleyApps</footer>
</body></html>`;
}

app.use(express.json());

// Ersteinrichtungs-Seite, solange noch nichts konfiguriert wurde
app.get('/', (req, res, next) => {
  const cfg = readJSON(CONFIG_FILE);
  if (!cfg.setupComplete) {
    const admin = readJSON(ADMIN_FILE);
    return res.send(setupPageHtml(admin.username, admin.password));
  }
  next();
});

// Öffentliche, lesende API für die Besucher-Karte (auch offline-gecacht via Service Worker)
app.get('/api/config', (req, res) => res.json(readJSON(CONFIG_FILE)));
app.get('/api/exhibitors', (req, res) => res.json(readJSON(EXHIBITORS_FILE)));

// PWA-Manifest wird live aus der aktuellen Konfiguration erzeugt
app.get('/manifest.json', (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  res.json({
    name: cfg.eventName,
    short_name: cfg.eventName,
    start_url: './index.html',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: cfg.accentColor || '#c9822b',
    icons: [
      { src: '/vendor/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/vendor/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
});

// Admin-Oberfläche: erst Auth, dann statisch ausliefern
app.use('/admin', requireAuth, express.static(path.join(__dirname, 'admin')));

// Schreibende API, nur mit Auth
app.put('/api/config', requireAuth, (req, res) => {
  const cfg = req.body;
  if (!cfg || !cfg.eventName || !Array.isArray(cfg.center) || !Array.isArray(cfg.bounds)) {
    return res.status(400).json({ error: 'eventName, center und bounds sind Pflicht.' });
  }
  cfg.setupComplete = true;
  writeJSON(CONFIG_FILE, cfg);
  res.json({ ok: true });
});

app.post('/api/exhibitors', requireAuth, (req, res) => {
  const { name, description, lat, lng } = req.body;
  if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'name, lat und lng sind Pflicht.' });
  }
  const geo = readJSON(EXHIBITORS_FILE);
  const feature = {
    type: 'Feature',
    properties: { id: crypto.randomUUID(), name, description: description || '' },
    geometry: { type: 'Point', coordinates: [lng, lat] }
  };
  geo.features.push(feature);
  writeJSON(EXHIBITORS_FILE, geo);
  res.status(201).json(feature);
});

app.put('/api/exhibitors/:id', requireAuth, (req, res) => {
  const geo = readJSON(EXHIBITORS_FILE);
  const feature = geo.features.find((f) => f.properties.id === req.params.id);
  if (!feature) return res.status(404).json({ error: 'Nicht gefunden.' });
  const { name, description, lat, lng } = req.body;
  if (name) feature.properties.name = name;
  if (description !== undefined) feature.properties.description = description;
  if (typeof lat === 'number' && typeof lng === 'number') feature.geometry.coordinates = [lng, lat];
  writeJSON(EXHIBITORS_FILE, geo);
  res.json(feature);
});

app.delete('/api/exhibitors/:id', requireAuth, (req, res) => {
  const geo = readJSON(EXHIBITORS_FILE);
  const before = geo.features.length;
  geo.features = geo.features.filter((f) => f.properties.id !== req.params.id);
  if (geo.features.length === before) return res.status(404).json({ error: 'Nicht gefunden.' });
  writeJSON(EXHIBITORS_FILE, geo);
  res.json({ ok: true });
});

// Admin-Passwort im Dashboard änderbar, kein Dateizugriff nötig
app.put('/api/admin/password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Neues Passwort braucht mindestens 8 Zeichen.' });
  }
  const admin = readJSON(ADMIN_FILE);
  admin.password = newPassword;
  writeJSON(ADMIN_FILE, admin);
  res.json({ ok: true });
});

// Kartenkacheln als ZIP hochladen statt per Datei-Push von außen
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 200 * 1024 * 1024 } });

app.post('/api/tiles', requireAuth, upload.single('tiles'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten.' });
  execFile('unzip', ['-o', req.file.path, '-d', TILES_DIR], (err) => {
    fs.unlink(req.file.path, () => {});
    if (err) return res.status(500).json({ error: 'Entpacken fehlgeschlagen — ist es eine gültige ZIP-Datei?' });
    res.json({ ok: true });
  });
});

// Besucher-Dashboard: öffentlich, statisch
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Veranstaltungs-App läuft auf Port ${PORT}`));
