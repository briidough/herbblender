// MongoDB DAL normalizes documents to uppercase keys: ID, NAME, DESCRIPTION, etc.

const state = {
  activeSection: null,  // 'herbs' | 'teas' | 'effects'
  screen: null,         // 'list' | 'detail' | 'edit'
  items: [],
  selectedItem: null,
  allEffects: [],       // full effect list for tea editor picker
  editMode: null,       // 'new' | 'edit'
  editOrigin: null,     // 'list' | 'detail'
  errorMsg: null,
};

// ── API helpers ───────────────────────────────────────────────────────────────

const api = {
  get: (path) => fetch(path).then(r => r.json()),
  post: (path, body) => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json()),
  put: (path, body) => fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json()),
  del: (path) => fetch(path, { method: 'DELETE' }).then(r => r.json()),
};

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const main = document.getElementById('main-content');
  if (!state.activeSection || !state.screen) {
    main.innerHTML = '<p class="empty-msg">Select a section from the sidebar.</p>';
    return;
  }
  if (state.screen === 'list')   main.innerHTML = renderList();
  if (state.screen === 'detail') main.innerHTML = renderDetail();
  if (state.screen === 'edit')   main.innerHTML = renderEdit();
  attachListeners();
}

// ── List screen ───────────────────────────────────────────────────────────────

function renderList() {
  const section = state.activeSection;
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  const rows = state.items.map(item => {
    const sub = section === 'effects'
      ? `<span class="quality-badge ${qualityClass(item.QUALITY)}">${item.QUALITY || ''}</span>`
      : `<span class="item-sub">${esc(item.DESCRIPTION || '').slice(0, 60)}${(item.DESCRIPTION || '').length > 60 ? '…' : ''}</span>`;
    return `
      <div class="item-row">
        <span class="item-name" data-action="open-detail" data-id="${item.ID}">${esc(item.NAME)}</span>
        ${sub}
        <button class="btn btn-blue btn-icon" data-action="open-edit" data-id="${item.ID}">Edit</button>
        <button class="btn btn-red btn-icon" data-action="delete-item" data-id="${item.ID}">Delete</button>
      </div>`;
  }).join('');

  return `
    <div class="section-header">
      <h2>${label}</h2>
    </div>
    ${state.errorMsg ? `<div class="error-banner">${esc(state.errorMsg)}</div>` : ''}
    <div class="item-list">${rows || '<p style="padding:1rem;color:#90a4ae">No items found.</p>'}</div>
    <div class="list-footer">
      <button class="btn btn-green" data-action="open-new">+ Add New</button>
    </div>`;
}

// ── Detail screen ─────────────────────────────────────────────────────────────

