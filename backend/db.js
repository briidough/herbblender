require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');

const PGHOST = process.env.PGHOST || '192.168.1.227';
const PGPORT = Number(process.env.PGPORT || 40021);
const PGDATABASE = process.env.PGDATABASE || 'herbblender';

function makePool(user, password) {
  const pool = new Pool({
    host: PGHOST,
    port: PGPORT,
    database: PGDATABASE,
    user,
    password,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  });

  // pg emits 'error' on the Pool when a client that is sitting IDLE fails -- the server
  // restarts, the network drops, a timeout fires server-side. That is an EventEmitter
  // 'error' with no listener, which Node turns into an uncaught exception and kills the
  // process. The query paths have their own try/catch; this is only about the idle ones.
  // The pool evicts the dead client by itself, so logging is the whole job.
  pool.on('error', err => {
    console.error(`pg pool (${user}): idle client error -`, err.message);
  });

  return pool;
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
