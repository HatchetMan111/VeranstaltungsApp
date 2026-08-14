const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFile } = require('child_process');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 80;

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const EXHIBITORS_FILE = path.join(DATA_DIR, 'exhibitors.geojson');
const PROGRAM_FILE = path.join(DATA_DIR, 'program.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const TILES_DIR = path.join(__dirname, 'public', 'tiles');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const TMP_UPLOAD_DIR = '/tmp/veranstaltungsapp-uploads';

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Beim allerersten Start (frisch erstellter Container) Standarddaten anlegen,
// inkl. eines zufälligen Admin-Passworts.
function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(TILES_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_FILE)) {
    writeJSON(CONFIG_FILE, {
      eventName: 'Neues Event',
      accentColor: '#c9822b',
      websiteUrl: '',
      infoText: '',
      logoUrl: '',
      headerImageUrl: '',
      galleryImages: [],
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
  if (!fs.existsSync(PROGRAM_FILE)) {
    writeJSON(PROGRAM_FILE, { items: [] });
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

// Bild-Uploads (Branding + pro Aussteller) teilen sich diese multer-Instanz — nur echte Bilder
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const brandingUpload = multer({
  dest: TMP_UPLOAD_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, IMAGE_MIME_TYPES.includes(file.mimetype))
});

// Hilfsfunktion: eine zuvor hochgeladene Datei unter /uploads/ wieder entfernen
// (z. B. beim Ersetzen eines Logos oder Löschen eines Ausstellers) — verhindert,
// dass sich über eine Saison mit vielen Events verwaiste Dateien ansammeln.
function deleteUploadedFile(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  fs.unlink(path.join(UPLOADS_DIR, path.basename(url)), () => {});
}

// Ersteinrichtungs-Seite, solange noch nichts konfiguriert wurde
app.get('/', (req, res, next) => {
  const cfg = readJSON(CONFIG_FILE);
  if (!cfg.setupComplete) {
    const admin = readJSON(ADMIN_FILE);
    return res.send(setupPageHtml(admin.username, admin.password));
  }
  next();
});

// Öffentliche, lesende API für die Besucher-Ansicht (auch offline-gecacht via Service Worker)
app.get('/api/config', (req, res) => res.json(readJSON(CONFIG_FILE)));
app.get('/api/exhibitors', (req, res) => res.json(readJSON(EXHIBITORS_FILE)));
app.get('/api/program', (req, res) => res.json(readJSON(PROGRAM_FILE)));

// PWA-Manifest wird live aus der aktuellen Konfiguration erzeugt
app.get('/manifest.json', (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  const icon = cfg.logoUrl || '/vendor/images/marker-icon.png';
  res.json({
    name: cfg.eventName,
    short_name: cfg.eventName,
    start_url: './index.html',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: cfg.accentColor || '#c9822b',
    icons: [
      { src: icon, sizes: '192x192', type: 'image/png' },
      { src: icon, sizes: '512x512', type: 'image/png' }
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
  const current = readJSON(CONFIG_FILE);
  cfg.setupComplete = true;
  cfg.logoUrl = cfg.logoUrl || current.logoUrl || '';
  cfg.headerImageUrl = cfg.headerImageUrl || current.headerImageUrl || '';
  cfg.galleryImages = Array.isArray(cfg.galleryImages) ? cfg.galleryImages : (current.galleryImages || []);
  writeJSON(CONFIG_FILE, cfg);
  res.json({ ok: true });
});

const KNOWN_CATEGORIES = ['aussteller', 'wc', 'parkplatz', 'erste-hilfe', 'buehne', 'info', 'ausgang'];
function normalizeCategory(cat) {
  return KNOWN_CATEGORIES.includes(cat) ? cat : 'aussteller';
}

app.post('/api/exhibitors', requireAuth, (req, res) => {
  const { name, description, lat, lng, category, offer, website, phone, branche } = req.body;
  if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'name, lat und lng sind Pflicht.' });
  }
  const geo = readJSON(EXHIBITORS_FILE);
  const feature = {
    type: 'Feature',
    properties: {
      id: crypto.randomUUID(), name, description: description || '',
      category: normalizeCategory(category), offer: offer || '', imageUrl: '',
      logoUrl: '', website: website || '', phone: phone || '', branche: branche || ''
    },
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
  const { name, description, lat, lng, category, offer, website, phone, branche } = req.body;
  if (name) feature.properties.name = name;
  if (description !== undefined) feature.properties.description = description;
  if (category !== undefined) feature.properties.category = normalizeCategory(category);
  if (offer !== undefined) feature.properties.offer = offer;
  if (website !== undefined) feature.properties.website = website;
  if (phone !== undefined) feature.properties.phone = phone;
  if (branche !== undefined) feature.properties.branche = branche;
  if (typeof lat === 'number' && typeof lng === 'number') feature.geometry.coordinates = [lng, lat];
  writeJSON(EXHIBITORS_FILE, geo);
  res.json(feature);
});

// Bild pro Aussteller/Ort hochladen
app.post('/api/exhibitors/:id/image', requireAuth, brandingUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten oder ungültiger Dateityp (nur Bilder erlaubt).' });
  const geo = readJSON(EXHIBITORS_FILE);
  const feature = geo.features.find((f) => f.properties.id === req.params.id);
  if (!feature) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Nicht gefunden.' }); }
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const filename = `exhibitor-${req.params.id}-${Date.now()}${ext}`;
  fs.renameSync(req.file.path, path.join(UPLOADS_DIR, filename));
  deleteUploadedFile(feature.properties.imageUrl);
  feature.properties.imageUrl = `/uploads/${filename}`;
  writeJSON(EXHIBITORS_FILE, geo);
  res.json({ ok: true, url: feature.properties.imageUrl });
});

// Firmenlogo pro Aussteller (separat vom Hauptbild) hochladen
app.post('/api/exhibitors/:id/logo', requireAuth, brandingUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten oder ungültiger Dateityp (nur Bilder erlaubt).' });
  const geo = readJSON(EXHIBITORS_FILE);
  const feature = geo.features.find((f) => f.properties.id === req.params.id);
  if (!feature) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Nicht gefunden.' }); }
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const filename = `exhibitor-logo-${req.params.id}-${Date.now()}${ext}`;
  fs.renameSync(req.file.path, path.join(UPLOADS_DIR, filename));
  deleteUploadedFile(feature.properties.logoUrl);
  feature.properties.logoUrl = `/uploads/${filename}`;
  writeJSON(EXHIBITORS_FILE, geo);
  res.json({ ok: true, url: feature.properties.logoUrl });
});

app.delete('/api/exhibitors/:id', requireAuth, (req, res) => {
  const geo = readJSON(EXHIBITORS_FILE);
  const toDelete = geo.features.find((f) => f.properties.id === req.params.id);
  const before = geo.features.length;
  geo.features = geo.features.filter((f) => f.properties.id !== req.params.id);
  if (geo.features.length === before) return res.status(404).json({ error: 'Nicht gefunden.' });
  writeJSON(EXHIBITORS_FILE, geo);
  if (toDelete) { deleteUploadedFile(toDelete.properties.imageUrl); deleteUploadedFile(toDelete.properties.logoUrl); }
  res.json({ ok: true });
});

// Sortiert nach tatsächlicher Uhrzeit (Minuten seit Mitternacht), nicht alphabetisch —
// sonst landet "9:00" hinter "14:00". Punkte ohne/mit unlesbarer Zeit rutschen ans Ende.
function timeToMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  if (!m) return Infinity;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function sortProgram(items) {
  items.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

// Programm / Angebote des Tages
app.post('/api/program', requireAuth, (req, res) => {
  const { time, title, description, lat, lng } = req.body;
  if (!title) return res.status(400).json({ error: 'title ist Pflicht.' });
  const program = readJSON(PROGRAM_FILE);
  const item = {
    id: crypto.randomUUID(), time: time || '', title, description: description || '',
    lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null,
    imageUrl: ''
  };
  program.items.push(item);
  sortProgram(program.items);
  writeJSON(PROGRAM_FILE, program);
  res.status(201).json(item);
});

app.put('/api/program/:id', requireAuth, (req, res) => {
  const program = readJSON(PROGRAM_FILE);
  const item = program.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nicht gefunden.' });
  const { time, title, description, lat, lng } = req.body;
  if (title) item.title = title;
  if (time !== undefined) item.time = time;
  if (description !== undefined) item.description = description;
  if (typeof lat === 'number' && typeof lng === 'number') { item.lat = lat; item.lng = lng; }
  sortProgram(program.items);
  writeJSON(PROGRAM_FILE, program);
  res.json(item);
});

// Bild pro Programmpunkt hochladen
app.post('/api/program/:id/image', requireAuth, brandingUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten oder ungültiger Dateityp (nur Bilder erlaubt).' });
  const program = readJSON(PROGRAM_FILE);
  const item = program.items.find((i) => i.id === req.params.id);
  if (!item) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Nicht gefunden.' }); }
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const filename = `program-${req.params.id}-${Date.now()}${ext}`;
  fs.renameSync(req.file.path, path.join(UPLOADS_DIR, filename));
  deleteUploadedFile(item.imageUrl);
  item.imageUrl = `/uploads/${filename}`;
  writeJSON(PROGRAM_FILE, program);
  res.json({ ok: true, url: item.imageUrl });
});

app.delete('/api/program/:id', requireAuth, (req, res) => {
  const program = readJSON(PROGRAM_FILE);
  const toDelete = program.items.find((i) => i.id === req.params.id);
  const before = program.items.length;
  program.items = program.items.filter((i) => i.id !== req.params.id);
  if (program.items.length === before) return res.status(404).json({ error: 'Nicht gefunden.' });
  writeJSON(PROGRAM_FILE, program);
  if (toDelete) deleteUploadedFile(toDelete.imageUrl);
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

// Logo/Header-Bild hochladen
function saveBrandingImage(req, res, configField) {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten oder ungültiger Dateityp (nur Bilder erlaubt).' });
  const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
  const filename = `${configField}-${Date.now()}${ext}`;
  fs.renameSync(req.file.path, path.join(UPLOADS_DIR, filename));
  const cfg = readJSON(CONFIG_FILE);
  deleteUploadedFile(cfg[configField]);
  cfg[configField] = `/uploads/${filename}`;
  writeJSON(CONFIG_FILE, cfg);
  res.json({ ok: true, url: cfg[configField] });
}

app.post('/api/branding/logo', requireAuth, brandingUpload.single('image'), (req, res) => {
  saveBrandingImage(req, res, 'logoUrl');
});
app.post('/api/branding/header', requireAuth, brandingUpload.single('image'), (req, res) => {
  saveBrandingImage(req, res, 'headerImageUrl');
});

// Galerie für die Info-Seite: beliebig viele Bilder, einzeln hinzu-/entfernbar
app.post('/api/branding/gallery', requireAuth, brandingUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten oder ungültiger Dateityp (nur Bilder erlaubt).' });
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const filename = `gallery-${Date.now()}${ext}`;
  fs.renameSync(req.file.path, path.join(UPLOADS_DIR, filename));
  const cfg = readJSON(CONFIG_FILE);
  cfg.galleryImages = Array.isArray(cfg.galleryImages) ? cfg.galleryImages : [];
  const url = `/uploads/${filename}`;
  cfg.galleryImages.push(url);
  writeJSON(CONFIG_FILE, cfg);
  res.json({ ok: true, url, galleryImages: cfg.galleryImages });
});

app.delete('/api/branding/gallery', requireAuth, (req, res) => {
  const { url } = req.body;
  const cfg = readJSON(CONFIG_FILE);
  cfg.galleryImages = (cfg.galleryImages || []).filter((u) => u !== url);
  writeJSON(CONFIG_FILE, cfg);
  deleteUploadedFile(url);
  res.json({ ok: true, galleryImages: cfg.galleryImages });
});

// Kartenkacheln: manueller ZIP-Upload …
const tileUpload = multer({
  dest: TMP_UPLOAD_DIR,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.originalname.toLowerCase().endsWith('.zip'))
});

app.post('/api/tiles', requireAuth, tileUpload.single('tiles'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten oder keine ZIP-Datei.' });
  execFile('unzip', ['-o', req.file.path, '-d', TILES_DIR], (err) => {
    fs.unlink(req.file.path, () => {});
    if (err) return res.status(500).json({ error: 'Entpacken fehlgeschlagen — ist es eine gültige ZIP-Datei?' });
    res.json({ ok: true });
  });
});

// … oder automatischer Download direkt für den im Dashboard markierten Bereich
function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2tile(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z);
}
function tileList(bounds, minZ, maxZ) {
  const [[south, west], [north, east]] = bounds;
  const tiles = [];
  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lon2tile(west, z), xMax = lon2tile(east, z);
    const yMin = lat2tile(north, z), yMax = lat2tile(south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) tiles.push([z, x, y]);
    }
  }
  return tiles;
}
function downloadTile(z, x, y) {
  return new Promise((resolve, reject) => {
    const dir = path.join(TILES_DIR, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${y}.png`);
    const subdomain = ['a', 'b', 'c'][(x + y) % 3];
    const url = `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'VeranstaltungsApp-LichtValleyApps/1.0 (+https://lichtvalleyapps.de)' } }, (res) => {
      if (res.statusCode !== 200) { file.close(); fs.unlink(dest, () => {}); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => { file.close(); fs.unlink(dest, () => {}); reject(err); });
  });
}