function renderDetail() {
  const item = state.selectedItem;
  const section = state.activeSection;

  let fields = '';
  if (section === 'herbs') {
    fields = `
      <div class="detail-grid">
        <span class="detail-label">Family</span><span class="detail-value">${esc(item.FAMILY || '')}</span>
        <span class="detail-label">Genus</span><span class="detail-value">${esc(item.GENUS || '')}</span>
        <span class="detail-label">Species</span><span class="detail-value">${esc(item.SPECIES || '')}</span>
        <span class="detail-label">Other Names</span><span class="detail-value">${esc((item.OTHER_NAMES || []).join(', '))}</span>
        <span class="detail-label">Description</span><span class="detail-value">${esc(item.DESCRIPTION || '')}</span>
      </div>`;
  } else if (section === 'teas') {
    const plantName = [item.GENUS, item.SPECIES].filter(Boolean).join(' ');
    const effectsHtml = (item.EFFECTS || []).length
      ? `<div class="effects-list">${(item.EFFECTS || []).map(e =>
          `<span class="effect-chip ${qualityClass(e.QUALITY)}">${esc(e.NAME)}</span>`).join('')}</div>`
      : '<span style="color:#90a4ae;font-size:0.85rem">None</span>';
    fields = `
      <div class="detail-grid">
        <span class="detail-label">Plant</span><span class="detail-value">${esc(plantName)}</span>
        <span class="detail-label">Family</span><span class="detail-value">${esc(item.FAMILY || '')}</span>
        <span class="detail-label">Oxidation</span><span class="detail-value">${esc(item.OXIDATION || '')}</span>
        <span class="detail-label">Fermentation</span><span class="detail-value">${esc(item.FERMENTATION || '')}</span>
        <span class="detail-label">Description</span><span class="detail-value">${esc(item.DESCRIPTION || '')}</span>
      </div>
      <div class="detail-section-title">Effects</div>
      ${effectsHtml}`;
  } else if (section === 'effects') {
    fields = `
      <div class="detail-grid">
        <span class="detail-label">Quality</span>
        <span class="detail-value">
          <span class="quality-badge ${qualityClass(item.QUALITY)}">${esc(item.QUALITY || '')}</span>
        </span>
        <span class="detail-label">Description</span><span class="detail-value">${esc(item.DESCRIPTION || '')}</span>
      </div>`;
  }

  const imgHtml = (section === 'herbs' || section === 'teas') && item.IMAGE_PATH
    ? `<div class="detail-section-title">Image</div>
       <div class="image-gallery">
         <div class="image-card">
           <img class="image-thumb" src="/images/${item.IMAGE_PATH}" alt="${esc(item.NAME)}">
         </div>
       </div>`
    : '';

  return `
    <div class="detail-card">
      <div class="section-header">
        <h2>${esc(item.NAME)}</h2>
      </div>
      <div class="detail-type">${state.activeSection.charAt(0).toUpperCase() + state.activeSection.slice(1, -1)}</div>
      ${state.errorMsg ? `<div class="error-banner">${esc(state.errorMsg)}</div>` : ''}
      ${fields}
      ${imgHtml}
      <div class="detail-actions">
        <button class="btn btn-blue" data-action="open-edit" data-id="${item.ID}">Edit</button>
        <button class="btn btn-gray" data-action="back-to-list">Back</button>
      </div>
    </div>`;
}

// ── Edit screen ───────────────────────────────────────────────────────────────

