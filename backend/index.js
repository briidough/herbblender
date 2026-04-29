require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const https = require('https');
const { connect } = require('./db');
const dal = require('./dal');

const app = express();
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/teabrowser', express.static(path.join(__dirname, '../teaBrowser')));

// ── GBIF ──────────────────────────────────────────────────────────────────────

const IMAGES_DIR = path.join(__dirname, 'images');

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '').replace(/'/g, '');
}

function extFromContentType(ct) {
  if (!ct) return '.jpg';
  if (ct.includes('jpeg')) return '.jpg';
  if (ct.includes('png'))  return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif'))  return '.gif';
  return '.jpg';
}

function downloadFile(url, destPath, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'HerbBlender/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, destPath, redirects - 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const ext = extFromContentType(res.headers['content-type']);
      const finalPath = destPath.replace(/\.\w+$/, ext);
      const stream = fs.createWriteStream(finalPath);
      res.pipe(stream);
      stream.on('finish', () => resolve(finalPath));
      stream.on('error', reject);
    }).on('error', reject);
  });
}

function gbifGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HerbBlender/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

app.get('/api/gbif/common-names', async (req, res) => {
  try {
    const { genus, species, family } = req.query;
    const match = await gbifGet(
      `https://api.gbif.org/v1/species/match?family=${encodeURIComponent(family || '')}&genus=${encodeURIComponent(genus || '')}&species=${encodeURIComponent(species || '')}`
    );
    if (!match.usageKey) return res.json([]);

    const vn = await gbifGet(
      `https://api.gbif.org/v1/species/${match.usageKey}/vernacularNames?limit=100`
    );
    const seen = new Set();
    const names = (vn.results || [])
      .filter(n => n.language === 'eng' && n.vernacularName)
      .map(n => n.vernacularName.trim())
      .filter(n => n && !n.includes('-'))
      .filter(n => { if (seen.has(n.toLowerCase())) return false; seen.add(n.toLowerCase()); return true; });

    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gbif/fetch-images', async (req, res) => {
  try {
    const { name, genus, species, family } = req.body;
    if (!name || !genus) return res.status(400).json({ error: 'name and genus are required' });

    const match = await gbifGet(
      `https://api.gbif.org/v1/species/match?family=${encodeURIComponent(family || '')}&genus=${encodeURIComponent(genus || '')}&species=${encodeURIComponent(species || '')}`
    );
    if (!match.usageKey) return res.json({ saved: [] });

    const occurrences = await gbifGet(
      `https://api.gbif.org/v1/occurrence/search?taxonKey=${match.usageKey}&mediaType=StillImage&limit=20`
    );

    const seenUrls = new Set();
    const imageUrls = [];
    for (const occ of (occurrences.results || [])) {
      for (const media of (occ.media || [])) {
        if (media.type === 'StillImage' && media.identifier && !seenUrls.has(media.identifier)) {
          seenUrls.add(media.identifier);
          imageUrls.push(media.identifier);
          if (imageUrls.length === 3) break;
        }
      }
      if (imageUrls.length === 3) break;
    }

    const slug = slugify(name);
    const dir  = path.join(IMAGES_DIR, 'plants', slug);
    fs.mkdirSync(dir, { recursive: true });

    const saved = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const dest = path.join(dir, `${slug}_${i}.jpg`);
        const finalPath = await downloadFile(imageUrls[i], dest);
        saved.push(`plants/${slug}/${path.basename(finalPath)}`);
      } catch {
        // skip failed downloads
      }
    }

    res.json({ saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Herbs (read) ──────────────────────────────────────────────────────────────

app.get('/api/herbs', async (req, res) => {
  try {
    const herbs = await dal.getHerbs();
    res.json(herbs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/herbs/teas-without-herb', async (req, res) => {
  try {
    const teas = await dal.getTeasWithoutHerb();
    res.json(teas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/herbs/:id/teas', async (req, res) => {
  try {
    const teas = await dal.getTeasByHerb(req.params.id);
    res.json(teas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/herbs/:id', async (req, res) => {
  try {
    const herb = await dal.getHerbById(req.params.id);
    if (!herb) return res.status(404).json({ error: 'Herb not found' });
    res.json(herb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Herbs (write) ─────────────────────────────────────────────────────────────

app.post('/api/herbs', async (req, res) => {
  try {
    const { name, genus, species, family, description, nativeRange, other_names } = req.body;
    const id = await dal.addHerb({ name, genus, species, family, description, nativeRange, otherNames: other_names });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/herbs/:id', async (req, res) => {
  try {
    const { name, genus, species, family, description, nativeRange, other_names } = req.body;
    await dal.updateHerb(req.params.id, { name, genus, species, family, description, nativeRange, otherNames: other_names });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/herbs/:id', async (req, res) => {
  try {
    await dal.deleteHerb(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Teas (read) ───────────────────────────────────────────────────────────────

app.get('/api/teas', async (req, res) => {
  try {
    const teas = await dal.getTeas();
    res.json(teas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teas/:id/effects', async (req, res) => {
  try {
    const effects = await dal.getEffectsForTea(req.params.id);
    res.json(effects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teas/:id/plant', async (req, res) => {
  try {
    const plant = await dal.getTeaPlant(req.params.id);
    if (!plant) return res.status(404).json({ error: 'Plant not found' });
    res.json(plant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teas/:id', async (req, res) => {
  try {
    const tea = await dal.getTeaById(req.params.id);
    if (!tea) return res.status(404).json({ error: 'Tea not found' });
    res.json(tea);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Teas (write) ──────────────────────────────────────────────────────────────

app.post('/api/teas', async (req, res) => {
  try {
    const { name, description, genus, species, family, oxidation, fermentation } = req.body;
    const id = await dal.addTea({ name, description, genus, species, family, oxidation, fermentation });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teas/:id', async (req, res) => {
  try {
    const { name, description, genus, species, family, oxidation, fermentation } = req.body;
    await dal.updateTea(req.params.id, { name, description, genus, species, family, oxidation, fermentation });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teas/:id', async (req, res) => {
  try {
    await dal.deleteTea(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tea effect links ──────────────────────────────────────────────────────────

app.post('/api/teas/:id/effects', async (req, res) => {
  try {
    await dal.linkEffectToTea(req.params.id, req.body.effectName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teas/:id/effects/:effectName', async (req, res) => {
  try {
    await dal.unlinkEffectFromTea(req.params.id, req.params.effectName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Blend ─────────────────────────────────────────────────────────────────────

app.get('/api/blend', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 3);
    if (ids.length === 0) return res.status(400).json({ error: 'Provide up to 3 tea IDs via ?ids=id1,id2,id3' });
    const blend = await dal.getBlend(ids);
    res.json(blend);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Effects ───────────────────────────────────────────────────────────────────

app.get('/api/effects', async (req, res) => {
  try {
    const effects = await dal.getEffects();
    res.json(effects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/effects/:id', async (req, res) => {
  try {
    const effect = await dal.getEffectById(req.params.id);
    if (!effect) return res.status(404).json({ error: 'Effect not found' });
    res.json(effect);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/effects', async (req, res) => {
  try {
    const { name, description, quality } = req.body;
    const id = await dal.addEffect({ name, description, quality });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/effects/:id', async (req, res) => {
  try {
    const { name, description, quality } = req.body;
    await dal.updateEffect(req.params.id, { name, description, quality });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/effects/:id', async (req, res) => {
  try {
    await dal.deleteEffect(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Compounds ─────────────────────────────────────────────────────────────────

app.get('/api/compounds', async (req, res) => {
  try {
    const compounds = await dal.getCompounds();
    res.json(compounds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/compounds/:id', async (req, res) => {
  try {
    const compound = await dal.getCompoundById(req.params.id);
    if (!compound) return res.status(404).json({ error: 'Compound not found' });
    res.json(compound);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compounds', async (req, res) => {
  try {
    const { type, name, wikilink, psychoactive, effects } = req.body;
    const id = await dal.addCompound({ type, name, wikilink, psychoactive, effects });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/compounds/:id', async (req, res) => {
  try {
    const { type, name, wikilink, psychoactive, effects } = req.body;
    await dal.updateCompound(req.params.id, { type, name, wikilink, psychoactive, effects });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/compounds/:id', async (req, res) => {
  try {
    await dal.deleteCompound(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
connect().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`HerbBlender backend running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
