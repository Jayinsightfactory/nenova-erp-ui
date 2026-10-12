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
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 180000 },
  });
  const q = async (title, text) => {
    const r = await pool.request().query(text);
    console.log(`\n===== ${title} =====`);
    console.log(JSON.stringify(r.recordset, null, 2));
    return r.recordset;
  };

  await q('음수 live 품목의 주차별 isFix', `
    SELECT p.ProdKey, p.ProdName, p.CountryFlower, CAST(p.Stock AS decimal(18,2)) live,
           CAST(ISNULL(w3202.outQty,0) AS decimal(18,2)) o3202,
           ISNULL(w3202.fix, -1) f3202,
           CAST(ISNULL(w3301.outQty,0) AS decimal(18,2)) o3301,
           ISNULL(w3301.fix, -1) f3301,
           CAST(ISNULL(w3302.outQty,0) AS decimal(18,2)) o3302,
           ISNULL(w3302.fix, -1) f3302,
           CAST(ISNULL(w3401.outQty,0) AS decimal(18,2)) o3401,
           ISNULL(w3401.fix, -1) f3401
      FROM Product p
      OUTER APPLY (
        SELECT SUM(sd.OutQuantity) outQty, MIN(CAST(ISNULL(sd.isFix,0) AS int)) minFix,
               MAX(CAST(ISNULL(sd.isFix,0) AS int)) maxFix,
               CASE WHEN MIN(CAST(ISNULL(sd.isFix,0) AS int))=MAX(CAST(ISNULL(sd.isFix,0) AS int))
                    THEN MIN(CAST(ISNULL(sd.isFix,0) AS int)) ELSE 2 END fix
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='32-02' AND ISNULL(sd.OutQuantity,0)>0
      ) w3202
      OUTER APPLY (
        SELECT SUM(sd.OutQuantity) outQty,
               CASE WHEN MIN(CAST(ISNULL(sd.isFix,0) AS int))=MAX(CAST(ISNULL(sd.isFix,0) AS int))
                    THEN MIN(CAST(ISNULL(sd.isFix,0) AS int)) ELSE 2 END fix
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-01' AND ISNULL(sd.OutQuantity,0)>0
      ) w3301
      OUTER APPLY (
        SELECT SUM(sd.OutQuantity) outQty,
               CASE WHEN MIN(CAST(ISNULL(sd.isFix,0) AS int))=MAX(CAST(ISNULL(sd.isFix,0) AS int))
                    THEN MIN(CAST(ISNULL(sd.isFix,0) AS int)) ELSE 2 END fix
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='33-02' AND ISNULL(sd.OutQuantity,0)>0
      ) w3302
      OUTER APPLY (
        SELECT SUM(sd.OutQuantity) outQty,
               CASE WHEN MIN(CAST(ISNULL(sd.isFix,0) AS int))=MAX(CAST(ISNULL(sd.isFix,0) AS int))
                    THEN MIN(CAST(ISNULL(sd.isFix,0) AS int)) ELSE 2 END fix
          FROM ShipmentDetail sd
          JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
         WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear='2026' AND sm.OrderWeek='34-01' AND ISNULL(sd.OutQuantity,0)>0
      ) w3401
     WHERE ISNULL(p.isDeleted,0)=0 AND p.Stock < 0
     ORDER BY p.CountryFlower, p.Stock
  `);

  await q('다음차수 확정 + 이전차수 미확정 카테고리', `
    SELECT p.CountryFlower,
           SUM(CASE WHEN sm.OrderWeek='33-02' AND ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfix3302,
           SUM(CASE WHEN sm.OrderWeek='33-02' AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fix3302,
           SUM(CASE WHEN sm.OrderWeek='34-01' AND ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) unfix3401,
           SUM(CASE WHEN sm.OrderWeek='34-01' AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fix3401,
           SUM(CASE WHEN sm.OrderWeek='33-01' AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) fix3301
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-01','33-02','34-01')
       AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower
     HAVING SUM(CASE WHEN sm.OrderWeek='33-02' AND ISNULL(sd.isFix,0)=0 THEN 1 ELSE 0 END) > 0
        AND SUM(CASE WHEN sm.OrderWeek='34-01' AND ISNULL(sd.isFix,0)=1 THEN 1 ELSE 0 END) > 0
     ORDER BY p.CountryFlower
  `);

  await q('34-01 확정 품목군', `
    SELECT p.CountryFlower, COUNT(*) rows, COUNT(DISTINCT sd.ProdKey) skus,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='34-01'
       AND ISNULL(sd.isFix,0)=1 AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower
     ORDER BY outQty DESC
  `);

  await q('33-02 미확정 품목군', `
    SELECT p.CountryFlower, COUNT(*) rows, COUNT(DISTINCT sd.ProdKey) skus,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-02'
       AND ISNULL(sd.isFix,0)=0 AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY p.CountryFlower
     ORDER BY outQty DESC
  `);

  await q('16:42 33-02 취소 품목군', `
    SELECT p.CountryFlower, COUNT(*) cnt, CAST(SUM(sh.AfterValue-sh.BeforeValue) AS decimal(18,2)) delta
      FROM StockHistory sh JOIN Product p ON p.ProdKey=sh.ProdKey
     WHERE sh.ChangeDtm >= '2026-08-21 16:42' AND sh.ChangeDtm < '2026-08-21 16:43'
       AND sh.Descr=N'출고확정 취소' AND sh.OrderWeek='33-02'
     GROUP BY p.CountryFlower ORDER BY cnt DESC
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