function renderEdit() {
  const section = state.activeSection;
  const item = state.selectedItem;
  const isNew = state.editMode === 'new';
  const title = isNew ? `New ${section.slice(0, -1)}` : `Edit ${esc(item?.NAME || '')}`;
  const currentIdx = !isNew ? state.items.findIndex(i => i.ID === item?.ID) : -1;
  const hasNext = currentIdx >= 0 && currentIdx < state.items.length - 1;

  let formFields = '';
  if (section === 'herbs') {
    formFields = `
      ${field('name', 'Name', item?.NAME, 'text', true)}
      ${field('other_names', 'Other Names', (item?.OTHER_NAMES || []).join(', '))}
      ${field('family', 'Family', item?.FAMILY)}
      ${field('genus', 'Genus', item?.GENUS)}
      ${field('species', 'Species', item?.SPECIES)}
      <div class="form-field">
        <button type="button" class="btn btn-blue" data-action="fetch-images">Fetch Images</button>
        <span id="fetch-images-status" class="fetch-status"></span>
      </div>
      ${textarea('description', 'Description', item?.DESCRIPTION)}`;

  } else if (section === 'teas') {
    const currentEffects = (item?.EFFECTS || []).map(e => `
      <div class="effect-row">
        <span class="effect-row-name">${esc(e.NAME)}</span>
        <span class="quality-badge ${qualityClass(e.QUALITY)}">${esc(e.QUALITY || '')}</span>
        <button class="btn btn-red btn-icon" data-action="unlink-effect" data-effect-name="${esc(e.NAME)}">−</button>
      </div>`).join('');

    const linkedNames = new Set((item?.EFFECTS || []).map(e => e.NAME));
    const availableEffects = state.allEffects.filter(e => !linkedNames.has(e.NAME));
    const effectOptions = availableEffects.map(e =>
      `<option value="${esc(e.NAME)}">${esc(e.NAME)}</option>`).join('');

    formFields = `
      ${field('name', 'Name', item?.NAME, 'text', true)}
      ${field('genus', 'Genus', item?.GENUS)}
      ${field('species', 'Species', item?.SPECIES)}
      ${field('family', 'Family', item?.FAMILY)}
      ${field('oxidation', 'Oxidation', item?.OXIDATION)}
      ${field('fermentation', 'Fermentation', item?.FERMENTATION)}
      ${textarea('description', 'Description', item?.DESCRIPTION)}
      <div class="form-field">
        <label>Effects</label>
        <div class="effects-sub">
          <div class="effects-sub-list" id="effects-sub-list">
            ${currentEffects || '<span style="color:#90a4ae;font-size:0.85rem">No effects linked.</span>'}
          </div>
          ${!isNew ? `
          <div class="effects-picker">
            <select id="effect-picker">${effectOptions || '<option disabled>No more effects</option>'}</select>
            <button class="btn btn-blue btn-icon" data-action="link-effect">Link</button>
          </div>
          <div>
            <button class="btn btn-gray btn-icon" id="toggle-new-effect" style="margin-top:0.4rem" data-action="toggle-new-effect">+ Create new effect</button>
          </div>
          <div id="new-effect-form" class="new-effect-form" style="display:none">
            <input type="text" id="new-effect-name" placeholder="Effect name">
            <textarea id="new-effect-desc" placeholder="Description" rows="2"></textarea>
            <select id="new-effect-quality">
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <div style="display:flex;justify-content:space-between">
              <button class="btn btn-gray btn-icon" data-action="cancel-new-effect">Cancel</button>
              <button class="btn btn-green btn-icon" data-action="save-link-effect">Save &amp; Link</button>
            </div>
          </div>` : '<p style="color:#90a4ae;font-size:0.82rem;margin-top:0.4rem">Save the tea first to manage effects.</p>'}
        </div>
      </div>`;

  } else if (section === 'effects') {
    const q = item?.QUALITY || 'neutral';
    formFields = `
      ${field('name', 'Name', item?.NAME, 'text', true)}
      ${textarea('description', 'Description', item?.DESCRIPTION)}
      <div class="form-field">
        <label>Quality</label>
        <select name="quality">
          <option value="positive" ${q === 'positive' ? 'selected' : ''}>Positive</option>
          <option value="negative" ${q === 'negative' ? 'selected' : ''}>Negative</option>
          <option value="neutral"  ${q === 'neutral'  ? 'selected' : ''}>Neutral</option>
        </select>
      </div>`;
  }

  const imgHtml = (!isNew && (section === 'herbs' || section === 'teas') && item?.IMAGE_PATH)
    ? `<div class="form-field">
        <label>Image</label>
        <div class="image-gallery">
          <div class="image-card">
            <img class="image-thumb" src="/images/${item.IMAGE_PATH}" alt="${esc(item?.NAME || '')}">
          </div>
        </div>
       </div>`
    : '';

  const headerHtml = (isNew && section === 'herbs')
    ? `<div class="form-title-row"><h2>${title}</h2><button type="button" class="btn btn-blue" data-action="add-from-tea">Add from tea</button></div>`
    : `<h2>${title}</h2>`;

  return `
    <div class="edit-form">
      ${headerHtml}
      ${state.errorMsg ? `<div class="error-banner">${esc(state.errorMsg)}</div>` : ''}
      <form id="edit-form" autocomplete="off">
        ${formFields}
        ${imgHtml}
        <div class="form-actions">
          <button type="button" class="btn btn-gray" data-action="cancel-edit">Cancel</button>
          <div style="display:flex;gap:0.4rem">
            <button type="button" class="btn btn-blue" data-action="save-and-next" ${!hasNext ? 'disabled' : ''}>Save &amp; Next</button>
            <button type="submit" class="btn btn-blue">Save</button>
          </div>
        </div>
      </form>
    </div>`;
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function field(name, label, value = '', type = 'text', required = false) {
  return `<div class="form-field">
    <label>${label}${required ? ' *' : ''}</label>
    <input type="${type}" name="${name}" value="${esc(value || '')}" ${required ? 'required' : ''}>
  </div>`;
}

function textarea(name, label, value = '') {
  return `<div class="form-field">
    <label>${label}</label>
    <textarea name="${name}">${esc(value || '')}</textarea>
  </div>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function qualityClass(q) {
  if (!q) return '';
  const lq = q.toLowerCase();
  if (lq === 'positive') return 'quality-positive';
  if (lq === 'negative') return 'quality-negative';
  return 'quality-neutral';
}

// ── Event listeners ───────────────────────────────────────────────────────────

function attachListeners() {
  const main = document.getElementById('main-content');

  main.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', handleAction);
  });

  const form = document.getElementById('edit-form');
  if (form) form.addEventListener('submit', handleSave);
}

async function handleAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = e.currentTarget.dataset.id || null;

  state.errorMsg = null;

  switch (action) {
    case 'open-detail':   await openDetail(id); break;
    case 'open-edit':     await openEditMode(id); break;
    case 'open-new':      await openNew(); break;
    case 'delete-item':   await deleteItem(id); break;
    case 'back-to-list':  await selectSection(state.activeSection); break;
    case 'cancel-edit':   cancelEdit(); break;
    case 'unlink-effect': await unlinkEffect(e.currentTarget.dataset.effectName); break;
    case 'link-effect':   await linkEffect(); break;
    case 'toggle-new-effect': toggleNewEffectForm(); break;
    case 'cancel-new-effect': toggleNewEffectForm(false); break;
    case 'save-link-effect':  await saveAndLinkEffect(); break;
    case 'save-and-next':     await handleSaveAndNext(); break;
    case 'add-from-tea':      await openTeaSelector(); break;
    case 'fetch-images':      await fetchImagesFromGbif(); break;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function selectSection(section) {
  state.activeSection = section;
  state.screen = 'list';
  state.selectedItem = null;
  state.errorMsg = null;

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${section}`)?.classList.add('active');

  state.items = await fetchItems(section);
  render();
}

