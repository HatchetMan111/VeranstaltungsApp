(function () {
  let config = null;
  let exhibitorsGeo = null;
  let programData = null;
  let pendingTool = null; // 'center' | 'sw' | 'ne' | 'add-exhibitor' | 'move:<id>'
  let editingId = null;
  let pendingLatLng = null;
  let editingProgramId = null;

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

    if (config.logoUrl) {
      const img = document.getElementById('logo-preview');
      img.src = config.logoUrl; img.hidden = false;
    }
    if (config.headerImageUrl) {
      const img = document.getElementById('header-preview');
      img.src = config.headerImageUrl; img.hidden = false;
    }

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
      const marker = L.marker([lat, lng]).addTo(map).bindPopup(f.properties.name);
      exhibitorMarkers.set(f.properties.id, marker);

      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = f.properties.name;
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
    const list = document.getElementById('program-admin-list');
    list.innerHTML = '';
    programData.items.forEach((item) => {
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
    }

    if (pendingTool !== 'add-exhibitor') setTool(null);
  });

  // Event-Einstellungen speichern
  document.getElementById('save-settings').addEventListener('click', async () => {
    config.eventName = document.getElementById('eventName').value.trim();
    config.accentColor = document.getElementById('accentColor').value;
    config.websiteUrl = document.getElementById('websiteUrl').value.trim();
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

  // Aussteller-Formular
  function openExhibitorForm(feature) {
    editingId = feature ? feature.properties.id : null;
    document.getElementById('form-title').textContent = feature ? 'Aussteller bearbeiten' : 'Neuer Aussteller';
    document.getElementById('ex-name').value = feature ? feature.properties.name : '';
    document.getElementById('ex-desc').value = feature ? feature.properties.description : '';
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
    const status = document.getElementById('ex-status');
    if (!name) { setStatus(status, 'Name fehlt.', false); return; }
    try {
      if (editingId) {
        const res = await fetch(`/api/exhibitors/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      } else {
        if (!pendingLatLng) { setStatus(status, 'Bitte zuerst auf die Karte klicken.', false); return; }
        const res = await fetch('/api/exhibitors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, lat: pendingLatLng.lat, lng: pendingLatLng.lng })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      }
      exhibitorsGeo = await (await fetch('/api/exhibitors')).json();
      renderExhibitors();
      closeExhibitorForm();
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
    document.getElementById('program-form').hidden = false;
  }
  document.getElementById('pg-cancel').addEventListener('click', () => {
    document.getElementById('program-form').hidden = true;
    editingProgramId = null;
  });
  document.getElementById('pg-save').addEventListener('click', async () => {
    const time = document.getElementById('pg-time').value.trim();
    const title = document.getElementById('pg-title').value.trim();
    const description = document.getElementById('pg-desc').value.trim();
    const status = document.getElementById('pg-status');
    if (!title) { setStatus(status, 'Titel fehlt.', false); return; }
    try {
      const url = editingProgramId ? `/api/program/${editingProgramId}` : '/api/program';
      const method = editingProgramId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time, title, description })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      programData = await (await fetch('/api/program')).json();
      renderProgram();
      document.getElementById('program-form').hidden = true;
      editingProgramId = null;
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
  document.getElementById('download-tiles').addEventListener('click', async () => {
    const status = document.getElementById('tiles-download-status');
    setStatus(status, 'Lädt herunter, das kann bis zu einer Minute dauern …', true);
    try {
      const res = await fetch('/api/tiles/download', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      setStatus(status, `Fertig: ${data.downloaded} von ${data.total} Kacheln geladen.`, true);
    } catch (err) {
      setStatus(status, err.message, false);
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
