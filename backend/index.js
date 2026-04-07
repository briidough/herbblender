require('dotenv').config();
const express = require('express');
const dal = require('./dal');

const app = express();
app.use(express.json());

// Herbs
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

// Teas
app.get('/api/teas', async (req, res) => {
  try {
    const teas = await dal.getTeas();
    res.json(teas);
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

// Blend — accepts comma-separated tea IDs, e.g. /api/blend?ids=1,2,3
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HerbBlender backend running on port ${PORT}`));