async function fetchItems(section) {
  if (section === 'herbs')   return api.get('/api/herbs');
  if (section === 'teas')    return api.get('/api/teas');
  if (section === 'effects') return api.get('/api/effects');
  return [];
}

// ── Detail ────────────────────────────────────────────────────────────────────

async function openDetail(id) {
  const section = state.activeSection;
  let item;

  if (section === 'teas') {
    item = await api.get(`/api/teas/${id}`);
    item.EFFECTS = await api.get(`/api/teas/${id}/effects`);
  } else if (section === 'herbs') {
    item = await api.get(`/api/herbs/${id}`);
  } else {
    item = await api.get(`/api/effects/${id}`);
  }

  state.selectedItem = item;
  state.screen = 'detail';
  render();
}

// ── Edit ──────────────────────────────────────────────────────────────────────

async function openEditMode(id) {
  state.editMode = 'edit';
  state.editOrigin = state.screen;

  const section = state.activeSection;

  if (section === 'teas') {
    const item = await api.get(`/api/teas/${id}`);
    item.EFFECTS = await api.get(`/api/teas/${id}/effects`);
    state.allEffects = await api.get('/api/effects');
    state.selectedItem = item;
  } else if (section === 'herbs') {
    state.selectedItem = await api.get(`/api/herbs/${id}`);
  } else {
    state.selectedItem = await api.get(`/api/effects/${id}`);
  }

  state.screen = 'edit';
  render();
}

