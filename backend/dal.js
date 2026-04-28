const { ObjectId } = require('mongodb');
const { db } = require('./db');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, 'images');

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '');
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
    NAME:         p.name,
    GENUS:        p.genus,
    SPECIES:      p.species,
    FAMILY:       p.family,
    DESCRIPTION:  p.description,
    NATIVE_RANGE: p.nativeRange || [],
    IMAGE_PATH:   firstImage('plants', p.name)
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

async function addHerb({ name, genus, species, family, description, nativeRange }) {
  const result = await db().collection('plants').insertOne(
    { name, genus, species, family, description, nativeRange: nativeRange || [] }
  );
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

module.exports = {
  getTeas, getTeaById, addTea, updateTea, deleteTea,
  getEffectsForTea, getTeaWithEffects, getBlend,
  linkEffectToTea, unlinkEffectFromTea,
  getTeaPlant,
  getHerbs, getHerbById, addHerb, updateHerb, deleteHerb,
  getEffects, getEffectById, addEffect, updateEffect, deleteEffect,
};
