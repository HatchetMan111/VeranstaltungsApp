const CACHE = 'event-cache-v10';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', '/manifest.json',
  'vendor/leaflet.js', 'vendor/leaflet.css',
  'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png',
  '/api/config', '/api/exhibitors', '/api/program'
];
// Diese Endpunkte ändern sich, sobald im Dashboard etwas bearbeitet wird — deshalb
// Netzwerk zuerst, Cache nur als Offline-Fallback. Alles andere (App-Shell, Kacheln,
// Bilder) ändert sich praktisch nie und bleibt Cache-zuerst für schnelles Offline-Laden.
const NETWORK_FIRST_PATHS = ['/api/config', '/api/exhibitors', '/api/program'];

// Standard Slippy-Map-Kachelmathematik: Lat/Lng-Grenzen -> Kachel-Indizes
function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2tile(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z);
}

async function tileUrls() {
  const config = await (await fetch('/api/config')).json();
  const [[latA, lonA], [latB, lonB]] = config.bounds;
  const south = Math.min(latA, latB), north = Math.max(latA, latB);
  const west = Math.min(lonA, lonB), east = Math.max(lonA, lonB);
  const minZ = config.minZoom || 15, maxZ = config.maxZoom || 19;
  const urls = [];
  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lon2tile(west, z), xMax = lon2tile(east, z);
    const yMin = lat2tile(north, z), yMax = lat2tile(south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        urls.push(`tiles/${z}/${x}/${y}.png`);
      }
    }
  }
  return urls;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const tiles = await tileUrls();
    // ponytail: fehlende/nicht vorhandene Kachel wird stillschweigend übersprungen,
    // damit ein einzelnes Loch im Tile-Paket nicht den gesamten Precache abbrechen lässt
    await Promise.all(tiles.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isNetworkFirst = NETWORK_FIRST_PATHS.includes(url.pathname);
  event.respondWith(isNetworkFirst ? networkFirst(event.request) : cacheFirst(event.request));
});