async function openNew() {
  state.editMode = 'new';
  state.editOrigin = 'list';
  state.selectedItem = null;

  if (state.activeSection === 'teas') {
    state.allEffects = await api.get('/api/effects');
  }

  state.screen = 'edit';
  render();
}

function cancelEdit() {
  state.errorMsg = null;
  if (state.editOrigin === 'detail' && state.selectedItem) {
    openDetail(state.selectedItem.ID);
  } else {
    selectSection(state.activeSection);
  }
}

// ── GBIF image fetch ──────────────────────────────────────────────────────────

async function fetchImagesFromGbif() {
  const form = document.getElementById('edit-form');
  const name   = form.querySelector('[name="name"]').value.trim();
  const genus  = form.querySelector('[name="genus"]').value.trim();
  const species = form.querySelector('[name="species"]').value.trim();
  const family = form.querySelector('[name="family"]').value.trim();
  const status = document.getElementById('fetch-images-status');

  if (!name || !genus) {
    status.textContent = 'Name and Genus are required.';
    return;
  }

  status.textContent = 'Fetching…';
  const result = await api.post('/api/gbif/fetch-images', { name, genus, species, family });

  if (result.error) {
    status.textContent = `Error: ${result.error}`;
  } else if (!result.saved.length) {
    status.textContent = 'No images found.';
  } else {
    status.textContent = `${result.saved.length} image(s) saved.`;
    if (!state.editMode === 'new') render();
  }
}

// ── Tea selector (for new herb) ───────────────────────────────────────────────

