const { db, admin } = require('./db');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, 'images');
const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif)$/i;

// ── Image index ───────────────────────────────────────────────────────────────
// One scan at startup replaces the per-row readdirSync that used to run inside
// normTea and normPlant: 2 x 63 = 126 synchronous filesystem calls per GET /api/teas,
// each blocking the event loop.
//
// slugify() is gone. It had two incompatible definitions -- dal.js stripped only the
// first apostrophe (takes a string, not a regex) while index.js
// stripped all of them -- so the writer and the reader could disagree about where a
// plant's images lived. The slug is now a STORED generated column, so there is one
// definition and the database enforces it.

const imageIndex = { teas: new Map(), plants: new Map() };

function scanImages() {
  for (const subdir of ['teas', 'plants']) {
    const m = new Map();
    let slugs = [];
    try {
      slugs = fs.readdirSync(path.join(IMAGES_DIR, subdir), { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);
    } catch { /* directory absent: leave the map empty */ }

    for (const slug of slugs) {
      try {
        const files = fs.readdirSync(path.join(IMAGES_DIR, subdir, slug))
                        .filter(f => IMAGE_RE.test(f))
                        .sort();
        if (files.length) m.set(slug, files.map(f => `${subdir}/${slug}/${f}`));
      } catch { /* unreadable: skip */ }
    }
    imageIndex[subdir] = m;
  }
}

scanImages();

// Call after anything writes into backend/images/: addHerb's mkdirSync below, and the
// GBIF download in index.js.
function refreshImages() { scanImages(); }

function firstImage(subdir, slug) {
  const f = imageIndex[subdir].get(slug);
  return f ? f[0] : null;
}

function allImages(subdir, slug) {
  return imageIndex[subdir].get(slug) || [];
}

// ── DTO ───────────────────────────────────────────────────────────────────────
// The Oracle column names, by hand, one last time. SCREAMING_SNAKE_CASE was an
// accident of the original OracleDB driver; Mongo inherited it as a normalisation
// layer; it is now a deliberate DTO over a schema that has no such column anywhere.
// The API and all three frontends never learn that the database changed.

function normTea(r) {
  return {
    ID:           r.id,
    NAME:         r.name,
    DESCRIPTION:  r.description,
    // 50 of 63 tea documents stored "" and stage_load.sql turned those into NULL --
    // correctly, because "" and "not recorded" are different facts. The database keeps
    // the honest NULL and the DTO restores the legacy wire format, in one place.
    OXIDATION:    r.oxidation ?? '',
    FERMENTATION: r.fermentation ?? '',
    GENUS:        r.genus,
    SPECIES:      r.species,
    FAMILY:       r.family,
    ALKALOIDS:    r.alkaloids,
    EFFECT_NAMES: r.effect_names,
    IMAGE_PATH:   firstImage('teas', r.image_slug),
    IMAGE_PATHS:  allImages('teas', r.image_slug)
  };
}

function normEffect(r) {
  return {
    ID:          r.id,
    NAME:        r.name,
    DESCRIPTION: r.description,
    // Deliberately undefined, not null. No effect document ever had a field,
    // so JSON.stringify dropped the key and the wire format has never carried it.
    // Selecting a NULL column here would emit "QUALITY": null -- a real diff. The key
    // is written out so the shape stays documented rather than silently absent.
    QUALITY:     undefined
  };
}

function normPlant(r) {
  return {
    ID:             r.id,
    NAME:           r.name,
    GENUS:          r.genus,
    SPECIES:        r.species,
    FAMILY:         r.family,
    // Same trap as OXIDATION on teas, caught by the golden diff rather than by reading:
    // Damask rose stored "" and stage_load.sql nullif'd it to NULL. Every plant document
    // carried a string, so the wire format has never had null here. One row, and only
    // the diff would ever have found it.
    DESCRIPTION:    r.description ?? '',
    NATIVE_RANGE:   r.native_range,
    OTHER_NAMES:    r.other_names,
    //  preserving the original quirk: a gbifUsageKey of 0 became
    // null. Keeping the bug is the point -- this is a compatibility layer.
    GBIF_USAGE_KEY: r.gbif_usage_key || null,
    // Rebuilt from the seven-rank taxon walk rather than stored. Two consequences, both
    // expected (study/golden/EXPECTED_DIFFS.md): Cinnamon gains a lineage it never had,
    // and Damiana / Black Elder stop contradicting their own FAMILY -- the Mongo
    // document carried the authored family and GBIF's disagreeing one in the same
    // object and exposed both.
    TAXONOMY:       r.kingdom ? {
      kingdom: r.kingdom,
      phylum:  r.phylum,
      class:   r.class_name,
      order:   r.order_name,
      family:  r.family,
      genus:   r.genus
    } : null,
    COMMON_NAMES:   r.common_names,
    CURRENT_RANGE:  r.current_range,
    IMAGE_PATH:     firstImage('plants', r.image_slug)
  };
}

// The API's four type labels are not the database's. compound_type holds 'other' and
// compound_type.label holds 'Other Compound'; the wire format has always said
// 'otherCompound'. Map explicitly -- selecting the label would break the frontend's
// compound grouping for 22 rows.
const TYPE_TO_API = { alkaloid: 'alkaloid', polyphenol: 'polyphenol', terpene: 'terpene', other: 'otherCompound' };
const TYPE_TO_DB  = { alkaloid: 'alkaloid', polyphenol: 'polyphenol', terpene: 'terpene', otherCompound: 'other' };

function normCompound(r) {
  return {
    ID:           r.id,
    TYPE:         TYPE_TO_API[r.compound_type] || r.compound_type,
    NAME:         r.name,
    EFFECTS:      r.effects,
    WIKILINK:     r.wikilink || null,
    PSYCHOACTIVE: r.psychoactivity || null
  };
}

// ── Teas ──────────────────────────────────────────────────────────────────────
// LEFT JOIN LATERAL is OUTER APPLY: a subquery in the FROM clause that can see the
// outer row. Two of them, so one row comes back per tea carrying both arrays. A single
// GROUP BY over both joins would multiply alkaloid rows by effect rows and silently
// inflate each -- the classic fan-out.
//
// Three self-joins up the adjacency list recover genus/species/family. In Mongo those
// were stored inline on the tea with no key, which is how Lemon Peel ended up recorded
// as bitter orange. Here there is no string to typo.

const TEA_SELECT = `
SELECT t.tea_id::text                        AS id,
       t.name,
       t.description,
       t.oxidation,
       t.fermentation,
       t.image_slug,
       sp.name                               AS species,
       g.name                                AS genus,
       f.name                                AS family,
       coalesce(alk.names, '{}')             AS alkaloids,
       coalesce(eff.names, '{}')             AS effect_names
FROM   tea   t
JOIN   plant p  ON p.plant_id = t.plant_id
JOIN   taxon sp ON sp.taxon_id = p.taxon_id
JOIN   taxon g  ON g.taxon_id  = sp.parent_id
JOIN   taxon f  ON f.taxon_id  = g.parent_id
LEFT   JOIN LATERAL (
    SELECT array_agg(c.name ORDER BY c.name) AS names
    FROM   tea_compound tc
    JOIN   compound c USING (compound_id)
    WHERE  tc.tea_id = t.tea_id
      AND  c.compound_type = 'alkaloid'
) alk ON true
LEFT   JOIN LATERAL (
    SELECT array_agg(e.name ORDER BY e.name) AS names
    FROM   effect_claim ec
    JOIN   effect e USING (effect_id)
    WHERE  ec.tea_id = t.tea_id
) eff ON true`;

async function getTeas() {
  const { rows } = await db().query(`${TEA_SELECT} ORDER BY t.name`);
  return rows.map(normTea);
}

async function getTeaById(id) {
  const { rows } = await db().query(`${TEA_SELECT} WHERE t.tea_id = $1`, [id]);
  return rows[0] ? normTea(rows[0]) : null;
}

// genus + species resolves to a plant through the taxon tree. This is the only place
// the old string match survives, and only because the manager's form still collects
// genus and species as free text rather than offering a plant to pick. Unlike Mongo it
// cannot half-succeed: no match means no plant_id, tea.plant_id is NOT NULL, and the
// insert is refused rather than producing an orphan.
async function resolvePlantId(genus, species) {
  const { rows } = await db().query(
    `SELECT p.plant_id
     FROM   plant p
     JOIN   taxon sp ON sp.taxon_id = p.taxon_id
     JOIN   taxon g  ON g.taxon_id  = sp.parent_id
     WHERE  g.name = $1 AND sp.name = $2`,
    [genus, species]
  );
  if (!rows[0]) throw new Error(`No plant matches genus "${genus}" species "${species}"`);
  return rows[0].plant_id;
}

async function addTea({ name, description, genus, species, family, oxidation, fermentation }) {
  void family;  // derived from the taxon tree now; the form still posts it
  const plantId = await resolvePlantId(genus, species);
  const { rows } = await admin().query(
    `INSERT INTO tea (name, plant_id, description, oxidation, fermentation)
     VALUES ($1, $2, $3, nullif($4, ''), nullif($5, ''))
     RETURNING tea_id::text AS id`,
    [name, plantId, description, oxidation ?? '', fermentation ?? '']
  );
  return rows[0].id;
}

// Builds the SET list from the keys actually supplied. This fixes the partial-PUT bug
// the Mongo version had: index.js passes all seven keys and $set wrote undefined over
// anything the caller omitted.
async function updateTea(id, fields) {
  const sets = [];
  const vals = [];
  const put = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

  if (fields.name         !== undefined) put('name', fields.name);
  if (fields.description  !== undefined) put('description', fields.description);
  if (fields.oxidation    !== undefined) put('oxidation', fields.oxidation || null);
  if (fields.fermentation !== undefined) put('fermentation', fields.fermentation || null);
  if (fields.genus !== undefined && fields.species !== undefined) {
    put('plant_id', await resolvePlantId(fields.genus, fields.species));
  }
  if (!sets.length) return;

  vals.push(id);
  await admin().query(`UPDATE tea SET ${sets.join(', ')} WHERE tea_id = $${vals.length}`, vals);
}

async function deleteTea(id) {
  // tea_compound and effect_claim are ON DELETE CASCADE, so the children go with it.
  await admin().query('DELETE FROM tea WHERE tea_id = $1', [id]);
}

// ── Effects on teas ───────────────────────────────────────────────────────────

async function getEffectsForTea(teaId) {
  const { rows } = await db().query(
    `SELECT e.effect_id::text AS id, e.name, e.description
     FROM   effect_claim ec
     JOIN   effect e USING (effect_id)
     WHERE  ec.tea_id = $1
     ORDER  BY e.name`,
    [teaId]
  );
  return rows.map(normEffect);
}

async function getTeaWithEffects(id) {
  const tea = await getTeaById(id);
  if (!tea) return null;
  tea.EFFECTS = await getEffectsForTea(id);
  return tea;
}

// Two queries for the whole blend rather than three per tea. The old version called
// getTeaWithEffects per id, which called getTeaById AND getEffectsForTea, and the latter
// re-fetched the tea document it had just been handed an id for: 9 round trips for a
// 3-tea blend, each one carrying a synchronous readdirSync in the response path.
async function getBlend(teaIds) {
  if (!teaIds.length) return { teas: [], effects: [] };

  const { rows } = await db().query(`${TEA_SELECT} WHERE t.tea_id = ANY($1::bigint[])`, [teaIds]);
  const byId = new Map(rows.map(r => [r.id, normTea(r)]));
  // Preserve the caller's order; the Mongo version mapped over teaIds and dropped misses.
  const teas = teaIds.map(id => byId.get(String(id))).filter(Boolean);
  for (const t of teas) t.EFFECTS = [];

  const { rows: eff } = await db().query(
    `SELECT ec.tea_id::text AS tea_id, e.effect_id::text AS id, e.name, e.description
     FROM   effect_claim ec
     JOIN   effect e USING (effect_id)
     WHERE  ec.tea_id = ANY($1::bigint[])
     ORDER  BY e.name`,
    [teaIds]
  );
  const effectMap = new Map();
  for (const r of eff) {
    const dto = normEffect(r);
    byId.get(r.tea_id)?.EFFECTS.push(dto);
    effectMap.set(dto.NAME, dto);   // dedupe by name, as before
  }
  return { teas, effects: [...effectMap.values()] };
}

// ON CONFLICT has to name the predicate as well as the columns, because the index it
// infers is partial. effect_claim_tea_unsourced_unique exists precisely because a plain
// UNIQUE constraint cannot constrain the NULL side -- and source_id is NULL here.
async function linkEffectToTea(teaId, effectName) {
  await admin().query(
    `INSERT INTO effect_claim (tea_id, effect_id, source_id, confidence)
     SELECT $1, e.effect_id, NULL, 'unrated' FROM effect e WHERE e.name = $2
     ON CONFLICT (tea_id, effect_id) WHERE source_id IS NULL DO NOTHING`,
    [teaId, effectName]
  );
}

async function unlinkEffectFromTea(teaId, effectName) {
  await admin().query(
    `DELETE FROM effect_claim ec
     USING  effect e
     WHERE  ec.effect_id = e.effect_id
       AND  ec.tea_id = $1 AND e.name = $2 AND ec.source_id IS NULL`,
    [teaId, effectName]
  );
}

// ── Plants (herbs) ────────────────────────────────────────────────────────────
// The upper four ranks are LEFT joined: they exist for every plant today, but a family
// added later may not have an order above it yet, and a plant should still be readable
// when its lineage is incomplete.

const PLANT_SELECT = `
SELECT p.plant_id::text AS id,
       p.name,
       p.description,
       p.other_names,
       p.native_range,
       p.common_names,
       p.current_range,
       p.image_slug,
       sp.gbif_usage_key,
       sp.name  AS species,
       g.name   AS genus,
       f.name   AS family,
       o.name   AS order_name,
       cl.name  AS class_name,
       ph.name  AS phylum,
       k.name   AS kingdom
FROM   plant p
JOIN   taxon sp ON sp.taxon_id = p.taxon_id
JOIN   taxon g  ON g.taxon_id  = sp.parent_id
JOIN   taxon f  ON f.taxon_id  = g.parent_id
LEFT   JOIN taxon o  ON o.taxon_id  = f.parent_id
LEFT   JOIN taxon cl ON cl.taxon_id = o.parent_id
LEFT   JOIN taxon ph ON ph.taxon_id = cl.parent_id
LEFT   JOIN taxon k  ON k.taxon_id  = ph.parent_id`;

async function getHerbs() {
  const { rows } = await db().query(`${PLANT_SELECT} ORDER BY p.name`);
  return rows.map(normPlant);
}

async function getHerbById(id) {
  const { rows } = await db().query(`${PLANT_SELECT} WHERE p.plant_id = $1`, [id]);
  return rows[0] ? normPlant(rows[0]) : null;
}

// Walks family -> genus -> species, creating what is missing. The family case is the
// awkward one: the form collects family but not order, so a genuinely new family has no
// parent to attach to. Rather than inserting a second root and quietly breaking the
// single-tree invariant, this refuses and says what to do. New families are rare and
// deliberate; silent tree corruption is what this migration exists to end.
async function ensureTaxon(family, genus, species) {
  const c = await admin().connect();
  try {
    await c.query('BEGIN');

    const { rows: fam } = await c.query(
      `SELECT taxon_id FROM taxon WHERE botanical_rank = 'family' AND name = $1`, [family]);
    if (!fam[0]) {
      throw new Error(
        `Family "${family}" is not in taxon. Add it under its order first ` +
        `(see study/004_session5.sql), then retry.`);
    }

    // DO UPDATE rather than DO NOTHING, because DO NOTHING returns no row and there
    // would be nothing to RETURNING. Setting name to itself is the idiomatic no-op.
    const { rows: gen } = await c.query(
      `INSERT INTO taxon (parent_id, botanical_rank, name) VALUES ($1, 'genus', $2)
       ON CONFLICT (parent_id, name) DO UPDATE SET name = excluded.name
       RETURNING taxon_id`, [fam[0].taxon_id, genus]);

    const { rows: sp } = await c.query(
      `INSERT INTO taxon (parent_id, botanical_rank, name) VALUES ($1, 'species', $2)
       ON CONFLICT (parent_id, name) DO UPDATE SET name = excluded.name
       RETURNING taxon_id`, [gen[0].taxon_id, species]);

    await c.query('COMMIT');
    return sp[0].taxon_id;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

async function addHerb({ name, genus, species, family, description, nativeRange, otherNames }) {
  const taxonId = await ensureTaxon(family, genus, species);
  const { rows } = await admin().query(
    `INSERT INTO plant (name, taxon_id, description, other_names, native_range)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING plant_id::text AS id, image_slug`,
    [name, taxonId, description, otherNames || [], nativeRange || []]
  );
  // image_slug comes back from the database rather than being recomputed here, so the
  // directory and the lookup key cannot disagree.
  fs.mkdirSync(path.join(IMAGES_DIR, 'plants', rows[0].image_slug), { recursive: true });
  refreshImages();
  return rows[0].id;
}

async function updateHerb(id, fields) {
  const sets = [];
  const vals = [];
  const put = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

  if (fields.name         !== undefined) put('name', fields.name);
  if (fields.description  !== undefined) put('description', fields.description);
  if (fields.otherNames   !== undefined) put('other_names', fields.otherNames || []);
  if (fields.nativeRange  !== undefined) put('native_range', fields.nativeRange || []);
  if (fields.commonNames  !== undefined) put('common_names', fields.commonNames || []);
  if (fields.currentRange !== undefined) put('current_range', fields.currentRange || []);
  if (fields.family !== undefined && fields.genus !== undefined && fields.species !== undefined) {
    put('taxon_id', await ensureTaxon(fields.family, fields.genus, fields.species));
  }
  if (!sets.length) return;

  vals.push(id);
  await admin().query(`UPDATE plant SET ${sets.join(', ')} WHERE plant_id = $${vals.length}`, vals);
  refreshImages();
}

async function deleteHerb(id) {
  // tea.plant_id is ON DELETE RESTRICT, so deleting a plant that still has teas is
  // refused by the database. The old version deleted it and orphaned them.
  await admin().query('DELETE FROM plant WHERE plant_id = $1', [id]);
}

async function getTeaPlant(teaId) {
  const { rows } = await db().query(
    `${PLANT_SELECT} WHERE p.plant_id = (SELECT plant_id FROM tea WHERE tea_id = $1)`,
    [teaId]
  );
  return rows[0] ? normPlant(rows[0]) : null;
}

async function getTeasByHerb(herbId) {
  const { rows } = await db().query(`${TEA_SELECT} WHERE t.plant_id = $1 ORDER BY t.name`, [herbId]);
  return rows.map(normTea);
}

// Kept rather than deleted, because manager/app.js:587 still calls the route -- but it
// is now one query that can only ever return zero rows, since tea.plant_id is NOT NULL
// and carries a foreign key. The old version loaded all 57 plants and all 63 teas and
// ran a nested filter/some in JavaScript, O(n*m), hunting for corruption the schema now
// makes unrepresentable. A foreign key does not only stop bad data; it deletes the code
// that looks for it.
const ORPHAN_TEA_SELECT = TEA_SELECT.replace('JOIN   plant p', 'LEFT   JOIN plant p');

async function getTeasWithoutHerb() {
  const { rows } = await db().query(`${ORPHAN_TEA_SELECT} WHERE p.plant_id IS NULL`);
  return rows.map(normTea);
}

// ── Effects (standalone CRUD) ─────────────────────────────────────────────────

const EFFECT_SELECT = 'SELECT effect_id::text AS id, name, description FROM effect';

async function getEffects() {
  // COLLATE "C" gives byte order, which is what Mongo's sort({name: 1}) did. The
  // database's default collation is locale-aware and would interleave case; byte order
  // puts every uppercase letter first. Matching the old order keeps the golden diff clean.
  const { rows } = await db().query(`${EFFECT_SELECT} ORDER BY name COLLATE "C"`);
  return rows.map(normEffect);
}

async function getEffectById(id) {
  const { rows } = await db().query(`${EFFECT_SELECT} WHERE effect_id = $1`, [id]);
  return rows[0] ? normEffect(rows[0]) : null;
}

async function addEffect({ name, description, quality }) {
  //  is accepted and discarded. No effect ever had one, nothing reads QUALITY,
  // and the column does not exist -- but the manager form still posts the field.
  void quality;
  const { rows } = await admin().query(
    `INSERT INTO effect (name, description) VALUES ($1, $2) RETURNING effect_id::text AS id`,
    [name, description]
  );
  return rows[0].id;
}

async function updateEffect(id, fields) {
  const sets = [];
  const vals = [];
  const put = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

  if (fields.name        !== undefined) put('name', fields.name);
  if (fields.description !== undefined) put('description', fields.description);
  if (!sets.length) return;

  vals.push(id);
  await admin().query(`UPDATE effect SET ${sets.join(', ')} WHERE effect_id = $${vals.length}`, vals);
}

async function deleteEffect(id) {
  // effect_claim.effect_id is ON DELETE RESTRICT: an effect still claimed by a tea or a
  // compound cannot be deleted. In Mongo this succeeded and left every referencing tea
  // pointing at a name that no longer existed -- the rename/delete hazard the old
  // name-matching design could not defend against.
  await admin().query('DELETE FROM effect WHERE effect_id = $1', [id]);
}

// ── Compounds ─────────────────────────────────────────────────────────────────
// Four collections became one table with a type dimension, so the loop-over-collections
// machinery is gone: no COMPOUND_COLLECTIONS, no reverse map, and no delete-and-reinsert
// when a compound changes type. That cross-table move existed only because the document
// model made the type part of the storage location.

const COMPOUND_SELECT = `
SELECT c.compound_id::text AS id,
       c.name,
       c.compound_type,
       c.psychoactivity,
       c.wikilink,
       coalesce(ef.names, '{}') AS effects
FROM   compound c
LEFT   JOIN LATERAL (
    SELECT array_agg(e.name ORDER BY e.name) AS names
    FROM   effect_claim ec
    JOIN   effect e USING (effect_id)
    WHERE  ec.compound_id = c.compound_id
) ef ON true`;

async function getCompounds() {
  const { rows } = await db().query(COMPOUND_SELECT);
  // Sorted in JS, not SQL, deliberately. The old order came from localeCompare on
  // (TYPE, NAME) after flattening four collections, and localeCompare handles case in a
  // way no SQL collation reproduces exactly. Keeping the JS sort keeps the contract.
  return rows.map(normCompound)
             .sort((a, b) => a.TYPE.localeCompare(b.TYPE) || a.NAME.localeCompare(b.NAME));
}

async function getCompoundById(id) {
  const { rows } = await db().query(`${COMPOUND_SELECT} WHERE c.compound_id = $1`, [id]);
  return rows[0] ? normCompound(rows[0]) : null;
}

// The compound's effects are rows in effect_claim now, not an array on a document, so
// "set the effects" is a delete-and-insert rather than an overwrite. Only unsourced
// claims are touched: a claim backed by a source is evidence, not an editable field.
async function setCompoundEffects(c, compoundId, names) {
  await c.query('DELETE FROM effect_claim WHERE compound_id = $1 AND source_id IS NULL', [compoundId]);
  if (!names.length) return;
  await c.query(
    `INSERT INTO effect_claim (compound_id, effect_id, source_id, confidence)
     SELECT $1, e.effect_id, NULL, 'unrated'
     FROM   effect e WHERE e.name = ANY($2::text[])
     ON CONFLICT (compound_id, effect_id) WHERE source_id IS NULL DO NOTHING`,
    [compoundId, names]
  );
}

async function addCompound({ type, name, wikilink, psychoactive, effects }) {
  const dbType = TYPE_TO_DB[type];
  if (!dbType) throw new Error(`Unknown compound type: ${type}`);

  const c = await admin().connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO compound (name, compound_type, psychoactivity, wikilink)
       VALUES ($1, $2, $3, $4) RETURNING compound_id::text AS id`,
      [name, dbType, psychoactive ?? null, wikilink || null]
    );
    await setCompoundEffects(c, rows[0].id, effects || []);
    await c.query('COMMIT');
    return rows[0].id;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

async function updateCompound(id, { type, name, wikilink, psychoactive, effects }) {
  const c = await admin().connect();
  try {
    await c.query('BEGIN');

    const sets = [];
    const vals = [];
    const put = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

    if (name !== undefined) put('name', name);
    if (type !== undefined) {
      const dbType = TYPE_TO_DB[type];
      if (!dbType) throw new Error(`Unknown compound type: ${type}`);
      // A type change is one UPDATE. In Mongo it was a delete from one collection and an
      // insert into another, preserving _id by hand, because the type WAS the location.
      put('compound_type', dbType);
    }
    if (wikilink     !== undefined) put('wikilink', wikilink || null);
    if (psychoactive !== undefined) put('psychoactivity', psychoactive ?? null);

    if (sets.length) {
      vals.push(id);
      await c.query(`UPDATE compound SET ${sets.join(', ')} WHERE compound_id = $${vals.length}`, vals);
    }
    if (effects !== undefined) await setCompoundEffects(c, id, effects || []);

    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

async function deleteCompound(id) {
  // effect_claim.compound_id is ON DELETE CASCADE so its claims go too; tea_compound is
  // ON DELETE RESTRICT, so a compound still present in a tea cannot be deleted.
  await admin().query('DELETE FROM compound WHERE compound_id = $1', [id]);
}

module.exports = {
  getTeas, getTeaById, addTea, updateTea, deleteTea,
  getEffectsForTea, getTeaWithEffects, getBlend,
  linkEffectToTea, unlinkEffectFromTea,
  getTeaPlant, getTeasByHerb, getTeasWithoutHerb,
  getHerbs, getHerbById, addHerb, updateHerb, deleteHerb,
  getEffects, getEffectById, addEffect, updateEffect, deleteEffect,
  getCompounds, getCompoundById, addCompound, updateCompound, deleteCompound,
  refreshImages,
};
