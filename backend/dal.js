const { getConnection } = require('./db');
const oracledb = require('oracledb');

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

// Herbs
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

// Teas
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

// Blend — fetch up to 3 teas and aggregate their unique effects
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

module.exports = { getHerbs, getHerbById, getTeas, getTeaById, getTeaWithEffects, getBlend };