async function openTeaSelector() {
  const teas = await api.get('/api/herbs/teas-without-herb');

  const rows = teas.map(t => `
    <div class="tea-pick-row"
         data-genus="${esc(t.GENUS || '')}"
         data-species="${esc(t.SPECIES || '')}"
         data-family="${esc(t.FAMILY || '')}">
      <span class="tea-pick-name">${esc(t.NAME)}</span>
      <span class="tea-pick-meta">${esc([t.GENUS, t.SPECIES].filter(Boolean).join(' '))}</span>
    </div>`).join('');

  const modal = document.createElement('div');
  modal.className = 'tea-selector-backdrop';
  modal.innerHTML = `
    <div class="tea-selector-panel">
      <div class="tea-selector-header">
        <span>Choose a tea</span>
        <button class="btn btn-gray btn-icon" id="close-tea-selector">✕</button>
      </div>
      <div class="tea-selector-list">
        ${rows || '<p class="tea-selector-empty">No teas without a matching herb.</p>'}
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#close-tea-selector').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelectorAll('.tea-pick-row').forEach(row => {
    row.addEventListener('click', async () => {
      modal.remove();
      const form = document.getElementById('edit-form');
      form.querySelector('[name="genus"]').value   = row.dataset.genus;
      form.querySelector('[name="species"]').value = row.dataset.species;
      form.querySelector('[name="family"]').value  = row.dataset.family;

      const names = await api.get(
        `/api/gbif/common-names?genus=${encodeURIComponent(row.dataset.genus)}&species=${encodeURIComponent(row.dataset.species)}&family=${encodeURIComponent(row.dataset.family)}`
      );
      if (names && names.length) {
        form.querySelector('[name="name"]').value        = names[0];
        form.querySelector('[name="other_names"]').value = names.slice(1).join(', ');
      }
    });
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function handleSave(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const section = state.activeSection;
  const isNew = state.editMode === 'new';

  if (section === 'herbs' && data.other_names !== undefined) {
    data.other_names = data.other_names.split(',').map(s => s.trim()).filter(Boolean);
  }

  let result;
  if (section === 'herbs') {
    result = isNew
      ? await api.post('/api/herbs', data)
      : await api.put(`/api/herbs/${state.selectedItem.ID}`, data);
  } else if (section === 'teas') {
    result = isNew
      ? await api.post('/api/teas', data)
      : await api.put(`/api/teas/${state.selectedItem.ID}`, data);
  } else {
    result = isNew
      ? await api.post('/api/effects', data)
      : await api.put(`/api/effects/${state.selectedItem.ID}`, data);
  }

  if (result.error) {
    state.errorMsg = result.error;
    render();
    return;
  }

  const savedId = isNew ? result.id : state.selectedItem.ID;

  if (state.editOrigin === 'detail') {
    await openDetail(savedId);
  } else {
    await selectSection(section);
  }
}

async function handleSaveAndNext() {
  const form = document.getElementById('edit-form');
  if (!form) return;

  const currentIdx = state.items.findIndex(i => i.ID === state.selectedItem?.ID);
  const nextItem = state.items[currentIdx + 1];
  if (!nextItem) return;

  const data = Object.fromEntries(new FormData(form).entries());
  const section = state.activeSection;

  if (section === 'herbs' && data.other_names !== undefined) {
    data.other_names = data.other_names.split(',').map(s => s.trim()).filter(Boolean);
  }

  let result;
  if (section === 'herbs')        result = await api.put(`/api/herbs/${state.selectedItem.ID}`, data);
  else if (section === 'teas')    result = await api.put(`/api/teas/${state.selectedItem.ID}`, data);
  else                            result = await api.put(`/api/effects/${state.selectedItem.ID}`, data);

  if (result.error) {
    state.errorMsg = result.error;
    render();
    return;
  }

  await openEditMode(nextItem.ID);
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteItem(id) {
  const section = state.activeSection;
  let result;
  if (section === 'herbs')        result = await api.del(`/api/herbs/${id}`);
  else if (section === 'teas')    result = await api.del(`/api/teas/${id}`);
  else                            result = await api.del(`/api/effects/${id}`);

  if (result.error) {
    state.errorMsg = result.error;
    render();
    return;
  }
  state.items = await fetchItems(section);
  render();
}

// ── Tea effects ───────────────────────────────────────────────────────────────

async function unlinkEffect(effectName) {
  const teaId = state.selectedItem.ID;
  await api.del(`/api/teas/${teaId}/effects/${encodeURIComponent(effectName)}`);
  await refreshTeaEffects(teaId);
}

async function linkEffect() {
  const teaId = state.selectedItem.ID;
  const picker = document.getElementById('effect-picker');
  if (!picker || !picker.value) return;
  const result = await api.post(`/api/teas/${teaId}/effects`, { effectName: picker.value });
  if (result.error) { state.errorMsg = result.error; render(); return; }
  await refreshTeaEffects(teaId);
}

function toggleNewEffectForm(show) {
  const form = document.getElementById('new-effect-form');
  if (!form) return;
  if (show === undefined) show = form.style.display === 'none';
  form.style.display = show ? 'flex' : 'none';
}

async function saveAndLinkEffect() {
  const name = document.getElementById('new-effect-name')?.value?.trim();
  const description = document.getElementById('new-effect-desc')?.value?.trim();
  const quality = document.getElementById('new-effect-quality')?.value;

  if (!name) { state.errorMsg = 'Effect name is required.'; render(); return; }

  const created = await api.post('/api/effects', { name, description, quality });
  if (created.error) { state.errorMsg = created.error; render(); return; }

  const teaId = state.selectedItem.ID;
  const linked = await api.post(`/api/teas/${teaId}/effects`, { effectName: name });
  if (linked.error) { state.errorMsg = linked.error; render(); return; }

  state.allEffects = await api.get('/api/effects');
  await refreshTeaEffects(teaId);
}

async function refreshTeaEffects(teaId) {
  state.selectedItem.EFFECTS = await api.get(`/api/teas/${teaId}/effects`);
  state.errorMsg = null;
  render();
}

// ── Sidebar wiring ────────────────────────────────────────────────────────────

document.getElementById('nav-herbs').addEventListener('click', () => selectSection('herbs'));
document.getElementById('nav-teas').addEventListener('click', () => selectSection('teas'));
document.getElementById('nav-effects').addEventListener('click', () => selectSection('effects'));
