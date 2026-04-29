'use strict';

const EFFECT_MOOD_MAP = {
  'Natural Energy':            'effect-energizing',
  'Focus & Clarity':           'effect-energizing',
  'Metabolic Support':         'effect-energizing',
  'Mood Balance':              'effect-energizing',
  'Antidepressant':            'effect-energizing',
  'Sweetening Agent':          'effect-energizing',
  'Relaxation & Calm':         'effect-calming',
  'Stress Reduction':          'effect-calming',
  'Aid Sleep':                 'effect-calming',
  'Anxiolytic':                'effect-calming',
  'Sedative':                  'effect-calming',
  'Adaptogenic Support':       'effect-calming',
  'Antioxidant':               'effect-protective',
  'Anti-inflammatory':         'effect-protective',
  'Cell Protection':           'effect-protective',
  'Neuroprotective':           'effect-protective',
  'Antimicrobial':             'effect-protective',
  'Antiviral Support':         'effect-protective',
  'Immune Support':            'effect-protective',
  'Cardiovascular Support':    'effect-supportive',
  'Blood Pressure Regulation': 'effect-supportive',
  'Blood Sugar Regulation':    'effect-supportive',
  'Cholesterol Reduction':     'effect-supportive',
  'Respiratory Support':       'effect-supportive',
  'Liver Support':             'effect-supportive',
  'Ease Digestion':            'effect-supportive',
  'Gut Health':                'effect-supportive',
  'Detox Support':             'effect-supportive',
  'Hydration & Refreshment':   'effect-supportive',
  'Astringent':                'effect-supportive',
};

function moodClass(name) {
  return EFFECT_MOOD_MAP[name] || 'effect-supportive';
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  teas:      null,
  herbs:     null,
  compounds: null,
};

// ── Panel navigation ──────────────────────────────────────────────────────────

function showPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + panelId);
  const navItem = document.querySelector(`[data-panel="${panelId}"]`);
  if (panel)   panel.classList.add('active');
  if (navItem) navItem.classList.add('active');

  if (panelId === 'tea-dict')      loadAndRenderTeas();
  if (panelId === 'plant-dict')    loadAndRenderPlants();
  if (panelId === 'compound-dict') loadAndRenderCompounds();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function loadTeas() {
  if (state.teas) return state.teas;
  state.teas = await fetchJSON('/api/teas');
  state.teas.sort((a, b) => a.NAME.localeCompare(b.NAME));
  return state.teas;
}

async function loadHerbs() {
  if (state.herbs) return state.herbs;
  state.herbs = await fetchJSON('/api/herbs');
  state.herbs.sort((a, b) => a.NAME.localeCompare(b.NAME));
  return state.herbs;
}

async function loadCompounds() {
  if (state.compounds) return state.compounds;
  state.compounds = await fetchJSON('/api/compounds');
  return state.compounds;
}

function getTeaNamesForHerb(herb) {
  if (!state.teas) return [];
  return state.teas
    .filter(t => t.GENUS === herb.GENUS && t.SPECIES === herb.SPECIES)
    .map(t => t.NAME);
}

// ── Tea Dictionary ────────────────────────────────────────────────────────────

async function loadAndRenderTeas() {
  const tbody = document.getElementById('tea-tbody');
  if (!state.teas) {
    tbody.innerHTML = '<tr><td colspan="4" class="panel-loading">Loading…</td></tr>';
  }
  try {
    await loadTeas();
    populateTeaEffectFilter();
    renderTeaTable();
  } catch {
    tbody.innerHTML = '<tr><td colspan="4" class="panel-empty">Failed to load teas.</td></tr>';
  }
}

function populateTeaEffectFilter() {
  const sel = document.getElementById('tea-effect-filter');
  const existing = new Set([...sel.options].map(o => o.value));
  const allEffects = [...new Set(state.teas.flatMap(t => t.EFFECT_NAMES))].sort();
  for (const e of allEffects) {
    if (!existing.has(e)) {
      const opt = document.createElement('option');
      opt.value = e;
      opt.textContent = e;
      sel.appendChild(opt);
    }
  }
}

