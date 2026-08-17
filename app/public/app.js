(async function () {
  // Natives Seiten-Zoom verhindern: iOS Safari ignoriert "user-scalable=no" bewusst,
  // macOS-Trackpads mappen Pinch auf Browser-Zoom. Beides umgeht Leaflets eigenes
  // maxZoom/maxBounds und zeigt dahinter nur vergrößerten, leeren Seiteninhalt (grau).
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  const CATEGORY_ICONS = { wc: '🚻', parkplatz: '🅿️', 'erste-hilfe': '⛑️', buehne: '🎪', info: 'ℹ️', ausgang: '🚪' };
  const FAVORITES_KEY = 'event-favorites';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

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

  const header = document.getElementById('header');
  if (config.headerCentered) header.classList.add('header-center');
  if (config.headerLogoStacked) {
    header.classList.add('header-stacked');
    document.documentElement.style.setProperty('--header-height', config.headerLogoLarge ? '6.2rem' : '5.2rem');
  }

  if (config.logoUrl) {
    const logo = document.getElementById('event-logo');
    logo.src = config.logoUrl;
    logo.hidden = false;
    if (config.headerLogoLarge) logo.classList.add('logo-lg');
  }

  // Karte — Zoom- und Bereichsgrenzen bewusst auf der Karte selbst setzen (nicht nur
  // auf dem Tile-Layer): sonst kann man über den Kartenausschnitt hinausscrollen oder
  // tiefer zoomen als Kacheln vorhanden sind, und sieht Leaflets grauen Leerhintergrund.
  const mapBounds = L.latLngBounds(config.bounds);
  const minZoom = config.minZoom || 15;
  const maxZoom = config.maxZoom || 19;

  const map = L.map('map', {
    zoomControl: true,
    minZoom,
    maxZoom,
    maxBounds: mapBounds,
    maxBoundsViscosity: 1.0
  });
  // fitBounds statt setView(center, defaultZoom): passt Zoom und Mittelpunkt automatisch
  // so an, dass der gesetzte Kartenausschnitt den Bildschirm ausfüllt. Ein falsch
  // gesetzter defaultZoom (z. B. weit rausgezoomt) führte sonst dazu, dass Leaflet auf
  // minZoom klemmt, ohne die Ansicht am Ausschnitt auszurichten — Ergebnis war ein
  // grauer Streifen über der eigentlichen Karte.
  map.fitBounds(mapBounds);

  L.tileLayer('tiles/{z}/{x}/{y}.png', {
    minZoom,
    maxZoom,
    bounds: mapBounds,
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
    const isExhibitor = !p.category || p.category === 'aussteller';
    marker.bindPopup(`
      ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" class="popup-img">` : ''}
      <strong>${escapeHtml(p.name || 'Aussteller')}</strong>
      ${p.branche ? `<div class="popup-branche">${escapeHtml(p.branche)}</div>` : ''}
      ${p.offer ? `<div class="popup-offer">${escapeHtml(p.offer)}</div>` : ''}
      ${p.description ? `<br>${escapeHtml(p.description)}` : ''}
      ${isExhibitor ? `<br><a href="#" class="open-detail-link" data-id="${escapeHtml(p.id)}">Mehr erfahren →</a>` : ''}
    `);
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

        const row = document.createElement('div');
        row.className = 'list-row';
        row.addEventListener('click', () => showExhibitorDetail(p.id));

        if (p.imageUrl) {
          const thumb = document.createElement('img');
          thumb.src = p.imageUrl;
          thumb.className = 'list-thumb';
          thumb.alt = '';
          row.appendChild(thumb);
        }

        const textWrap = document.createElement('div');
        textWrap.className = 'list-text';
        textWrap.innerHTML = `<strong>${escapeHtml(p.name)}</strong>${p.offer ? `<span class="offer-badge">${escapeHtml(p.offer)}</span>` : ''}${p.description ? `<br><span>${escapeHtml(p.description)}</span>` : ''}`;
        row.appendChild(textWrap);

        const star = document.createElement('button');
        star.className = 'fav-btn' + (isFavorite(p.id) ? ' active' : '');
        star.textContent = isFavorite(p.id) ? '★' : '☆';
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFavorite(p.id);
          renderExhibitorList();
        });

        li.appendChild(row);
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
    li.innerHTML = `${item.time ? `<span class="time">${escapeHtml(item.time)}</span>` : ''}<strong>${escapeHtml(item.title)}</strong>${item.description ? `<br><span>${escapeHtml(item.description)}</span>` : ''}`;
    programList.appendChild(li);

    if (typeof item.lat === 'number' && typeof item.lng === 'number') {
      const marker = L.marker([item.lat, item.lng], {
        icon: L.divIcon({ className: 'poi-icon', html: '<span>📅</span>', iconSize: [30, 30] })
      }).addTo(map);
      marker.bindPopup(`
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" class="popup-img">` : ''}
        ${item.time ? `<span class="time">${escapeHtml(item.time)}</span> ` : ''}<strong>${escapeHtml(item.title)}</strong>
        ${item.description ? `<br>${escapeHtml(item.description)}` : ''}
      `);
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        showView('map');
        map.setView(marker.getLatLng(), config.maxZoom || 19);
        marker.openPopup();
      });
    }
  });

  // Info
  document.getElementById('info-title').textContent = config.eventName || 'Info';
  if (config.infoText) {
    const desc = document.getElementById('info-description');
    desc.textContent = config.infoText;
    desc.hidden = false;
  }
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
  if (Array.isArray(config.galleryImages) && config.galleryImages.length) {
    const gallery = document.getElementById('info-gallery');
    config.galleryImages.forEach((url) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      gallery.appendChild(img);
    });
  }

  // Aussteller-Detailseite ("Unternehmensseite")
  let returnView = 'map';
  let currentDetailId = null;
  function showExhibitorDetail(id) {
    const feature = geo.features.find((f) => f.properties.id === id);
    if (!feature) return;
    const p = feature.properties;
    currentDetailId = id;
    const active = document.querySelector('.view.active');
    returnView = active ? active.id.replace('view-', '') : 'map';

    const img = document.getElementById('detail-image');
    if (p.imageUrl) { img.src = p.imageUrl; img.hidden = false; } else { img.hidden = true; }

    const logo = document.getElementById('detail-logo');
    if (p.logoUrl) { logo.src = p.logoUrl; logo.hidden = false; } else { logo.hidden = true; }

    document.getElementById('detail-name').textContent = p.name || '';

    const branche = document.getElementById('detail-branche');
    if (p.branche) { branche.textContent = p.branche; branche.hidden = false; } else { branche.hidden = true; }

    const offer = document.getElementById('detail-offer');
    if (p.offer) { offer.textContent = p.offer; offer.hidden = false; } else { offer.hidden = true; }

    const desc = document.getElementById('detail-description');
    if (p.description) { desc.textContent = p.description; desc.hidden = false; } else { desc.hidden = true; }

    const website = document.getElementById('detail-website');
    if (p.website) { website.href = p.website; website.hidden = false; } else { website.hidden = true; }

    const phone = document.getElementById('detail-phone');
    if (p.phone) {
      phone.href = 'tel:' + p.phone.replace(/\s+/g, '');
      phone.textContent = '📞 ' + p.phone;
      phone.hidden = false;
    } else { phone.hidden = true; }

    showView('exhibitor-detail');
  }
  document.getElementById('detail-back').addEventListener('click', () => showView(returnView));
  document.getElementById('detail-show-map').addEventListener('click', () => {
    const marker = markers.get(currentDetailId);
    if (!marker) return;
    showView('map');
    map.setView(marker.getLatLng(), config.maxZoom || 19);
    marker.openPopup();
  });
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.open-detail-link');
    if (link) { e.preventDefault(); showExhibitorDetail(link.dataset.id); }
  });

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
