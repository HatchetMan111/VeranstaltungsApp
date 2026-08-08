(async function () {
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

  // Aussteller: Marker auf der Karte + volle Liste im Aussteller-Tab
  const geo = await (await fetch('/api/exhibitors')).json();
  const fullList = document.getElementById('exhibitor-list-full');
  const markers = new Map();

  L.geoJSON(geo, {
    onEachFeature: (feature, marker) => {
      const p = feature.properties || {};
      marker.bindPopup(`<strong>${p.name || 'Aussteller'}</strong><br>${p.description || ''}`);
      markers.set(p.id, marker);

      const li = document.createElement('li');
      li.innerHTML = `<strong>${p.name || 'Aussteller'}</strong>${p.description ? `<br><span>${p.description}</span>` : ''}`;
      li.addEventListener('click', () => {
        showView('map');
        map.setView(marker.getLatLng(), config.maxZoom || 19);
        marker.openPopup();
      });
      fullList.appendChild(li);
    }
  }).addTo(map);

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