function renderTeaTable() {
  const filterVal = document.getElementById('tea-effect-filter').value;
  const teas = filterVal
    ? state.teas.filter(t => t.EFFECT_NAMES.includes(filterVal))
    : state.teas;
  const tbody = document.getElementById('tea-tbody');
  if (!teas.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="panel-empty">No teas found.</td></tr>';
    return;
  }
  tbody.innerHTML = teas.map(t => `
    <tr data-tea-id="${esc(t.ID)}">
      <td>${esc(t.NAME)}</td>
      <td>${esc(t.OXIDATION || '—')}</td>
      <td>${esc(t.FERMENTATION || '—')}</td>
      <td>${(t.EFFECT_NAMES || []).map(e => esc(e)).join(', ') || '—'}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr[data-tea-id]').forEach(row => {
    row.addEventListener('click', () => {
      const tea = state.teas.find(t => t.ID === row.dataset.teaId);
      if (tea) openTeaDetail(tea);
    });
  });
}

// ── Plant Dictionary ──────────────────────────────────────────────────────────

async function loadAndRenderPlants() {
  const tbody = document.getElementById('plant-tbody');
  if (!state.herbs) {
    tbody.innerHTML = '<tr><td colspan="5" class="panel-loading">Loading…</td></tr>';
  }
  try {
    await Promise.all([loadHerbs(), loadTeas()]);
    renderPlantTable();
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="panel-empty">Failed to load plants.</td></tr>';
  }
}

function renderPlantTable() {
  const search = document.getElementById('plant-search').value.toLowerCase();
  const herbs = search
    ? state.herbs.filter(h =>
        h.NAME.toLowerCase().includes(search) ||
        (h.GENUS   || '').toLowerCase().includes(search) ||
        (h.SPECIES || '').toLowerCase().includes(search)
      )
    : state.herbs;
  const tbody = document.getElementById('plant-tbody');
  if (!herbs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="panel-empty">No plants found.</td></tr>';
    return;
  }
  tbody.innerHTML = herbs.map(h => {
    const teas = getTeaNamesForHerb(h);
    return `
      <tr data-herb-id="${esc(h.ID)}">
        <td>${esc(h.NAME)}</td>
        <td>${esc(h.FAMILY  || '—')}</td>
        <td><em>${esc(h.GENUS   || '—')}</em></td>
        <td><em>${esc(h.SPECIES || '—')}</em></td>
        <td>${teas.length ? teas.map(n => esc(n)).join(', ') : '—'}</td>
      </tr>
    `;
  }).join('');
  tbody.querySelectorAll('tr[data-herb-id]').forEach(row => {
    row.addEventListener('click', () => {
      const herb = state.herbs.find(h => h.ID === row.dataset.herbId);
      if (herb) openPlantDetail(herb);
    });
  });
}

// ── Compounds Dictionary ──────────────────────────────────────────────────────

async function loadAndRenderCompounds() {
  const tbody = document.getElementById('compound-tbody');
  if (!state.compounds) {
    tbody.innerHTML = '<tr><td colspan="3" class="panel-loading">Loading…</td></tr>';
  }
  try {
    await loadCompounds();
    renderCompoundTable();
  } catch {
    tbody.innerHTML = '<tr><td colspan="3" class="panel-empty">Failed to load compounds.</td></tr>';
  }
}

function renderCompoundTable() {
  const filterVal = document.getElementById('compound-type-filter').value;
  const compounds = filterVal
    ? state.compounds.filter(c => c.TYPE === filterVal)
    : state.compounds;
  const tbody = document.getElementById('compound-tbody');
  if (!compounds.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="panel-empty">No compounds found.</td></tr>';
    return;
  }
  tbody.innerHTML = compounds.map(c => `
    <tr data-compound-id="${esc(c.ID)}">
      <td>${esc(c.NAME)}</td>
      <td>${(c.EFFECTS || []).map(e => esc(e)).join(', ') || '—'}</td>
      <td>
        ${c.WIKILINK
          ? `<a class="btn btn-wiki" href="${esc(c.WIKILINK)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Wiki ↗</a>`
          : `<span class="btn btn-wiki" data-empty>Wiki</span>`
        }
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr[data-compound-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'A') return;
      const compound = state.compounds.find(c => c.ID === row.dataset.compoundId);
      if (compound) openCompoundDetail(compound);
    });
  });
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function openOverlay(title, bodyHtml) {
  const root = document.getElementById('overlay-root');
  root.innerHTML = `
    <div class="overlay-backdrop" id="overlay-backdrop">
      <div class="overlay-panel">
        <div class="overlay-header">
          <h2>${esc(title)}</h2>
          <button class="overlay-close" id="overlay-close-btn">&#x2715;</button>
        </div>
        <div class="overlay-detail-body">${bodyHtml}</div>
      </div>
    </div>
  `;
  document.getElementById('overlay-close-btn').addEventListener('click', closeOverlay);
  document.getElementById('overlay-backdrop').addEventListener('click', e => {
    if (e.target.id === 'overlay-backdrop') closeOverlay();
  });
}

function closeOverlay() {
  document.getElementById('overlay-root').innerHTML = '';
}

// ── Tea detail ────────────────────────────────────────────────────────────────

