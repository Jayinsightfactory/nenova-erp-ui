#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');
const pk = Number(process.argv[2] || 502);
const delta = Number(process.argv[3] || 1);

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const p = await pool.request().input('pk', sql.Int, pk)
    .query(`SELECT ISNULL(Stock,0) AS live FROM Product WHERE ProdKey=@pk`);
  const before = Number(p.recordset[0].live);
  const after = before + delta;
  await pool.request()
    .input('pk', sql.Int, pk)
    .input('before', sql.Float, before)
    .input('after', sql.Float, after)
    .query(`
      INSERT INTO StockHistory
        (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
         BeforeValue, AfterValue, Descr, ProdKey)
      VALUES (GETDATE(), N'2026', N'26-01', N'nenovaSS3', N'재고조정', N'재고수량',
         @before, @after, N'음수정리:remain보정', @pk);
      UPDATE Product SET Stock = @after WHERE ProdKey = @pk`);
  await pool.request()
    .input('pk', sql.Int, pk)
    .query(`DECLARE @r INT,@m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear=N'2026',@OrderWeek=N'26-01',@ProdKey=@pk,@iUserID=N'nenovaSS3',@oResult=@r OUTPUT,@oMessage=@m OUTPUT;`);
  console.log(`pk=${pk} ${before}→${after}`);
  await pool.close();
})().catch((e) => { console.error(e); process.exit(1); });
