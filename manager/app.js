// OracleDB returns uppercase column names: ID, NAME, DESCRIPTION, etc.
// All field access uses uppercase keys to match.

const state = {
  activeSection: null,  // 'herbs' | 'teas' | 'effects'
  screen: null,         // 'list' | 'detail' | 'edit'
  items: [],
  selectedItem: null,
  allEffects: [],       // full effect list for tea editor picker
  allHerbs: [],         // full herb list for tea editor herb select
  editMode: null,       // 'new' | 'edit'
  editOrigin: null,     // 'list' | 'detail'
  images: [],           // image metadata for current herb or tea
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
  upload: (path, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return fetch(path, { method: 'POST', body: fd }).then(r => r.json());
  },
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
        <span class="detail-label">Genus</span><span class="detail-value">${esc(item.GENUS || '')}</span>
        <span class="detail-label">Species</span><span class="detail-value">${esc(item.SPECIES || '')}</span>
        <span class="detail-label">Other names</span><span class="detail-value">${esc(item.OTHER_NAMES || '')}</span>
        <span class="detail-label">Description</span><span class="detail-value">${esc(item.DESCRIPTION || '')}</span>
      </div>`;
  } else if (section === 'teas') {
    const herbName = state.allHerbs.find(h => h.ID === item.HERB_ID)?.NAME ?? item.HERB_ID ?? '';
    const effectsHtml = (item.EFFECTS || []).length
      ? `<div class="effects-list">${(item.EFFECTS || []).map(e =>
          `<span class="effect-chip ${qualityClass(e.QUALITY)}">${esc(e.NAME)}</span>`).join('')}</div>`
      : '<span style="color:#90a4ae;font-size:0.85rem">None</span>';
    fields = `
      <div class="detail-grid">
        <span class="detail-label">Herb</span><span class="detail-value">${esc(String(herbName))}</span>
        <span class="detail-label">Oxidation</span><span class="detail-value">${esc(item.OXIDATION || '')}</span>
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

  const imagesHtml = (section === 'herbs' || section === 'teas')
    ? `<div class="detail-section-title">Images</div>
       <div class="image-gallery">
         ${state.images.length
           ? state.images.map(img => `
               <div class="image-card">
                 <img class="image-thumb" src="/api/images/${img.ID}" alt="${esc(img.IMAGE_NAME || '')}">
               </div>`).join('')
           : '<span style="color:#90a4ae;font-size:0.85rem">No images.</span>'}
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
      ${imagesHtml}
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

  let formFields = '';
  if (section === 'herbs') {
    formFields = `
      ${field('name', 'Name', item?.NAME, 'text', true)}
      ${field('genus', 'Genus', item?.GENUS)}
      ${field('species', 'Species', item?.SPECIES)}
      ${field('other_names', 'Other Names', item?.OTHER_NAMES)}
      ${textarea('description', 'Description', item?.DESCRIPTION)}`;

  } else if (section === 'teas') {
    const herbOptions = state.allHerbs.map(h =>
      `<option value="${h.ID}" ${item?.HERB_ID === h.ID ? 'selected' : ''}>${esc(h.NAME)}</option>`
    ).join('');
    const currentEffects = (item?.EFFECTS || []).map(e => `
      <div class="effect-row">
        <span class="effect-row-name">${esc(e.NAME)}</span>
        <span class="quality-badge ${qualityClass(e.QUALITY)}">${esc(e.QUALITY || '')}</span>
        <button class="btn btn-red btn-icon" data-action="unlink-effect" data-effect-id="${e.ID}">−</button>
      </div>`).join('');

    const linkedIds = new Set((item?.EFFECTS || []).map(e => e.ID));
    const availableEffects = state.allEffects.filter(e => !linkedIds.has(e.ID));
    const effectOptions = availableEffects.map(e =>
      `<option value="${e.ID}">${esc(e.NAME)}</option>`).join('');

    formFields = `
      ${field('name', 'Name', item?.NAME, 'text', true)}
      <div class="form-field">
        <label>Herb</label>
        <select name="herb_id">${herbOptions}</select>
      </div>
      ${field('oxidation', 'Oxidation', item?.OXIDATION)}
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
            <div style="display:flex;gap:0.4rem">
              <button class="btn btn-green btn-icon" data-action="save-link-effect">Save &amp; Link</button>
              <button class="btn btn-gray btn-icon" data-action="cancel-new-effect">Cancel</button>
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

  const imagesSection = (!isNew && (section === 'herbs' || section === 'teas'))
    ? `<div class="form-field">
        <label>Images</label>
        <div class="image-gallery">
          ${state.images.map(img => `
            <div class="image-card">
              <img class="image-thumb" src="/api/images/${img.ID}" alt="${esc(img.IMAGE_NAME || '')}">
              <button class="btn image-delete-btn" data-action="delete-image" data-image-id="${img.ID}" title="Remove">×</button>
            </div>`).join('')}
        </div>
        <div class="image-upload-row">
          <input type="file" id="image-file-input" accept="image/*">
          <button class="btn btn-green btn-icon" data-action="upload-image">Upload</button>
        </div>
       </div>`
    : '';

  return `
    <div class="edit-form">
      <h2>${title}</h2>
      ${state.errorMsg ? `<div class="error-banner">${esc(state.errorMsg)}</div>` : ''}
      <form id="edit-form" autocomplete="off">
        ${formFields}
        ${imagesSection}
        <div class="form-actions">
          <button type="submit" class="btn btn-blue">Save</button>
          <button type="button" class="btn btn-gray" data-action="cancel-edit">Cancel</button>
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
  const id = e.currentTarget.dataset.id ? Number(e.currentTarget.dataset.id) : null;

  state.errorMsg = null;

  switch (action) {
    case 'open-detail':   await openDetail(id); break;
    case 'open-edit':     await openEditMode(id); break;
    case 'open-new':      await openNew(); break;
    case 'delete-item':   await deleteItem(id); break;
    case 'back-to-list':  await selectSection(state.activeSection); break;
    case 'cancel-edit':   cancelEdit(); break;
    case 'unlink-effect': await unlinkEffect(Number(e.currentTarget.dataset.effectId)); break;
    case 'link-effect':   await linkEffect(); break;
    case 'toggle-new-effect': toggleNewEffectForm(); break;
    case 'cancel-new-effect': toggleNewEffectForm(false); break;
    case 'save-link-effect':  await saveAndLinkEffect(); break;
    case 'upload-image':  await uploadImage(); break;
    case 'delete-image':  await deleteImage(Number(e.currentTarget.dataset.imageId)); break;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function selectSection(section) {
  state.activeSection = section;
  state.screen = 'list';
  state.selectedItem = null;
  state.images = [];
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
    // Ensure allHerbs is loaded for herb name lookup
    if (!state.allHerbs.length) state.allHerbs = await api.get('/api/herbs');
  } else if (section === 'herbs') {
    item = await api.get(`/api/herbs/${id}`);
  } else {
    item = await api.get(`/api/effects/${id}`);
  }

  state.selectedItem = item;
  state.screen = 'detail';

  if (section === 'herbs' || section === 'teas') {
    state.images = await api.get(`/api/${section}/${id}/images`);
  }

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
    const [allEffects, allHerbs] = await Promise.all([
      api.get('/api/effects'),
      api.get('/api/herbs'),
    ]);
    state.allEffects = allEffects;
    state.allHerbs = allHerbs;
    state.selectedItem = item;
  } else if (section === 'herbs') {
    state.selectedItem = await api.get(`/api/herbs/${id}`);
  } else {
    state.selectedItem = await api.get(`/api/effects/${id}`);
  }

  if (section === 'herbs' || section === 'teas') {
    state.images = await api.get(`/api/${section}/${id}/images`);
  }

  state.screen = 'edit';
  render();
}

async function openNew() {
  state.editMode = 'new';
  state.editOrigin = 'list';
  state.selectedItem = null;
  state.images = [];

  if (state.activeSection === 'teas') {
    const [allEffects, allHerbs] = await Promise.all([
      api.get('/api/effects'),
      api.get('/api/herbs'),
    ]);
    state.allEffects = allEffects;
    state.allHerbs = allHerbs;
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

// ── Save ──────────────────────────────────────────────────────────────────────

async function handleSave(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const section = state.activeSection;
  const isNew = state.editMode === 'new';

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

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteItem(id) {
  const section = state.activeSection;
  let result;
  if (section === 'herbs')   result = await api.del(`/api/herbs/${id}`);
  else if (section === 'teas')    result = await api.del(`/api/teas/${id}`);
  else result = await api.del(`/api/effects/${id}`);

  if (result.error) {
    state.errorMsg = result.error;
    render();
    return;
  }
  state.items = await fetchItems(section);
  render();
}

// ── Tea effects ───────────────────────────────────────────────────────────────

async function unlinkEffect(effectId) {
  const teaId = state.selectedItem.ID;
  await api.del(`/api/teas/${teaId}/effects/${effectId}`);
  await refreshTeaEffects(teaId);
}

async function linkEffect() {
  const teaId = state.selectedItem.ID;
  const picker = document.getElementById('effect-picker');
  if (!picker || !picker.value) return;
  const result = await api.post(`/api/teas/${teaId}/effects`, { effectId: Number(picker.value) });
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
  const linked = await api.post(`/api/teas/${teaId}/effects`, { effectId: created.id });
  if (linked.error) { state.errorMsg = linked.error; render(); return; }

  state.allEffects = await api.get('/api/effects');
  await refreshTeaEffects(teaId);
}

async function refreshTeaEffects(teaId) {
  state.selectedItem.EFFECTS = await api.get(`/api/teas/${teaId}/effects`);
  state.errorMsg = null;
  render();
}

// ── Images ────────────────────────────────────────────────────────────────────

async function uploadImage() {
  const input = document.getElementById('image-file-input');
  if (!input || !input.files.length) return;
  const section = state.activeSection;
  const id = state.selectedItem.ID;
  const result = await api.upload(`/api/${section}/${id}/images`, input.files[0]);
  if (result.error) { state.errorMsg = result.error; render(); return; }
  state.images = await api.get(`/api/${section}/${id}/images`);
  render();
}

async function deleteImage(imageId) {
  const section = state.activeSection;
  const id = state.selectedItem.ID;
  await api.del(`/api/${section}/${id}/images/${imageId}`);
  state.images = await api.get(`/api/${section}/${id}/images`);
  render();
}

// ── Sidebar wiring ────────────────────────────────────────────────────────────

document.getElementById('nav-herbs').addEventListener('click', () => selectSection('herbs'));
document.getElementById('nav-teas').addEventListener('click', () => selectSection('teas'));
document.getElementById('nav-effects').addEventListener('click', () => selectSection('effects'));