app.post('/api/tiles/download', requireAuth, async (req, res) => {
  const cfg = readJSON(CONFIG_FILE);
  const minZ = cfg.minZoom || 15, maxZ = cfg.maxZoom || 19;
  const tiles = tileList(cfg.bounds, minZ, maxZ);

  if (tiles.length === 0) {
    return res.status(400).json({ error: 'Kein Kartenbereich gesetzt — erst Südwest-/Nordost-Ecke im Dashboard markieren.' });
  }
  if (tiles.length > 3000) {
    return res.status(400).json({ error: `Bereich zu groß (${tiles.length} Kacheln). Kartenausschnitt verkleinern oder Zoomstufen reduzieren.` });
  }

  let downloaded = 0, failed = 0;
  for (const [z, x, y] of tiles) {
    try { await downloadTile(z, x, y); downloaded++; } catch { failed++; }
    await new Promise((r) => setTimeout(r, 40)); // fair zur öffentlichen OSM-Kachelinfrastruktur
  }

  if (downloaded === 0) {
    return res.status(502).json({
      error: 'Keine Kachel konnte geladen werden — hat der Container Internetzugriff nach außen?',
      downloaded, failed, total: tiles.length
    });
  }
  res.json({ ok: true, downloaded, failed, total: tiles.length });
});

// Besucher-Ansicht: öffentlich, statisch
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Veranstaltungs-App läuft auf Port ${PORT}`));
