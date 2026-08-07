(function () {
  let config = null;
  let exhibitorsGeo = null;
  let pendingTool = null; // 'center' | 'sw' | 'ne' | 'add-exhibitor' | 'move:<id>'
  let editingId = null;
  let pendingLatLng = null;

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
    if (ok) setTimeout(() => { el.textContent = ''; }, 2500);
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

    document.getElementById('eventName').value = config.eventName || '';
    document.getElementById('accentColor').value = config.accentColor || '#c9822b';

    map.setView(config.center, config.defaultZoom || 17);
    centerMarker.setLatLng(config.center).addTo(map);
    boundsRect.setBounds(config.bounds).addTo(map);

    renderExhibitors();
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

  // Werkzeugleiste
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
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Fehler');
      } else {
        if (!pendingLatLng) { setStatus(status, 'Bitte zuerst auf die Karte klicken.', false); return; }
        const res = await fetch('/api/exhibitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng })
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

  loadAll();
})();
