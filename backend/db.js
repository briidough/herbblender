require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');

const PGHOST = process.env.PGHOST || '192.168.1.227';
const PGPORT = Number(process.env.PGPORT || 40021);
const PGDATABASE = process.env.PGDATABASE || 'herbblender';

function makePool(user, password) {
  return new Pool({
    host: PGHOST,
    port: PGPORT,
    database: PGDATABASE,
    user,
    password,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  })
}

let readPool = null;
let writePool = null;

async function connect() {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD is not set - check backend/.env');
  }
  readPool = makePool('herbblender_app', process.env.DB_PASSWORD);


  const c = await readPool.connect();
  c.release();

  if (process.env.ADMIN_DB_PASSWORD) {
    writePool = makePool('herbblender_admin', process.env.ADMIN_DB_PASSWORD);
    const w = await writePool.connect();
    w.release();
    console.log('Connected to PostgreSQL (read + admin)');
  } else {
    console.log('Connected to PostgreSQL (read-only; ADMIN_DB_PASSWORD not set)');
  }
}

function db() {
  if (!readPool) throw new Error('connect() has not been called');
  return readPool;
}

function admin() {
  if (!writePool) { 
    throw new Error('This deployment is read-only (ADMIN_DB_PASSWORD not set)');
  }
  return writePool;
}

async function close(){
  await Promise.all([readPool?.end(), writePool?.end()].filter(Boolean));
}

module.exports = { connect, db, admin, close}


// MONGODB_URI wins when set, so a local mongod needs no source edit. Otherwise build the
// Atlas URI — the password is the only secret, and it is escaped because Atlas-generated
// passwords routinely contain characters that would otherwise terminate the URI early.
// function buildUri() {
//   if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
//   const password = process.env.DB_PASSWORD;
//   if (!password) {
//     throw new Error('DB_PASSWORD is not set (and no MONGODB_URI override) — check backend/.env');
//   }
//   return
// }

// const client = new MongoClient(buildUri(), {
//   serverApi: { version: '1' },
//   maxPoolSize: 10,
//   // The default is 30s. Atlas is reached over an SRV record, and this host's resolv.conf
//   // offers only an unroutable IPv6 nameserver, so a missing  pin in compose shows up
//   // as a DNS failure here. Failing in 5s makes that legible instead of looking like a hang.
//   serverSelectionTimeoutMS: 5000,
// });

// async function connect() {
//   await client.connect();
//   console.log('Connected to MongoDB');
// }

// function db() {
//   return client.db('tea_blender');
// }

// async function close() {
//   await client.close();
// }

// module.exports = { connect, db, close };
