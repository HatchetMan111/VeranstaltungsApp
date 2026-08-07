const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 80;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const EXHIBITORS_FILE = path.join(DATA_DIR, 'exhibitors.geojson');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// HTTP Basic Auth, zeitkonstanter Passwortvergleich gegen Timing-Angriffe
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded && ADMIN_PASSWORD) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    const userOk = user === ADMIN_USER;
    const passBuf = Buffer.from(pass || '');
    const expectedBuf = Buffer.from(ADMIN_PASSWORD);
    const passOk = passBuf.length === expectedBuf.length && crypto.timingSafeEqual(passBuf, expectedBuf);
    if (userOk && passOk) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  res.status(401).send('Zugriff verweigert.');
}

app.use(express.json());

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

// Besucher-Dashboard: öffentlich, statisch
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Veranstaltungs-App läuft auf Port ${PORT}`));
