require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { MongoClient } = require('mongodb');

// MONGODB_URI wins when set, so a local mongod needs no source edit. Otherwise build the
// Atlas URI — the password is the only secret, and it is escaped because Atlas-generated
// passwords routinely contain characters that would otherwise terminate the URI early.
function buildUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const password = process.env.DB_PASSWORD;
  if (!password) {
    throw new Error('DB_PASSWORD is not set (and no MONGODB_URI override) — check backend/.env');
  }
  return `mongodb+srv://briidough_db_user:${encodeURIComponent(password)}`
       + `@clusterherbs.q9vwrrs.mongodb.net/?appName=ClusterHerbs`;
}

const client = new MongoClient(buildUri(), {
  serverApi: { version: '1' },
  maxPoolSize: 10,
  // The default is 30s. Atlas is reached over an SRV record, and this host's resolv.conf
  // offers only an unroutable IPv6 nameserver, so a missing `dns:` pin in compose shows up
  // as a DNS failure here. Failing in 5s makes that legible instead of looking like a hang.
  serverSelectionTimeoutMS: 5000,
});

async function connect() {
  await client.connect();
  console.log('Connected to MongoDB');
}

function db() {
  return client.db('tea_blender');
}

async function close() {
  await client.close();
}

module.exports = { connect, db, close };
