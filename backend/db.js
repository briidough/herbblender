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
