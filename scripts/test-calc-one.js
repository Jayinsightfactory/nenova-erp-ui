#!/usr/bin/env node
/** 단일 품목 usp_StockCalculation 테스트 */
const fs = require('fs');
const path = require('path');
const pk = Number(process.argv[2] || 2179);
const wk = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a)) || '25-01';
const APPLY = process.argv.includes('--apply');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: 1433, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const yws = '2026' + wk.replace('-', '');
  const before = await pool.request().input('pk', sql.Int, pk).input('yws', sql.NVarChar, yws).query(`
    SELECT ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps FROM Product p
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) ps(Stock)
    WHERE p.ProdKey=@pk`);
  console.log(`before pk=${pk} wk=${wk}:`, before.recordset[0]);
  if (APPLY) {
    await pool.request().input('yr', sql.NVarChar, '2026').input('wk', sql.NVarChar, wk).input('pk', sql.Int, pk).input('uid', sql.NVarChar, 'nenovaSS3')
      .query(`DECLARE @r INT,@m NVARCHAR(200); EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT; SELECT @r r,@m m;`);
  }
  const after = await pool.request().input('pk', sql.Int, pk).input('yws', sql.NVarChar, yws).query(`
    SELECT ISNULL(p.Stock,0) live, ISNULL(ps.Stock,0) ps FROM Product p
    OUTER APPLY (SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek=@yws) ps(Stock)
    WHERE p.ProdKey=@pk`);
  console.log(`after:`, after.recordset[0]);
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
