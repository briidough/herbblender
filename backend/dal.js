const { ObjectId } = require('mongodb');
const { db } = require('./db');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, 'images');

function slugify(name) {

  return name.toLowerCase().replace(/\s+/g, '').replace('\'','');
}

function firstImage(subdir, name) {
  try {
    const slug = slugify(name);
    const dir = path.join(IMAGES_DIR, subdir, slug);
    const f = fs.readdirSync(dir).find(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
    return f ? `${subdir}/${slug}/${f}` : null;
  } catch { return null; }
}

function allImages(subdir, name) {
  try {
    const slug = slugify(name);
    const dir = path.join(IMAGES_DIR, subdir, slug);
    return fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .sort()
      .map(f => `${subdir}/${slug}/${f}`);
  } catch { return []; }
}

function toId(id) {
  return new ObjectId(id);
}

function normTea(t) {
  return {
    ID:           t._id.toString(),
    NAME:         t.name,
    DESCRIPTION:  t.description,
    OXIDATION:    t.oxidation,
    FERMENTATION: t.fermentation,
    GENUS:        t.genus,
    SPECIES:      t.species,
    FAMILY:       t.family,
    ALKALOIDS:    t.alkaloids || [],
    EFFECT_NAMES:  t.effects || [],
    IMAGE_PATH:    firstImage('teas', t.name),
    IMAGE_PATHS:   allImages('teas', t.name)
  };
}

function normEffect(e) {
  return {
    ID:          e._id.toString(),
    NAME:        e.name,
    DESCRIPTION: e.description,
    QUALITY:     e.quality
  };
}

function normPlant(p) {
  return {
    ID:                   p._id.toString(),
    NAME:                 p.name,
    GENUS:                p.genus,
    SPECIES:              p.species,
    FAMILY:               p.family,
    DESCRIPTION:          p.description,
    NATIVE_RANGE:         p.nativeRange || [],
    OTHER_NAMES:          p.otherNames || [],
    GBIF_USAGE_KEY:       p.gbifUsageKey || null,
    TAXONOMY:             p.taxonomy || null,
    COMMON_NAMES:         p.commonNames || [],
    CURRENT_RANGE:        p.currentRange || [],
    IMAGE_PATH:           firstImage('plants', p.name)
  };
}

function normCompound(c, type) {
  return {
    ID:           c._id.toString(),
    TYPE:         COMPOUND_TYPE_LABEL[type] || type,
    NAME:         c.name,
    EFFECTS:      c.effects || [],
    WIKILINK:     c.wikilink || null,
    PSYCHOACTIVE: c.psychoactive || null
  };
}

// ── Teas ─────────────────────────────────────────────────────────────────────

async function getTeas() {
  const teas = await db().collection('teas').find({}).toArray();
  return teas.map(normTea);
}

async function getTeaById(id) {
  const t = await db().collection('teas').findOne({ _id: toId(id) });
  return t ? normTea(t) : null;
}

async function addTea({ name, description, genus, species, family, oxidation, fermentation }) {
  const result = await db().collection('teas').insertOne(
    { name, description, genus, species, family, oxidation, fermentation, effects: [], alkaloids: [] }
  );
  return result.insertedId.toString();
}

async function updateTea(id, fields) {
  await db().collection('teas').updateOne({ _id: toId(id) }, { $set: fields });
}

async function deleteTea(id) {
  await db().collection('teas').deleteOne({ _id: toId(id) });
}

// ── Effects ───────────────────────────────────────────────────────────────────

async function getEffectsForTea(teaId) {
  const tea = await db().collection('teas').findOne({ _id: toId(teaId) });
  if (!tea || !tea.effects?.length) return [];
  const effects = await db().collection('effects').find({ name: { $in: tea.effects } }).toArray();
  return effects.map(normEffect);
}

async function getTeaWithEffects(id) {
  const tea = await getTeaById(id);
  if (!tea) return null;
  tea.EFFECTS = await getEffectsForTea(id);
  return tea;
}

async function getBlend(teaIds) {
  const teas = (await Promise.all(teaIds.map(getTeaWithEffects))).filter(Boolean);
  const effectMap = new Map();
  for (const tea of teas) {
    for (const e of tea.EFFECTS) {
      effectMap.set(e.NAME, e);
    }
  }
  return { teas, effects: [...effectMap.values()] };
}

async function linkEffectToTea(teaId, effectName) {
  await db().collection('teas').updateOne(
    { _id: toId(teaId) },
    { $addToSet: { effects: effectName } }
  );
}

async function unlinkEffectFromTea(teaId, effectName) {
  await db().collection('teas').updateOne(
    { _id: toId(teaId) },
    { $pull: { effects: effectName } }
  );
}

// ── Plants (herbs) ────────────────────────────────────────────────────────────

async function getHerbs() {
  const plants = await db().collection('plants').find({}).toArray();
  return plants.map(normPlant);
}

async function getHerbById(id) {
  const p = await db().collection('plants').findOne({ _id: toId(id) });
  return p ? normPlant(p) : null;
}

async function addHerb({ name, genus, species, family, description, nativeRange, otherNames }) {
  const result = await db().collection('plants').insertOne({
    name, genus, species, family, description,
    otherNames:          otherNames || [],
    nativeRange:         nativeRange || [],
    gbifUsageKey: null,
    taxonomy:     null,
    commonNames:  [],
    currentRange: [],
  });
  const slug = slugify(name);
  fs.mkdirSync(path.join(IMAGES_DIR, 'plants', slug), { recursive: true });
  return result.insertedId.toString();
}

async function updateHerb(id, fields) {
  await db().collection('plants').updateOne({ _id: toId(id) }, { $set: fields });
}

async function deleteHerb(id) {
  await db().collection('plants').deleteOne({ _id: toId(id) });
}

async function getTeaPlant(teaId) {
  const tea = await db().collection('teas').findOne({ _id: toId(teaId) });
  if (!tea) return null;
  const plant = await db().collection('plants').findOne({ genus: tea.genus, species: tea.species });
  return plant ? normPlant(plant) : null;
}

async function getTeasByHerb(herbId) {
  const plant = await db().collection('plants').findOne({ _id: toId(herbId) });
  if (!plant) return [];
  const teas = await db().collection('teas').find({ genus: plant.genus, species: plant.species }).toArray();
  return teas.map(normTea);
}

async function getTeasWithoutHerb() {
  const [plants, teas] = await Promise.all([
    db().collection('plants').find({}, { projection: { genus: 1, family: 1, species: 1 } }).toArray(),
    db().collection('teas').find({}).toArray(),
  ]);
  return teas
    .filter(t => !plants.some(p => p.genus === t.genus && p.family === t.family && p.species === t.species))
    .map(normTea);
}

// ── Effects (standalone CRUD) ─────────────────────────────────────────────────

async function getEffects() {
  const effects = await db().collection('effects').find({}).sort({ name: 1 }).toArray();
  return effects.map(normEffect);
}

async function getEffectById(id) {
  const e = await db().collection('effects').findOne({ _id: toId(id) });
  return e ? normEffect(e) : null;
}

async function addEffect({ name, description, quality }) {
  const result = await db().collection('effects').insertOne({ name, description, quality });
  return result.insertedId.toString();
}

async function updateEffect(id, fields) {
  await db().collection('effects').updateOne({ _id: toId(id) }, { $set: fields });
}

async function deleteEffect(id) {
  await db().collection('effects').deleteOne({ _id: toId(id) });
}

// ── Compounds ─────────────────────────────────────────────────────────────────

const COMPOUND_COLLECTIONS = ['alkaloids', 'polyphenols', 'terpenes', 'otherCompounds'];

const COMPOUND_TYPE_LABEL = {
  alkaloids:      'alkaloid',
  polyphenols:    'polyphenol',
  terpenes:       'terpene',
  otherCompounds: 'otherCompound',
};

async function getCompounds() {
  const results = await Promise.all(
    COMPOUND_COLLECTIONS.map(col =>
      db().collection(col).find({}).sort({ name: 1 }).toArray()
        .then(docs => docs.map(d => normCompound(d, col)))
    )
  );
  return results.flat().sort((a, b) => a.TYPE.localeCompare(b.TYPE) || a.NAME.localeCompare(b.NAME));
}

async function getCompoundById(id) {
  for (const col of COMPOUND_COLLECTIONS) {
    const c = await db().collection(col).findOne({ _id: toId(id) });
    if (c) return normCompound(c, col);
  }
  return null;
}

module.exports = {
  getTeas, getTeaById, addTea, updateTea, deleteTea,
  getEffectsForTea, getTeaWithEffects, getBlend,
  linkEffectToTea, unlinkEffectFromTea,
  getTeaPlant, getTeasByHerb, getTeasWithoutHerb,
  getHerbs, getHerbById, addHerb, updateHerb, deleteHerb,
  getEffects, getEffectById, addEffect, updateEffect, deleteEffect,
  getCompounds, getCompoundById,
};
