require('dotenv').config();
const path = require('path');
const express = require('express');
const { connect } = require('./db');
const dal = require('./dal');

const app = express();
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'images')));

// ── Herbs (read) ──────────────────────────────────────────────────────────────

app.get('/api/herbs', async (req, res) => {
  try {
    const herbs = await dal.getHerbs();
    res.json(herbs);
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
    const { name, genus, species, family, description, nativeRange } = req.body;
    const id = await dal.addHerb({ name, genus, species, family, description, nativeRange });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/herbs/:id', async (req, res) => {
  try {
    const { name, genus, species, family, description, nativeRange } = req.body;
    await dal.updateHerb(req.params.id, { name, genus, species, family, description, nativeRange });
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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
connect().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`HerbBlender backend running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
