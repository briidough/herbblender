require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connect, db } = require('../db');

async function run() {
  await connect();
  const col = db().collection('plants');

  const result = await col.updateMany(
    {
      $or: [
        { gbifUsageKey: { $exists: false } },
        { taxonomy:     { $exists: false } },
        { commonNames:  { $exists: false } },
        { currentRange: { $exists: false } },
      ]
    },
    {
      $set: {
        gbifUsageKey: null,
        taxonomy:     null,
        commonNames:  [],
        currentRange: [],
      }
    }
  );

  console.log(`Migration complete. Modified ${result.modifiedCount} plant document(s).`);
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
