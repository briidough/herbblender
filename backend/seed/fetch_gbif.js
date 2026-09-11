// Resolves every binomial in plants.json against the GBIF Backbone and writes
// plants.gbif.json — the machine-derived half of a plant document (usage key, accepted
// family, taxonomy, English vernacular names, IUCN category). Hand-authored fields stay in
// plants.json; the importer merges the two.
//
//   node backend/seed/fetch_gbif.js
//
// Re-runnable and side-effect free apart from the output file. Nothing here touches Mongo.

const fs = require('fs');
const path = require('path');
const https = require('https');
// Shared with the manager's /api/gbif/common-names endpoint so the names written here are
// exactly the names that endpoint would have offered.
const { englishVernaculars } = require('../vernaculars');

const SEED_DIR = __dirname;
const OUT = path.join(SEED_DIR, 'plants.gbif.json');

function gbifGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HerbBlender/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function resolve({ genus, species, family }) {
  const match = await gbifGet(
    'https://api.gbif.org/v1/species/match'
    + `?family=${encodeURIComponent(family || '')}`
    + `&genus=${encodeURIComponent(genus || '')}`
    + `&species=${encodeURIComponent(species || '')}`
  );

  if (!match.usageKey) {
    return { genus, species, error: `no GBIF match (${match.matchType || 'NONE'})` };
  }

  const [usage, vn] = await Promise.all([
    gbifGet(`https://api.gbif.org/v1/species/${match.usageKey}`),
    gbifGet(`https://api.gbif.org/v1/species/${match.usageKey}/vernacularNames?limit=100`),
  ]);

  return {
    genus,
    species,
    gbifUsageKey: match.usageKey,
    gbifScientificName: usage.scientificName || match.scientificName || null,
    gbifAcceptedName: usage.accepted || null,
    gbifFamily: match.family || usage.family || null,
    matchType: match.matchType,
    matchConfidence: match.confidence,
    taxonomicStatus: usage.taxonomicStatus || match.status || null,
    taxonomy: {
      kingdom: match.kingdom || null,
      phylum:  match.phylum  || null,
      class:   match.class   || null,
      order:   match.order   || null,
      family:  match.family  || null,
      genus:   match.genus   || null,
    },
    commonNames: englishVernaculars(vn.results),
    iucnRedListCategory: usage.iucnRedListCategory || null,
  };
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'plants.json'), 'utf8'));

  // Existing rows carry no family of their own — take it from the matching new-plant entry
  // if present, otherwise let GBIF infer from genus+species alone.
  const targets = [
    ...seed.plants.map(p => ({ genus: p.genus, species: p.species, family: p.family })),
    ...seed.existing.map(p => ({ genus: p.genus, species: p.species, family: p.family })),
  ];

  const results = [];
  for (const t of targets) {
    try {
      const r = await resolve(t);
      results.push(r);
      const label = `${t.genus} ${t.species}`.padEnd(34);
      if (r.error) {
        console.warn(`  !! ${label} ${r.error}`);
      } else {
        const flag = r.matchType !== 'EXACT' ? `  <-- ${r.matchType}` : '';
        const syn  = r.taxonomicStatus && r.taxonomicStatus !== 'ACCEPTED'
          ? `  <-- ${r.taxonomicStatus}` : '';
        console.log(`  ok ${label} key=${r.gbifUsageKey} family=${r.gbifFamily}${flag}${syn}`);
      }
    } catch (err) {
      console.warn(`  !! ${t.genus} ${t.species}: ${err.message}`);
      results.push({ genus: t.genus, species: t.species, error: err.message });
    }
    await new Promise(r => setTimeout(r, 120)); // be polite to the GBIF API
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');

  const failed = results.filter(r => r.error);
  const inexact = results.filter(r => !r.error && r.matchType !== 'EXACT');
  const synonym = results.filter(r => !r.error && r.taxonomicStatus && r.taxonomicStatus !== 'ACCEPTED');

  console.log(`\nWrote ${results.length} record(s) to ${path.relative(process.cwd(), OUT)}`);
  if (failed.length)  console.log(`  ${failed.length} unresolved: ${failed.map(r => r.genus + ' ' + r.species).join(', ')}`);
  if (inexact.length) console.log(`  ${inexact.length} non-exact match: ${inexact.map(r => r.genus + ' ' + r.species).join(', ')}`);
  if (synonym.length) console.log(`  ${synonym.length} not ACCEPTED: ${synonym.map(r => r.genus + ' ' + r.species).join(', ')}`);
}

main().catch(err => { console.error('fetch_gbif failed:', err.message); process.exit(1); });
