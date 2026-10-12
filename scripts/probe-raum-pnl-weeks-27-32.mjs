#!/usr/bin/env node
import fs from 'fs';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 300000,
});

const saved = await pool.request().query(`
  SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.Title, m.QuoteDate, m.NenovaPct, m.UpdatedAt,
         COUNT(i.ItemKey) AS ItemCount,
         SUM(CASE WHEN i.CostPrice IS NULL THEN 1 ELSE 0 END) AS MissingCost,
         SUM(CASE WHEN i.ProdKey IS NULL THEN 1 ELSE 0 END) AS Unmatched
    FROM WebRaumPnl m
    LEFT JOIN WebRaumPnlItem i ON i.PnlKey=m.PnlKey
   WHERE m.isDeleted=0 AND m.OrderYear='2026' AND m.MajorWeek BETWEEN '27' AND '32'
   GROUP BY m.PnlKey, m.OrderYear, m.MajorWeek, m.Title, m.QuoteDate, m.NenovaPct, m.UpdatedAt
   ORDER BY m.MajorWeek`);
console.table(saved.recordset);

const counts = await pool.request().query(`
  SELECT COUNT(*) AS CostMappings FROM WebRaumCostPrice;
  SELECT COUNT(*) AS ItemMappings FROM WebRaumItemMap;`);
console.log(counts.recordsets.map(rows => rows[0]));
await pool.close();
