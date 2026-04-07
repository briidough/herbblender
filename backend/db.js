require('dotenv').config();
const oracledb = require('oracledb');

oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_23_26' });

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectString: process.env.DB_CONNECT_STRING,
};

async function getConnection() {
  return await oracledb.getConnection(dbConfig);
}

module.exports = { getConnection };
