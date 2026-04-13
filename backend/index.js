require('dotenv').config();
const express = require('express');
const multer = require('multer');
const dal = require('./dal');

const app = express();
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    const { name, genus, species, description, other_names } = req.body;
    const id = await dal.addHerb({ name, genus, species, description, other_names });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/herbs/:id', async (req, res) => {
  try {
    const { name, genus, species, description, other_names } = req.body;
    await dal.updateHerb(req.params.id, { name, genus, species, description, other_names });
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
    if (err.errorNum === 2292) {
      return res.status(409).json({ error: 'Cannot delete herb: teas are still linked to it.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Herb images ───────────────────────────────────────────────────────────────

app.get('/api/herbs/:id/images', async (req, res) => {
  try {
    const images = await dal.getImagesForHerb(req.params.id);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/herbs/:id/images', upload.single('image'), async (req, res) => {
  try {
    const id = await dal.addImageToHerb(req.params.id, {
      buffer: req.file.buffer,
      imageExt: req.file.mimetype,
      imageName: req.file.originalname,
    });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/herbs/:id/images/:imageId', async (req, res) => {
  try {
    await dal.deleteHerbImage(req.params.id, req.params.imageId);
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

app.get('/api/teas/:id/herb', async (req, res) => {
  try {
    const herb = await dal.getTeaHerb(req.params.id);
    res.json(herb);
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
    const { name, description, herb_id, oxidation } = req.body;
    const id = await dal.addTea({ name, description, herb_id, oxidation });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teas/:id', async (req, res) => {
  try {
    const { name, description, herb_id, oxidation } = req.body;
    await dal.updateTea(req.params.id, { name, description, herb_id, oxidation });
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
    await dal.linkEffectToTea(req.params.id, req.body.effectId);
    res.json({ ok: true });
  } catch (err) {
    if (err.errorNum === 1) {
      return res.status(409).json({ error: 'Effect is already linked to this tea.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teas/:id/effects/:effectId', async (req, res) => {
  try {
    await dal.unlinkEffectFromTea(req.params.id, req.params.effectId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tea images ────────────────────────────────────────────────────────────────

app.get('/api/teas/:id/images', async (req, res) => {
  try {
    const images = await dal.getImagesForTea(req.params.id);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teas/:id/images', upload.single('image'), async (req, res) => {
  try {
    const id = await dal.addImageToTea(req.params.id, {
      buffer: req.file.buffer,
      imageExt: req.file.mimetype,
      imageName: req.file.originalname,
    });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teas/:id/images/:imageId', async (req, res) => {
  try {
    await dal.deleteTeaImage(req.params.id, req.params.imageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Blend ─────────────────────────────────────────────────────────────────────

app.get('/api/blend', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 3);
    if (ids.length === 0) return res.status(400).json({ error: 'Provide up to 3 tea IDs via ?ids=1,2,3' });
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
    if (err.errorNum === 2292) {
      return res.status(409).json({ error: 'Cannot delete effect: it is still linked to one or more teas.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Images (serve blob) ───────────────────────────────────────────────────────

app.get('/api/images/:id', async (req, res) => {
  try {
    const image = await dal.getImageBlob(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.setHeader('Content-Type', image.IMAGE_EXT);
    res.send(image.IMAGE_BLOB);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HerbBlender backend running on port ${PORT}`));
