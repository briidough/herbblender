// Upserts backend/seed/plants.json into the plants collection, merged with the GBIF block
// produced by backend/seed/fetch_gbif.js.
//
//   node backend/seed/fetch_gbif.js          # refresh plants.gbif.json (optional, slow)
//   node backend/migrations/002_backfill_plants.js
//
// Idempotent: keyed on {genus, species}, and only fields whose value would actually change
// are written, so a second run reports zero modifications.
//
// Two rules exist to protect the string-matched joins, and both matter:
//
//   * `family` always comes from plants.json, never from GBIF. GBIF places Sambucus nigra in
//     Viburnaceae and Turnera diffusa in Turneraceae, but the teas collection says Adoxaceae
//     and Passifloraceae. getTeasWithoutHerb compares genus+family+species, so taking GBIF's
//     family here would orphan those teas. GBIF's view is still recorded under `taxonomy`.
//
//   * gbifUsageKey is only written for a species-level match. Cinnamomum cassia has no
//     species record in the GBIF backbone (it resolves to the accepted C. aromaticum), so the
//     match degrades to HIGHERRANK and returns the key for the *genus* Cinnamomum. Storing
//     that would be silently wrong.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { connect, db, close } = require('../db');

const SEED_DIR = path.join(__dirname, '../seed');

function loadGbif() {
  const file = path.join(SEED_DIR, 'plants.gbif.json');
  if (!fs.existsSync(file)) {
    console.warn('No plants.gbif.json found — importing hand-authored fields only.');
    return new Map();
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(rows.map(r => [`${r.genus} ${r.species}`, r]));
}

// Builds the $set for one plant. Keys absent here are left untouched in Mongo, which is what
// lets descriptions be filled in progressively without the importer clobbering them.
function fieldsFor(entry, gbif) {
  const set = {};

  for (const key of ['name', 'genus', 'species', 'family', 'otherNames', 'nativeRange']) {
    if (entry[key] !== undefined) set[key] = entry[key];
  }
  // An empty description means "not written yet", not "set this to empty".
  if (entry.description) set.description = entry.description;

  if (gbif && !gbif.error) {
    if (gbif.matchType === 'HIGHERRANK') {
      set.gbifUsageKey = null;
    } else {
      set.gbifUsageKey = gbif.gbifUsageKey;
      set.taxonomy = gbif.taxonomy;
      if (gbif.commonNames && gbif.commonNames.length) set.commonNames = gbif.commonNames;
      set.iucnRedListCategory = gbif.iucnRedListCategory ?? null;
    }
  }

  return set;
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function run() {
  const seed = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'plants.json'), 'utf8'));
  const gbif = loadGbif();
  const col = () => db().collection('plants');

  await connect();

  const entries = [...seed.plants, ...seed.existing];
  let inserted = 0, updated = 0, unchanged = 0;
  const notes = [];

  for (const entry of entries) {
    const key = `${entry.genus} ${entry.species}`;
    const g = gbif.get(key);
    const desired = fieldsFor(entry, g);

    const current = await col().findOne({ genus: entry.genus, species: entry.species });

    if (!current) {
      // A brand-new document needs the fields the schema expects but the seed does not
      // author, so every plant doc has the same shape.
      await col().insertOne({
        description: '', climateRegions: [], commonNames: [], currentRange: [],
        gbifUsageKey: null, iucnRedListCategory: null, nativeHabitat: null, taxonomy: null,
        otherNames: [], nativeRange: [],
        ...desired,
      });
      inserted++;
      console.log(`  + ${key}  (${desired.name})`);
      continue;
    }

    const changes = {};
    for (const [k, v] of Object.entries(desired)) {
      if (!sameValue(current[k], v)) changes[k] = v;
    }

    if (Object.keys(changes).length === 0) {
      unchanged++;
      continue;
    }

    await col().updateOne({ _id: current._id }, { $set: changes });
    updated++;
    console.log(`  ~ ${key}  ${Object.keys(changes).join(', ')}`);
  }

  for (const [key, g] of gbif) {
    if (g.error) notes.push(`${key}: ${g.error}`);
    else if (g.matchType === 'HIGHERRANK') notes.push(`${key}: no species-level GBIF record, usage key left null`);
    else if (g.taxonomicStatus && g.taxonomicStatus !== 'ACCEPTED') {
      notes.push(`${key}: GBIF marks this a ${g.taxonomicStatus} of ${g.gbifAcceptedName}`);
    }
  }

  const total = await col().countDocuments();
  console.log(`\ninserted ${inserted}, updated ${updated}, unchanged ${unchanged} — plants now ${total}`);
  if (notes.length) {
    console.log('\nNeeds a human look:');
    for (const n of notes) console.log(`  - ${n}`);
  }

  await close();
}

run().catch(async err => {
  console.error('Migration failed:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