async function openTeaDetail(tea) {
  const paths = tea.IMAGE_PATHS || [];
  const imagesHtml = paths.length
    ? `<div class="tea-images-row">${paths.map((p, i) =>
        `<img class="${i === 0 ? 'tea-img--large' : 'tea-img--extra'}" src="/images/${esc(p)}" alt="${esc(tea.NAME)}">`
      ).join('')}</div>`
    : `<div class="tea-images-row"><div class="tea-img-placeholder--large"></div></div>`;

  const chipsHtml = (tea.EFFECT_NAMES || []).length
    ? (tea.EFFECT_NAMES || []).map(e =>
        `<span class="effect-chip ${moodClass(e)}">${esc(e)}</span>`
      ).join('')
    : '<p class="empty-msg">No effects recorded.</p>';

  const bodyHtml = `
    ${imagesHtml}
    <div class="effects-grid">${chipsHtml}</div>
    <p class="overlay-full-desc">${esc(tea.DESCRIPTION || '')}</p>
    <div id="detail-plant-section" class="herb-info-section">
      <p class="empty-msg">Loading herb info…</p>
    </div>
  `;

  openOverlay(tea.NAME, bodyHtml);

  try {
    const plant = await fetchJSON(`/api/teas/${tea.ID}/plant`);
    const section = document.getElementById('detail-plant-section');
    if (!section) return;
    const imgHtml = plant.IMAGE_PATH
      ? `<img class="herb-img" src="/images/${esc(plant.IMAGE_PATH)}" alt="${esc(plant.NAME)}">`
      : '';
    section.innerHTML = `
      <h3 class="herb-info-title">Herb Info</h3>
      <p class="herb-info-name">${esc(plant.NAME)}</p>
      <p class="herb-info-classification"><em>${esc(plant.GENUS)} ${esc(plant.SPECIES)}</em></p>
      ${imgHtml}
      <p class="herb-info-desc">${esc(plant.DESCRIPTION || '')}</p>
    `;
  } catch {
    const section = document.getElementById('detail-plant-section');
    if (section) section.innerHTML = '';
  }
}

// ── Plant detail ──────────────────────────────────────────────────────────────

function openPlantDetail(herb) {
  const imgHtml = herb.IMAGE_PATH
    ? `<img class="plant-detail-img" src="/images/${esc(herb.IMAGE_PATH)}" alt="${esc(herb.NAME)}">`
    : '';

  const teas = getTeaNamesForHerb(herb);
  const teaChips = teas.length
    ? teas.map(n => `<span class="plant-detail-tea-chip">${esc(n)}</span>`).join('')
    : '<p class="empty-msg">No associated teas found.</p>';

  const bodyHtml = `
    <p class="plant-detail-classification"><em>${esc(herb.GENUS || '')} ${esc(herb.SPECIES || '')}</em></p>
    <p class="plant-detail-family">Family: <strong>${esc(herb.FAMILY || '—')}</strong></p>
    ${imgHtml}
    <p class="overlay-full-desc">${esc(herb.DESCRIPTION || '')}</p>
    <div class="plant-detail-teas">
      <h4>Associated Teas</h4>
      ${teaChips}
    </div>
  `;

  openOverlay(herb.NAME, bodyHtml);
}

// ── Compound detail ───────────────────────────────────────────────────────────

function openCompoundDetail(compound) {
  const effectsHtml = (compound.EFFECTS || []).length
    ? `<div class="compound-detail-effects">${
        compound.EFFECTS.map(e =>
          `<span class="effect-chip ${moodClass(e)}">${esc(e)}</span>`
        ).join('')
      }</div>`
    : '<p class="empty-msg">No effects recorded.</p>';

  const wikiHtml = compound.WIKILINK
    ? `<div class="compound-detail-wiki">
         <a class="btn btn-wiki" href="${esc(compound.WIKILINK)}" target="_blank" rel="noopener">Open Wikipedia ↗</a>
       </div>`
    : `<div class="compound-detail-wiki">
         <button class="btn btn-wiki" disabled>No wiki link</button>
       </div>`;

  const bodyHtml = `
    <span class="compound-detail-type">${esc(compound.TYPE)}</span>
    ${effectsHtml}
    ${wikiHtml}
  `;

  openOverlay(compound.NAME, bodyHtml);
}

// ── HTML escape ───────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Tea Blender availability check ────────────────────────────────────────────

async function checkTeaBlenderAvailable() {
  try {
    await fetch(`http://${window.location.hostname}:42727`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPanel(item.dataset.panel));
  });

  document.getElementById('tea-effect-filter').addEventListener('change', renderTeaTable);
  document.getElementById('plant-search').addEventListener('input', renderPlantTable);
  document.getElementById('compound-type-filter').addEventListener('change', renderCompoundTable);

  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');

  if (window.innerWidth < 768) {
    sidebar.classList.add('collapsed');
    btn.innerHTML = '&#8250;';
    btn.setAttribute('aria-label', 'Expand sidebar');
  }

  btn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    btn.innerHTML = collapsed ? '&#8250;' : '&#8249;';
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  });

  const available = await checkTeaBlenderAvailable();
  if (!available) {
    document.querySelector('[data-panel="tea-blender"]').remove();
    document.getElementById('panel-tea-blender').classList.remove('active');
    showPanel('tea-dict');
  } else {
    document.getElementById('tea-blender-iframe').src = `http://${window.location.hostname}:42727`;
  }
});
