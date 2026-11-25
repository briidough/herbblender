// The 'Lemon Peel' tea was recorded as Citrus aurantium — that is Seville/bitter orange, the
// same binomial the 'Orange Peel' tea uses. Because Tea -> Plant is matched on genus+species
// with no foreign key, Lemon Peel silently resolved to the orange plant. Lemon is Citrus
// x limon; the matching plant is seeded by 002 as species 'limon' (bare epithet, since the
// join is raw string equality).
//
//   node backend/migrations/003_fix_lemon_peel.js
//
// Idempotent: matches only the incorrect value, so a second run modifies nothing.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connect, db, close } = require('../db');

async function run() {
  await connect();

  const result = await db().collection('teas').updateOne(
    { name: 'Lemon Peel', genus: 'Citrus', species: 'aurantium' },
    { $set: { species: 'limon' } }
  );

  if (result.matchedCount === 0) {
    console.log('Nothing to do — Lemon Peel is not set to Citrus aurantium.');
  } else {
    console.log(`Lemon Peel: species aurantium -> limon (${result.modifiedCount} modified).`);
  }

  await close();
}

run().catch(async err => {
  console.error('Migration failed:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
