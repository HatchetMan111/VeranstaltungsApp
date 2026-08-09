(async function () {
  const CATEGORY_ICONS = { wc: '🚻', parkplatz: '🅿️', 'erste-hilfe': '⛑️', buehne: '🎪', info: 'ℹ️', ausgang: '🚪' };
  const FAVORITES_KEY = 'event-favorites';

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
  }
  function isFavorite(id) { return getFavorites().includes(id); }
  function toggleFavorite(id) {
    const favs = getFavorites();
    const idx = favs.indexOf(id);
    if (idx === -1) favs.push(id); else favs.splice(idx, 1);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  }

  function iconFor(category) {
    if (!category || category === 'aussteller') return undefined; // Standard-Leaflet-Pin
    const emoji = CATEGORY_ICONS[category] || '📍';
    return L.divIcon({ className: 'poi-icon', html: `<span>${emoji}</span>`, iconSize: [30, 30] });
  }

  const config = await (await fetch('/api/config')).json();

  document.documentElement.style.setProperty('--accent', config.accentColor || '#c9822b');
  document.getElementById('event-title').textContent = config.eventName || 'Event-Karte';
  document.title = config.eventName || 'Event-Karte';

  if (config.logoUrl) {
    const logo = document.getElementById('event-logo');
    logo.src = config.logoUrl;
    logo.hidden = false;
  }

  // Karte
  const map = L.map('map', { zoomControl: true }).setView(config.center, config.defaultZoom || 17);
  L.tileLayer('tiles/{z}/{x}/{y}.png', {
    minZoom: config.minZoom || 15,
    maxZoom: config.maxZoom || 19,
    bounds: L.latLngBounds(config.bounds),
    attribution: '© OpenStreetMap-Mitwirkende'
  }).addTo(map);

  // Aussteller + POIs: Marker auf der Karte, volle Liste (nur Kategorie "Aussteller") im Tab
  const geo = await (await fetch('/api/exhibitors')).json();
  const fullList = document.getElementById('exhibitor-list-full');
  const markers = new Map();
  let showFavoritesOnly = false;

  geo.features.forEach((feature) => {
    const p = feature.properties || {};
    const [lng, lat] = feature.geometry.coordinates;
    const opts = iconFor(p.category);
    const marker = opts ? L.marker([lat, lng], { icon: opts }) : L.marker([lat, lng]);
    marker.bindPopup(`<strong>${p.name || 'Aussteller'}</strong>${p.description ? `<br>${p.description}` : ''}`);
    marker.addTo(map);
    markers.set(p.id, marker);
  });

  function renderExhibitorList() {
    fullList.innerHTML = '';
    geo.features
      .filter((f) => !f.properties.category || f.properties.category === 'aussteller')
      .filter((f) => !showFavoritesOnly || isFavorite(f.properties.id))
      .forEach((feature) => {
        const p = feature.properties;
        const marker = markers.get(p.id);
        const li = document.createElement('li');

        const textWrap = document.createElement('div');
        textWrap.innerHTML = `<strong>${p.name}</strong>${p.description ? `<br><span>${p.description}</span>` : ''}`;
        textWrap.addEventListener('click', () => {
          showView('map');
          map.setView(marker.getLatLng(), config.maxZoom || 19);
          marker.openPopup();
        });

        const star = document.createElement('button');
        star.className = 'fav-btn' + (isFavorite(p.id) ? ' active' : '');
        star.textContent = isFavorite(p.id) ? '★' : '☆';
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFavorite(p.id);
          renderExhibitorList();
        });

        li.appendChild(textWrap);
        li.appendChild(star);
        fullList.appendChild(li);
      });
  }
  renderExhibitorList();

  document.getElementById('favorites-toggle').addEventListener('click', (e) => {
    showFavoritesOnly = !showFavoritesOnly;
    e.target.classList.toggle('active', showFavoritesOnly);
    e.target.textContent = showFavoritesOnly ? '★ Alle anzeigen' : '☆ Nur Favoriten';
    renderExhibitorList();
  });

  // Programm
  const program = await (await fetch('/api/program')).json();
  const programList = document.getElementById('program-list');
  program.items.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `${item.time ? `<span class="time">${item.time}</span>` : ''}<strong>${item.title}</strong>${item.description ? `<br><span>${item.description}</span>` : ''}`;
    programList.appendChild(li);
  });

  // Info
  document.getElementById('info-title').textContent = config.eventName || 'Info';
  if (config.websiteUrl) {
    const link = document.getElementById('info-website-link');
    link.href = config.websiteUrl;
    link.textContent = 'Zur Webseite ↗';
    document.getElementById('info-website').hidden = false;
  }
  if (config.headerImageUrl) {
    const img = document.getElementById('info-header-image');
    img.src = config.headerImageUrl;
    img.hidden = false;
  }

  // Untere Navigation
  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('#bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  }
  document.querySelectorAll('#bottom-nav button').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  const badge = document.getElementById('offline-badge');
  window.addEventListener('offline', () => { badge.hidden = false; });
  window.addEventListener('online', () => { badge.hidden = true; });
  if (!navigator.onLine) badge.hidden = false;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
})();
