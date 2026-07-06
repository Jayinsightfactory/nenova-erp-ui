#!/usr/bin/env node
/** FormOrderAdd — Country/Flower/Product 3-grid SQL probe */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { fileURLToPath } from 'url';
import {
  sqlOrderAddGetDataCountry,
  sqlOrderAddGetDataFlower,
  sqlOrderAddGetDataProduct,
} from '../lib/exeOrderAddSql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mk = parseInt(process.argv[2] || '0', 10);

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});

console.log(`=== FormOrderAdd 3-grid probe — orderMasterKey=${mk} ===\n`);

const [countries, flowers, products] = await Promise.all([
  pool.request().input('orderMasterKey', sql.Int, mk).query(sqlOrderAddGetDataCountry()),
  pool.request().input('orderMasterKey', sql.Int, mk).query(sqlOrderAddGetDataFlower()),
  pool.request().input('orderMasterKey', sql.Int, mk).query(sqlOrderAddGetDataProduct()),
]);

console.log(`countries: ${countries.recordset.length}`);
console.log(`flowers:   ${flowers.recordset.length}`);
console.log(`products:  ${products.recordset.length}`);
console.log('\nTop countries by OrderCnt:');
countries.recordset.slice(0, 5).forEach((r) => {
  console.log(`  ${r.CountryFlower} | ${r.FlowerName || '-'} | cnt=${r.OrderCnt}`);
});
await pool.close();
process.exit(0);
