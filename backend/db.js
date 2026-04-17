require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = `mongodb+srv://briidough_db_user:${process.env.DB_PASSWORD}@clusterherbs.q9vwrrs.mongodb.net/?appName=ClusterHerbs`;
const client = new MongoClient(uri);

async function connect() {
  await client.connect();
  console.log('Connected to MongoDB');
}

function db() {
  return client.db('tea_blender');
}

module.exports = { connect, db };
