(async function () {
  const config = await (await fetch('/api/config')).json();

  document.documentElement.style.setProperty('--accent', config.accentColor || '#c9822b');
  document.getElementById('event-title').textContent = config.eventName || 'Event-Karte';
  document.title = config.eventName || 'Event-Karte';

  const map = L.map('map', { zoomControl: true }).setView(config.center, config.defaultZoom || 17);

  L.tileLayer('tiles/{z}/{x}/{y}.png', {
    minZoom: config.minZoom || 15,
    maxZoom: config.maxZoom || 19,
    bounds: L.latLngBounds(config.bounds),
    attribution: '© OpenStreetMap-Mitwirkende'
  }).addTo(map);

  const geo = await (await fetch('/api/exhibitors')).json();
  const list = document.getElementById('exhibitor-list');

  L.geoJSON(geo, {
    onEachFeature: (feature, marker) => {
      const p = feature.properties || {};
      marker.bindPopup(`<strong>${p.name || 'Aussteller'}</strong><br>${p.description || ''}`);

      const li = document.createElement('li');
      li.textContent = p.name || 'Aussteller';
      li.addEventListener('click', () => {
        map.setView(marker.getLatLng(), config.maxZoom || 19);
        marker.openPopup();
        document.getElementById('sidebar').hidden = true;
      });
      list.appendChild(li);
    }
  }).addTo(map);

  document.getElementById('filter-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.hidden = !sidebar.hidden;
  });

  const badge = document.getElementById('offline-badge');
  window.addEventListener('offline', () => { badge.hidden = false; });
  window.addEventListener('online', () => { badge.hidden = true; });
  if (!navigator.onLine) badge.hidden = false;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
})();
