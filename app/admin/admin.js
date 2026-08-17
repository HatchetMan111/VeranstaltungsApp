(function () {
  const CATEGORY_ICONS = { wc: '🚻', parkplatz: '🅿️', 'erste-hilfe': '⛑️', buehne: '🎪', info: 'ℹ️', ausgang: '🚪' };
  const CATEGORY_LABELS = { aussteller: 'Aussteller', wc: 'WC', parkplatz: 'Parkplatz', 'erste-hilfe': 'Erste Hilfe', buehne: 'Bühne', info: 'Info-Punkt', ausgang: 'Ausgang' };
  function iconFor(category) {
    if (!category || category === 'aussteller') return undefined;
    const emoji = CATEGORY_ICONS[category] || '📍';
    return L.divIcon({ className: 'poi-icon', html: `<span>${emoji}</span>`, iconSize: [28, 28] });
  }

  let config = null;
  let exhibitorsGeo = null;
  let programData = null;
  let pendingTool = null; // 'center' | 'sw' | 'ne' | 'add-exhibitor' | 'move:<id>' | 'program-location'
  let editingId = null;
  let pendingLatLng = null;
  let editingProgramId = null;
  let pendingProgramLatLng = null;
  const programMarkers = new Map(); // id -> L.Marker

  const map = L.map('admin-map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap-Mitwirkende'
  }).addTo(map);

  const centerMarker = L.marker([0, 0]);
  const boundsRect = L.rectangle([[0, 0], [0, 0]], { color: '#c9822b', weight: 2, fillOpacity: .08 });
  const exhibitorMarkers = new Map(); // id -> L.Marker

  function setStatus(el, text, ok) {
    el.textContent = text;
    el.className = 'status ' + (ok ? 'ok' : 'err');
    if (ok) setTimeout(() => { el.textContent = ''; }, 3000);
  }

  function setTool(tool) {
    pendingTool = tool;
    document.querySelectorAll('.tool').forEach((btn) => btn.classList.remove('active'));
    if (tool && tool !== 'add-exhibitor' && !tool.startsWith('move:')) {
      document.querySelector(`.tool[data-mode="${tool}"]`).classList.add('active');
    }
    if (tool === 'add-exhibitor') document.getElementById('add-exhibitor').classList.add('active');
  }

  async function loadAll() {
    config = await (await fetch('/api/config')).json();
    exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
    programData = await (await fetch('/api/program')).json();

    document.getElementById('eventName').value = config.eventName || '';
    document.getElementById('accentColor').value = config.accentColor || '#c9822b';
    document.getElementById('websiteUrl').value = config.websiteUrl || '';
    document.getElementById('infoText').value = config.infoText || '';
    document.getElementById('headerCentered').checked = !!config.headerCentered;
    document.getElementById('headerLogoLarge').checked = !!config.headerLogoLarge;
    document.getElementById('headerLogoStacked').checked = !!config.headerLogoStacked;

    if (config.logoUrl) {
      const img = document.getElementById('logo-preview');
      img.src = config.logoUrl; img.hidden = false;
    }
    if (config.headerImageUrl) {
      const img = document.getElementById('header-preview');
      img.src = config.headerImageUrl; img.hidden = false;
    }
    renderGallery();
    document.getElementById('tile-api-key').value = config.tileApiKey || '';

    map.setView(config.center, config.defaultZoom || 17);
    centerMarker.setLatLng(config.center).addTo(map);
    boundsRect.setBounds(config.bounds).addTo(map);

    renderExhibitors();
    renderProgram();
  }

  function renderExhibitors() {
    exhibitorMarkers.forEach((m) => map.removeLayer(m));
    exhibitorMarkers.clear();
    const list = document.getElementById('exhibitor-admin-list');
    list.innerHTML = '';

    exhibitorsGeo.features.forEach((f) => {
      const [lng, lat] = f.geometry.coordinates;
      const opts = iconFor(f.properties.category);
      const marker = (opts ? L.marker([lat, lng], { icon: opts }) : L.marker([lat, lng])).addTo(map).bindPopup(f.properties.name);
      exhibitorMarkers.set(f.properties.id, marker);

      const li = document.createElement('li');
      const span = document.createElement('span');
      const label = CATEGORY_LABELS[f.properties.category] || 'Aussteller';
      span.textContent = f.properties.category && f.properties.category !== 'aussteller'
        ? `${f.properties.name} (${label})`
        : f.properties.name;
      li.appendChild(span);

      const actions = document.createElement('span');
      const moveBtn = document.createElement('button');
      moveBtn.textContent = 'Position ändern';
      moveBtn.addEventListener('click', () => setTool('move:' + f.properties.id));
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Bearbeiten';
      editBtn.addEventListener('click', () => openExhibitorForm(f));
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Löschen';
      delBtn.className = 'delete';
      delBtn.addEventListener('click', () => deleteExhibitor(f.properties.id));

      actions.append(moveBtn, editBtn, delBtn);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function renderProgram() {
    programMarkers.forEach((m) => map.removeLayer(m));
    programMarkers.clear();
    const list = document.getElementById('program-admin-list');
    list.innerHTML = '';
    programData.items.forEach((item) => {
      if (typeof item.lat === 'number' && typeof item.lng === 'number') {
        const marker = L.marker([item.lat, item.lng], {
          icon: L.divIcon({ className: 'poi-icon', html: '<span>📅</span>', iconSize: [26, 26] })
        }).addTo(map).bindPopup(item.title);
        programMarkers.set(item.id, marker);
      }

      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = (item.time ? item.time + ' – ' : '') + item.title;
      li.appendChild(span);

      const actions = document.createElement('span');
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Bearbeiten';
      editBtn.addEventListener('click', () => openProgramForm(item));
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Löschen';
      delBtn.className = 'delete';
      delBtn.addEventListener('click', () => deleteProgramItem(item.id));

      actions.append(editBtn, delBtn);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  // Werkzeugleiste Karte
  document.querySelectorAll('.map-tools .tool').forEach((btn) => {
    btn.addEventListener('click', () => setTool(pendingTool === btn.dataset.mode ? null : btn.dataset.mode));
  });
  document.getElementById('add-exhibitor').addEventListener('click', () => {
    setTool(pendingTool === 'add-exhibitor' ? null : 'add-exhibitor');
  });

  map.on('click', (e) => {
    if (!pendingTool) return;
    const { lat, lng } = e.latlng;

    if (pendingTool === 'center') {
      config.center = [lat, lng];
      centerMarker.setLatLng([lat, lng]);
    } else if (pendingTool === 'sw') {
      config.bounds = [[lat, lng], config.bounds[1]];
      boundsRect.setBounds(config.bounds);
    } else if (pendingTool === 'ne') {
      config.bounds = [config.bounds[0], [lat, lng]];
      boundsRect.setBounds(config.bounds);
    } else if (pendingTool === 'add-exhibitor') {
      pendingLatLng = { lat, lng };
      openExhibitorForm(null);
    } else if (pendingTool.startsWith('move:')) {
      const id = pendingTool.slice(5);
      moveExhibitor(id, lat, lng);
    } else if (pendingTool === 'program-location') {
      pendingProgramLatLng = { lat, lng };
      document.getElementById('pg-location-status').textContent =
        `Standort gesetzt: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    if (pendingTool !== 'add-exhibitor') setTool(null);
  });

  // Event-Einstellungen speichern
  document.getElementById('save-settings').addEventListener('click', async () => {
    config.eventName = document.getElementById('eventName').value.trim();
    config.accentColor = document.getElementById('accentColor').value;
    config.websiteUrl = document.getElementById('websiteUrl').value.trim();
    config.infoText = document.getElementById('infoText').value.trim();
    config.headerCentered = document.getElementById('headerCentered').checked;
    config.headerLogoLarge = document.getElementById('headerLogoLarge').checked;
    config.headerLogoStacked = document.getElementById('headerLogoStacked').checked;
    const status = document.getElementById('settings-status');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      setStatus(status, 'Gespeichert.', true);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });

  // Logo / Titelbild
  async function uploadBranding(fileInputId, endpoint, statusId, previewId) {
    const fileInput = document.getElementById(fileInputId);
    const status = document.getElementById(statusId);
    if (!fileInput.files[0]) { setStatus(status, 'Bitte zuerst eine Datei auswählen.', false); return; }
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    setStatus(status, 'Lade hoch …', true);
    try {
      const res = await fetch(endpoint, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      const img = document.getElementById(previewId);
      img.src = data.url + '?t=' + Date.now();
      img.hidden = false;
      setStatus(status, 'Hochgeladen.', true);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  }
  document.getElementById('upload-logo').addEventListener('click', () =>
    uploadBranding('logo-file', '/api/branding/logo', 'logo-status', 'logo-preview'));
  document.getElementById('upload-header').addEventListener('click', () =>
    uploadBranding('header-file', '/api/branding/header', 'header-status', 'header-preview'));

  // Galerie: mehrere Bilder für die Info-Seite
  function renderGallery() {
    const wrap = document.getElementById('gallery-preview-wrap');
    wrap.innerHTML = '';
    (config.galleryImages || []).forEach((url) => {
      const item = document.createElement('div');
      item.className = 'gallery-thumb-wrap';
      const img = document.createElement('img');
      img.src = url;
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = 'Entfernen';
      del.addEventListener('click', () => deleteGalleryImage(url));
      item.append(img, del);
      wrap.appendChild(item);
    });
  }
  document.getElementById('upload-gallery').addEventListener('click', async () => {
    const fileInput = document.getElementById('gallery-file');
    const status = document.getElementById('gallery-status');
    if (!fileInput.files[0]) { setStatus(status, 'Bitte zuerst eine Datei auswählen.', false); return; }
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    setStatus(status, 'Lade hoch …', true);
    try {
      const res = await fetch('/api/branding/gallery', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      config.galleryImages = data.galleryImages;
      renderGallery();
      fileInput.value = '';
      setStatus(status, 'Hinzugefügt.', true);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });
  async function deleteGalleryImage(url) {
    const res = await fetch('/api/branding/gallery', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (res.ok) { config.galleryImages = data.galleryImages; renderGallery(); }
  }

  document.getElementById('save-tile-key').addEventListener('click', async () => {
    const key = document.getElementById('tile-api-key').value.trim();
    const status = document.getElementById('tile-key-status');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, tileApiKey: key })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      config.tileApiKey = key;
      setStatus(status, 'Gespeichert.', true);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });

  // Aussteller-Formular
  function openExhibitorForm(feature) {
    editingId = feature ? feature.properties.id : null;
    document.getElementById('form-title').textContent = feature ? 'Punkt bearbeiten' : 'Neuer Punkt';
    document.getElementById('ex-category').value = feature ? (feature.properties.category || 'aussteller') : 'aussteller';
    document.getElementById('ex-name').value = feature ? feature.properties.name : '';
    document.getElementById('ex-desc').value = feature ? feature.properties.description : '';
    document.getElementById('ex-offer').value = feature ? (feature.properties.offer || '') : '';
    document.getElementById('ex-branche').value = feature ? (feature.properties.branche || '') : '';
    document.getElementById('ex-website').value = feature ? (feature.properties.website || '') : '';
    document.getElementById('ex-phone').value = feature ? (feature.properties.phone || '') : '';

    const imgSection = document.getElementById('ex-image-section');
    imgSection.hidden = !editingId;
    const preview = document.getElementById('ex-image-preview');
    if (feature && feature.properties.imageUrl) {
      preview.src = feature.properties.imageUrl;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
    document.getElementById('ex-image-file').value = '';
    document.getElementById('ex-image-status').textContent = '';

    const logoPreview = document.getElementById('ex-logo-preview');
    if (feature && feature.properties.logoUrl) {
      logoPreview.src = feature.properties.logoUrl;
      logoPreview.hidden = false;
    } else {
      logoPreview.hidden = true;
    }
    document.getElementById('ex-logo-file').value = '';
    document.getElementById('ex-logo-status').textContent = '';

    document.getElementById('exhibitor-form').hidden = false;
  }
  document.getElementById('ex-cancel').addEventListener('click', closeExhibitorForm);
  function closeExhibitorForm() {
    document.getElementById('exhibitor-form').hidden = true;
    editingId = null;
    pendingLatLng = null;
    setTool(null);
  }
  document.getElementById('ex-save').addEventListener('click', async () => {
    const name = document.getElementById('ex-name').value.trim();
    const description = document.getElementById('ex-desc').value.trim();
    const category = document.getElementById('ex-category').value;
    const offer = document.getElementById('ex-offer').value.trim();
    const branche = document.getElementById('ex-branche').value.trim();
    const website = document.getElementById('ex-website').value.trim();
    const phone = document.getElementById('ex-phone').value.trim();
    const status = document.getElementById('ex-status');
    if (!name) { setStatus(status, 'Name fehlt.', false); return; }
    try {
      if (editingId) {
        const res = await fetch(`/api/exhibitors/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, category, offer, branche, website, phone })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      } else {
        if (!pendingLatLng) { setStatus(status, 'Bitte zuerst auf die Karte klicken.', false); return; }
        const res = await fetch('/api/exhibitors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, category, offer, branche, website, phone, lat: pendingLatLng.lat, lng: pendingLatLng.lng })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      }
      exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
      renderExhibitors();
      document.getElementById('exhibitor-form').hidden = true;
      editingId = null;
      pendingLatLng = null;
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });

  document.getElementById('ex-image-upload').addEventListener('click', async () => {
    const fileInput = document.getElementById('ex-image-file');
    const status = document.getElementById('ex-image-status');
    if (!editingId) { setStatus(status, 'Bitte zuerst speichern.', false); return; }
    if (!fileInput.files[0]) { setStatus(status, 'Bitte zuerst eine Datei auswählen.', false); return; }
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    setStatus(status, 'Lade hoch …', true);
    try {
      const res = await fetch(`/api/exhibitors/${editingId}/image`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      const preview = document.getElementById('ex-image-preview');
      preview.src = data.url + '?t=' + Date.now();
      preview.hidden = false;
      setStatus(status, 'Hochgeladen.', true);
      exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });
  document.getElementById('ex-logo-upload').addEventListener('click', async () => {
    const fileInput = document.getElementById('ex-logo-file');
    const status = document.getElementById('ex-logo-status');
    if (!editingId) { setStatus(status, 'Bitte zuerst speichern.', false); return; }
    if (!fileInput.files[0]) { setStatus(status, 'Bitte zuerst eine Datei auswählen.', false); return; }
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    setStatus(status, 'Lade hoch …', true);
    try {
      const res = await fetch(`/api/exhibitors/${editingId}/logo`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      const preview = document.getElementById('ex-logo-preview');
      preview.src = data.url + '?t=' + Date.now();
      preview.hidden = false;
      setStatus(status, 'Hochgeladen.', true);
      exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });
  async function moveExhibitor(id, lat, lng) {
    await fetch(`/api/exhibitors/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng })
    });
    exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
    renderExhibitors();
  }
  async function deleteExhibitor(id) {
    if (!confirm('Diesen Aussteller wirklich löschen?')) return;
    await fetch(`/api/exhibitors/${id}`, { method: 'DELETE' });
    exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
    renderExhibitors();
  }

  // Programm-Formular
  document.getElementById('add-program').addEventListener('click', () => openProgramForm(null));
  function openProgramForm(item) {
    editingProgramId = item ? item.id : null;
    document.getElementById('program-form-title').textContent = item ? 'Programmpunkt bearbeiten' : 'Neuer Programmpunkt';
    document.getElementById('pg-time').value = item ? item.time : '';
    document.getElementById('pg-title').value = item ? item.title : '';
    document.getElementById('pg-desc').value = item ? item.description : '';

    pendingProgramLatLng = item && typeof item.lat === 'number' && typeof item.lng === 'number'
      ? { lat: item.lat, lng: item.lng } : null;
    document.getElementById('pg-location-status').textContent = pendingProgramLatLng
      ? `Standort gesetzt: ${pendingProgramLatLng.lat.toFixed(5)}, ${pendingProgramLatLng.lng.toFixed(5)}`
      : 'Kein Standort gesetzt.';

    const imgSection = document.getElementById('pg-image-section');
    imgSection.hidden = !editingProgramId;
    const preview = document.getElementById('pg-image-preview');
    if (item && item.imageUrl) { preview.src = item.imageUrl; preview.hidden = false; } else { preview.hidden = true; }
    document.getElementById('pg-image-file').value = '';
    document.getElementById('pg-image-status').textContent = '';

    document.getElementById('program-form').hidden = false;
  }
  document.getElementById('pg-set-location').addEventListener('click', () => {
    setTool(pendingTool === 'program-location' ? null : 'program-location');
  });
  document.getElementById('pg-clear-location').addEventListener('click', () => {
    pendingProgramLatLng = null;
    document.getElementById('pg-location-status').textContent = 'Kein Standort gesetzt.';
  });
  document.getElementById('pg-cancel').addEventListener('click', () => {
    document.getElementById('program-form').hidden = true;
    editingProgramId = null;
    pendingProgramLatLng = null;
    setTool(null);
  });
  document.getElementById('pg-save').addEventListener('click', async () => {
    const time = document.getElementById('pg-time').value.trim();
    const title = document.getElementById('pg-title').value.trim();
    const description = document.getElementById('pg-desc').value.trim();
    const status = document.getElementById('pg-status');
    if (!title) { setStatus(status, 'Titel fehlt.', false); return; }
    const payload = { time, title, description };
    if (pendingProgramLatLng) { payload.lat = pendingProgramLatLng.lat; payload.lng = pendingProgramLatLng.lng; }
    try {
      const url = editingProgramId ? `/api/program/${editingProgramId}` : '/api/program';
      const method = editingProgramId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      programData = await (await fetch('/api/program')).json();
      renderProgram();
      document.getElementById('program-form').hidden = true;
      editingProgramId = null;
      pendingProgramLatLng = null;
      setTool(null);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });
  document.getElementById('pg-image-upload').addEventListener('click', async () => {
    const fileInput = document.getElementById('pg-image-file');
    const status = document.getElementById('pg-image-status');
    if (!editingProgramId) { setStatus(status, 'Bitte zuerst speichern.', false); return; }
    if (!fileInput.files[0]) { setStatus(status, 'Bitte zuerst eine Datei auswählen.', false); return; }
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    setStatus(status, 'Lade hoch …', true);
    try {
      const res = await fetch(`/api/program/${editingProgramId}/image`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      const preview = document.getElementById('pg-image-preview');
      preview.src = data.url + '?t=' + Date.now();
      preview.hidden = false;
      setStatus(status, 'Hochgeladen.', true);
      programData = await (await fetch('/api/program')).json();
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });
  async function deleteProgramItem(id) {
    if (!confirm('Diesen Programmpunkt wirklich löschen?')) return;
    await fetch(`/api/program/${id}`, { method: 'DELETE' });
    programData = await (await fetch('/api/program')).json();
    renderProgram();
  }

  // Kartenkacheln
  document.getElementById('download-tiles').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = document.getElementById('tiles-download-status');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Lädt herunter …';
    setStatus(status, 'Lädt herunter, das kann bis zu einer Minute dauern …', true);
    try {
      const res = await fetch('/api/tiles/download', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      setStatus(status, `Fertig: ${data.downloaded} von ${data.total} Kacheln geladen.`, true);
    } catch (err) {
      setStatus(status, err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
  document.getElementById('upload-tiles').addEventListener('click', async () => {
    const fileInput = document.getElementById('tiles-file');
    const status = document.getElementById('tiles-status');
    if (!fileInput.files[0]) { setStatus(status, 'Bitte zuerst eine ZIP-Datei auswählen.', false); return; }
    const formData = new FormData();
    formData.append('tiles', fileInput.files[0]);
    setStatus(status, 'Lade hoch …', true);
    try {
      const res = await fetch('/api/tiles', { method: 'POST', body: formData });
      if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      setStatus(status, 'Kacheln hochgeladen.', true);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });

  // Sicherheit
  document.getElementById('save-password').addEventListener('click', async () => {
    const newPassword = document.getElementById('new-password').value;
    const status = document.getElementById('password-status');
    try {
      const res = await fetch('/api/admin/password', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      document.getElementById('new-password').value = '';
      setStatus(status, 'Geändert. Beim nächsten Laden neu einloggen.', true);
    } catch (err) {
      setStatus(status, err.message, false);
    }
  });

  loadAll();
})();
