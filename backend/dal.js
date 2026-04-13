const { getConnection } = require('./db');
const oracledb = require('oracledb');

// Return BLOB columns as Node.js Buffers automatically
oracledb.fetchAsBuffer = [oracledb.BLOB];

async function query(sql, binds = []) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows;
  } finally {
    if (conn) await conn.close();
  }
}

async function execute(sql, binds = {}) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(sql, binds, { autoCommit: true });
    return result;
  } finally {
    if (conn) await conn.close();
  }
}

// ── Herbs ────────────────────────────────────────────────────────────────────

async function getHerbs() {
  return query(`SELECT id, name, genus, species, description, other_names FROM to_herb`);
}

async function getHerbById(id) {
  const rows = await query(
    `SELECT id, name, genus, species, description, other_names FROM to_herb WHERE id = :id`,
    [id]
  );
  return rows[0] ?? null;
}

async function addHerb({ name, genus, species, description, other_names }) {
  const result = await execute(
    `INSERT INTO to_herb (name, genus, species, description, other_names)
     VALUES (:name, :genus, :species, :description, :other_names)
     RETURNING id INTO :outId`,
    { name, genus, species, description, other_names,
      outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
  );
  return result.outBinds.outId[0];
}

async function updateHerb(id, { name, genus, species, description, other_names }) {
  await execute(
    `UPDATE to_herb SET name=:name, genus=:genus, species=:species,
     description=:description, other_names=:other_names WHERE id=:id`,
    { name, genus, species, description, other_names, id: Number(id) }
  );
}

async function deleteHerb(id) {
  const images = await getImagesForHerb(id);
  await execute(`DELETE FROM to_images_herb WHERE herb_id=:id`, { id: Number(id) });
  for (const img of images) {
    await execute(`DELETE FROM to_images WHERE id=:id`, { id: img.ID });
  }
  await execute(`DELETE FROM to_herb WHERE id=:id`, { id: Number(id) });
}

// ── Teas ─────────────────────────────────────────────────────────────────────

async function getTeas() {
  return query(`SELECT id, name, description, herb_id, oxidation FROM to_tea`);
}

async function getTeaById(id) {
  const rows = await query(
    `SELECT id, name, description, herb_id, oxidation FROM to_tea WHERE id = :id`,
    [id]
  );
  return rows[0] ?? null;
}

async function addTea({ name, description, herb_id, oxidation }) {
  const result = await execute(
    `INSERT INTO to_tea (name, description, herb_id, oxidation)
     VALUES (:name, :description, :herb_id, :oxidation)
     RETURNING id INTO :outId`,
    { name, description, herb_id: Number(herb_id), oxidation,
      outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
  );
  return result.outBinds.outId[0];
}

async function updateTea(id, { name, description, herb_id, oxidation }) {
  await execute(
    `UPDATE to_tea SET name=:name, description=:description,
     herb_id=:herb_id, oxidation=:oxidation WHERE id=:id`,
    { name, description, herb_id: Number(herb_id), oxidation, id: Number(id) }
  );
}

async function deleteTea(id) {
  await execute(`DELETE FROM to_tea_effects WHERE tea_id=:id`, { id: Number(id) });
  const images = await getImagesForTea(id);
  await execute(`DELETE FROM to_images_tea WHERE tea_id=:id`, { id: Number(id) });
  for (const img of images) {
    await execute(`DELETE FROM to_images WHERE id=:id`, { id: img.ID });
  }
  await execute(`DELETE FROM to_tea WHERE id=:id`, { id: Number(id) });
}

// ── Effects ───────────────────────────────────────────────────────────────────

async function getEffectsForTea(teaId) {
  return query(
    `SELECT e.id, e.name, e.description, e.quality
     FROM to_effect e
     JOIN to_tea_effects te ON te.effect_id = e.id
     WHERE te.tea_id = :teaId`,
    [teaId]
  );
}

async function getTeaWithEffects(id) {
  const tea = await getTeaById(id);
  if (!tea) return null;
  tea.EFFECTS = await getEffectsForTea(id);
  return tea;
}

async function getEffects() {
  return query(`SELECT id, name, description, quality FROM to_effect ORDER BY name`);
}

async function getEffectById(id) {
  const rows = await query(
    `SELECT id, name, description, quality FROM to_effect WHERE id = :id`,
    [id]
  );
  return rows[0] ?? null;
}

async function addEffect({ name, description, quality }) {
  const result = await execute(
    `INSERT INTO to_effect (name, description, quality)
     VALUES (:name, :description, :quality) RETURNING id INTO :outId`,
    { name, description, quality,
      outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
  );
  return result.outBinds.outId[0];
}

async function updateEffect(id, { name, description, quality }) {
  await execute(
    `UPDATE to_effect SET name=:name, description=:description, quality=:quality WHERE id=:id`,
    { name, description, quality, id: Number(id) }
  );
}

async function deleteEffect(id) {
  await execute(`DELETE FROM to_effect WHERE id=:id`, { id: Number(id) });
}

async function linkEffectToTea(teaId, effectId) {
  await execute(
    `INSERT INTO to_tea_effects (tea_id, effect_id) VALUES (:teaId, :effectId)`,
    { teaId: Number(teaId), effectId: Number(effectId) }
  );
}

async function unlinkEffectFromTea(teaId, effectId) {
  await execute(
    `DELETE FROM to_tea_effects WHERE tea_id=:teaId AND effect_id=:effectId`,
    { teaId: Number(teaId), effectId: Number(effectId) }
  );
}

// ── Blend ─────────────────────────────────────────────────────────────────────

async function getBlend(teaIds) {
  const teas = await Promise.all(teaIds.map(getTeaWithEffects));
  const found = teas.filter(Boolean);

  const effectMap = new Map();
  for (const tea of found) {
    for (const e of tea.EFFECTS) {
      effectMap.set(e.ID, e);
    }
  }
  const effects = [...effectMap.values()];

  return { teas: found, effects };
}

// ── Images ────────────────────────────────────────────────────────────────────

async function getImagesForHerb(herbId) {
  return query(
    `SELECT i.id, i.image_name, i.image_ext
     FROM to_images i JOIN to_images_herb ih ON ih.image_id = i.id
     WHERE ih.herb_id = :herbId`,
    [herbId]
  );
}

async function getImagesForTea(teaId) {
  return query(
    `SELECT i.id, i.image_name, i.image_ext
     FROM to_images i JOIN to_images_tea it ON it.image_id = i.id
     WHERE it.tea_id = :teaId`,
    [teaId]
  );
}

async function getImageBlob(imageId) {
  const rows = await query(
    `SELECT id, image_blob, image_ext, image_name FROM to_images WHERE id = :id`,
    [imageId]
  );
  return rows[0] ?? null;
}

async function addImageToHerb(herbId, { buffer, imageExt, imageName }) {
  const result = await execute(
    `INSERT INTO to_images (image_blob, image_ext, image_name)
     VALUES (:blob, :ext, :name) RETURNING id INTO :outId`,
    { blob: { val: buffer, type: oracledb.BUFFER },
      ext: imageExt, name: imageName,
      outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
  );
  const imageId = result.outBinds.outId[0];
  await execute(
    `INSERT INTO to_images_herb (image_id, herb_id) VALUES (:imageId, :herbId)`,
    { imageId, herbId: Number(herbId) }
  );
  return imageId;
}

async function addImageToTea(teaId, { buffer, imageExt, imageName }) {
  const result = await execute(
    `INSERT INTO to_images (image_blob, image_ext, image_name)
     VALUES (:blob, :ext, :name) RETURNING id INTO :outId`,
    { blob: { val: buffer, type: oracledb.BUFFER },
      ext: imageExt, name: imageName,
      outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
  );
  const imageId = result.outBinds.outId[0];
  await execute(
    `INSERT INTO to_images_tea (image_id, tea_id) VALUES (:imageId, :teaId)`,
    { imageId, teaId: Number(teaId) }
  );
  return imageId;
}

async function deleteHerbImage(herbId, imageId) {
  await execute(
    `DELETE FROM to_images_herb WHERE herb_id=:herbId AND image_id=:imageId`,
    { herbId: Number(herbId), imageId: Number(imageId) }
  );
  await execute(`DELETE FROM to_images WHERE id=:id`, { id: Number(imageId) });
}

async function deleteTeaImage(teaId, imageId) {
  await execute(
    `DELETE FROM to_images_tea WHERE tea_id=:teaId AND image_id=:imageId`,
    { teaId: Number(teaId), imageId: Number(imageId) }
  );
  await execute(`DELETE FROM to_images WHERE id=:id`, { id: Number(imageId) });
}

module.exports = {
  // existing
  getHerbs, getHerbById, getTeas, getTeaById, getTeaWithEffects, getBlend,
  // new
  getEffects, getEffectById, addEffect, updateEffect, deleteEffect,
  addHerb, updateHerb, deleteHerb,
  addTea, updateTea, deleteTea,
  linkEffectToTea, unlinkEffectFromTea,
  getEffectsForTea,
  getImagesForHerb, getImagesForTea, getImageBlob,
  addImageToHerb, addImageToTea, deleteHerbImage, deleteTeaImage,
};
