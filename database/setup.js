'use strict';
// Creates the database, tables and sample data using the connection settings in .env
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const dbName = process.env.DB_NAME || 'DemoBankingDB';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  for (const file of ['schema.sql', 'seed.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/DemoBankingDB/g, dbName);
    await conn.query(sql);
    console.log(`Ran ${file}`);
  }
  await conn.end();
  console.log(`Database "${dbName}" is ready.`);
})().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
