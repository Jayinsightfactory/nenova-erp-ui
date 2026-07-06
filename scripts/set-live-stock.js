#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const pk = Number(process.argv[2] || 2997);
const stock = Number(process.argv[3] || 30);
(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  await pool.request().input('pk', sql.Int, pk).input('s', sql.Float, stock)
    .query('UPDATE Product SET Stock=@s WHERE ProdKey=@pk');
  await pool.request().input('pk', sql.Int, pk).query(`
    DECLARE @r INT, @m NVARCHAR(200);
    EXEC dbo.usp_StockCalculation
      @OrderYear=N'2026', @OrderWeek=N'26-01', @ProdKey=@pk,
      @iUserID=N'nenovaSS3', @oResult=@r OUTPUT, @oMessage=@m OUTPUT;`);
  console.log(`pk=${pk} live=${stock}`);
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
