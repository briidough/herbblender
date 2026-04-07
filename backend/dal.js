const { getConnection } = require('./db');

async function query(sql, binds = []) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(sql, binds, { outFormat: require('oracledb').OUT_FORMAT_OBJECT });
    return result.rows;
  } finally {
    if (conn) await conn.close();
  }
}

// Herbs
async function getHerbs() {
  return query(`SELECT id, name, genus, species, description, other_names FROM herb`);
}

async function getHerbById(id) {
  const rows = await query(
    `SELECT id, name, genus, species, description, other_names FROM herb WHERE id = :id`,
    [id]
  );
  return rows[0] ?? null;
}

// Teas
async function getTeas() {
  return query(`SELECT id, name, description, herb_id, oxidation, effects FROM tea`);
}

async function getTeaById(id) {
  const rows = await query(
    `SELECT id, name, description, herb_id, oxidation, effects FROM tea WHERE id = :id`,
    [id]
  );
  return rows[0] ?? null;
}

async function getTeasByHerbId(herbId) {
  return query(
    `SELECT id, name, description, herb_id, oxidation, effects FROM tea WHERE herb_id = :herbId`,
    [herbId]
  );
}

// Blend — fetch up to 3 teas and aggregate their effects
async function getBlend(teaIds) {
  const teas = await Promise.all(teaIds.map(getTeaById));
  const found = teas.filter(Boolean);
  const effects = [...new Set(found.flatMap(t => (t.EFFECTS ? t.EFFECTS.split(',').map(e => e.trim()) : [])))];
  return { teas: found, effects };
}

module.exports = { getHerbs, getHerbById, getTeas, getTeaById, getTeasByHerbId, getBlend };
