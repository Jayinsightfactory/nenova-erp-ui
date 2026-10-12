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

function remainSql(week, cf) {
  return `
    DECLARE @OrderYear nvarchar(20) = N'2026';
    DECLARE @OrderWeek nvarchar(20) = N'${week}';
    DECLARE @CountryFlower nvarchar(100) = N'${cf}';
    DECLARE @OrderYearWeek nvarchar(20) = @OrderYear + REPLACE(@OrderWeek, '-', '');
    DECLARE @BeforeStockKey INT;
    SELECT TOP 1 @BeforeStockKey = StockKey FROM StockMaster
     WHERE OrderYearWeek < @OrderYearWeek ORDER BY OrderYearWeek DESC, OrderWeek DESC;
    SELECT vs.ProdKey, SUM(vs.OutQuantity) OutQuantity
    INTO #sl FROM ViewShipment vs
    WHERE vs.OrderYear=@OrderYear AND vs.OrderWeek=@OrderWeek
      AND vs.CountryFlower=@CountryFlower AND ISNULL(vs.DetailFix,0)=0
    GROUP BY vs.ProdKey;
    SELECT N'${week} ${cf}' AS scope, COUNT(*) shipped,
      SUM(CASE WHEN ROUND(ISNULL(ns.Stock,0)-ISNULL(s.OutQuantity,0),0)<0 THEN 1 ELSE 0 END) oldNeg,
      SUM(CASE WHEN ROUND(ISNULL(prev.Stock,0)+ISNULL(wr.qty,0)-ISNULL(cf.qty,0)+ISNULL(adj.qty,0)-ISNULL(s.OutQuantity,0),0)<0 THEN 1 ELSE 0 END) newNeg
    FROM #sl s
    LEFT JOIN (SELECT ps.ProdKey, ps.Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey WHERE sm.OrderYearWeek=@OrderYearWeek) ns ON ns.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ps.ProdKey, ISNULL(ps.Stock,0) Stock FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey WHERE sm.StockKey=@BeforeStockKey) prev ON prev.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewWarehouse WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek GROUP BY ProdKey) wr ON wr.ProdKey=s.ProdKey
    LEFT JOIN (SELECT ProdKey, ROUND(SUM(OutQuantity),2) qty FROM ViewShipment WHERE OrderYear=@OrderYear AND OrderWeek=@OrderWeek AND DetailFix=1 GROUP BY ProdKey) cf ON cf.ProdKey=s.ProdKey
    LEFT JOIN (SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) qty FROM StockHistory sh JOIN CodeInfo ci ON ci.Category=N'StockType' AND sh.ChangeType=ci.Descr WHERE sh.OrderYear=@OrderYear AND sh.OrderWeek=@OrderWeek GROUP BY sh.ProdKey) adj ON adj.ProdKey=s.ProdKey;
    DROP TABLE #sl;
  `;
}

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });
  const cfs = ['콜롬비아장미','콜롬비아수국','중국장미','중국기타','베트남호접난 Orchid','네덜란드'];
  for (const week of ['33-02','34-01']) {
    for (const cf of cfs) {
      const r = await pool.request().query(remainSql(week, cf));
      console.log(JSON.stringify(r.recordset[0]));
    }
  }
  const prev = await pool.request().query(`
    SELECT p.CountryFlower, ISNULL(sd.isFix,0) isFix, COUNT(*) rows
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-01'
       AND p.CountryFlower IN (N'콜롬비아장미',N'콜롬비아수국',N'중국장미',N'중국기타',N'베트남호접난 Orchid',N'네덜란드')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower, ISNULL(sd.isFix,0)
     ORDER BY p.CountryFlower, isFix
  `);
  console.log('33-01', JSON.stringify(prev.recordset, null, 2));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
