#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require('mssql');

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });
  const oldNew = await pool.request().query(`
    DECLARE @OrderYear nvarchar(20) = N'2026';
    DECLARE @OrderWeek nvarchar(20) = N'33-01';
    DECLARE @CountryFlower nvarchar(100) = N'콜롬비아카네이션';
    DECLARE @OrderYearWeek nvarchar(20) = @OrderYear + REPLACE(@OrderWeek, '-', '');
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey
      FROM StockMaster WHERE OrderYearWeek < @OrderYearWeek
     ORDER BY OrderYearWeek DESC, OrderWeek DESC;

    SELECT vs.ProdKey, SUM(vs.OutQuantity) OutQuantity
    INTO #sl FROM ViewShipment vs
    WHERE vs.OrderYear=@OrderYear AND vs.OrderWeek=@OrderWeek
      AND vs.CountryFlower=@CountryFlower AND ISNULL(vs.DetailFix,0)=0
    GROUP BY vs.ProdKey;

    SELECT
      SUM(CASE WHEN ROUND(ISNULL(ns.Stock,0)-ISNULL(s.OutQuantity,0),0)<0 THEN 1 ELSE 0 END) oldNeg,
      SUM(CASE WHEN ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(cf.qty,0)+ISNULL(adj.qty,0)-ISNULL(s.OutQuantity,0),0)<0 THEN 1 ELSE 0 END) newNeg,
      COUNT(*) shipped
    FROM #sl s
    LEFT JOIN (SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey WHERE sm.OrderYearWeek=@OrderYearWeek) ns ON ns.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ps.ProdKey, ISNULL(ps.Stock,0) Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey WHERE sm.StockKey=@BeforeStockKey) prev ON prev.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek GROUP BY ProdKey) wr ON wr.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewShipment WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek AND DetailFix=1 GROUP BY ProdKey) cf ON cf.ProdKey=s.ProdKey
    LEFT JOIN (SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty FROM StockHistory sh JOIN CodeInfo ci ON ci.Category=N'StockType' AND sh.ChangeType=ci.Descr WHERE sh.OrderYear=@OrderYear AND sh.OrderWeek=@OrderWeek GROUP BY sh.ProdKey) adj ON adj.ProdKey=s.ProdKey;

    DROP TABLE #sl;
  `);
  console.log(JSON.stringify(oldNew.recordset, null, 2));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
