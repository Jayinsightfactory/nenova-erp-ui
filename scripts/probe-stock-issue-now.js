#!/usr/bin/env node
/** Read-only: current stock incident after 2026-08-20 SP patch. */
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
    try {
      const r = await pool.request().query(text);
      console.log(`\n===== ${title} =====`);
      console.log(JSON.stringify(r.recordset, null, 2));
      return r.recordset;
    } catch (e) {
      console.log(`\n===== ${title} ERROR =====\n${e.message}`);
      return [];
    }
  };

  await q('SP remain-check markers', `
    SELECT
      CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%leftover = 직전 StockMaster%' THEN 1 ELSE 0 END patched,
      CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_ShipmentFix')) LIKE N'%WITH stock%' THEN 1 ELSE 0 END oldCte
  `);

  await q('live Product.Stock 음수 TOP 30', `
    SELECT TOP 30 p.ProdKey, p.ProdName, p.CountryFlower,
           CAST(p.Stock AS decimal(18,4)) live
      FROM Product p
     WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0) < 0
     ORDER BY p.Stock, p.ProdName
  `);

  await q('live 음수 품목군 합계', `
    SELECT ISNULL(p.CountryFlower, N'(없음)') grp, COUNT(*) cnt,
           CAST(SUM(p.Stock) AS decimal(18,2)) liveSum
      FROM Product p
     WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0) < 0
     GROUP BY ISNULL(p.CountryFlower, N'(없음)')
     ORDER BY cnt DESC
  `);

  await q('최근 StockMaster 차수', `
    SELECT TOP 8 sm.StockKey, sm.OrderYear, sm.OrderWeek, sm.isFix, sm.ChangeDtm, sm.ChangeID
      FROM StockMaster sm
     ORDER BY sm.OrderYearWeek DESC
  `);

  await q('ProductStock 음수 스냅샷 차수별', `
    SELECT sm.OrderYear, sm.OrderWeek, COUNT(*) negRows,
           CAST(SUM(ps.Stock) AS decimal(18,2)) negSum
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
     WHERE ISNULL(ps.Stock,0) < 0
       AND sm.OrderYear='2026'
       AND sm.OrderWeek IN ('32-02','33-01','33-02','34-01','34-02')
     GROUP BY sm.OrderYear, sm.OrderWeek
     ORDER BY sm.OrderWeek
  `);

  await q('ProductStock 음수 품목군 33-01~34-02', `
    SELECT sm.OrderWeek, ISNULL(p.CountryFlower, N'(없음)') grp, COUNT(*) negRows,
           CAST(SUM(ps.Stock) AS decimal(18,2)) negSum
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      JOIN Product p ON p.ProdKey=ps.ProdKey
     WHERE ISNULL(ps.Stock,0) < -0.001
       AND sm.OrderYear='2026'
       AND sm.OrderWeek IN ('33-01','33-02','34-01','34-02')
     GROUP BY sm.OrderWeek, ISNULL(p.CountryFlower, N'(없음)')
     ORDER BY sm.OrderWeek, negRows DESC
  `);

  await q('StockHistory 2026-08-20 15:00 이후 유형', `
    SELECT CONVERT(varchar(16), ChangeDtm, 120) hhmm, ChangeID, ChangeType, Descr, OrderWeek, COUNT(*) cnt
      FROM StockHistory
     WHERE ChangeDtm >= '2026-08-20 15:00'
     GROUP BY CONVERT(varchar(16), ChangeDtm, 120), ChangeID, ChangeType, Descr, OrderWeek
     ORDER BY hhmm DESC
  `);

  await q('출고확정/취소 2026-08-20 17:00 이후', `
    SELECT CONVERT(varchar(16), ChangeDtm, 120) hhmm, ChangeID, Descr, OrderWeek, COUNT(*) cnt,
           CAST(SUM(AfterValue-BeforeValue) AS decimal(18,2)) delta
      FROM StockHistory
     WHERE ChangeDtm >= '2026-08-20 17:00'
       AND ChangeType=N'출고'
     GROUP BY CONVERT(varchar(16), ChangeDtm, 120), ChangeID, Descr, OrderWeek
     ORDER BY hhmm DESC
  `);

  await q('콜롬비아카네이션 33-01 확정상태', `
    SELECT ISNULL(sd.isFix,0) isFix, COUNT(*) rows,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek='33-01'
       AND p.CountryFlower=N'콜롬비아카네이션' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY ISNULL(sd.isFix,0)
  `);

  await q('콜롬비아카네이션 주차별 확정/미확정', `
    SELECT sm.OrderWeek, ISNULL(sd.isFix,0) isFix, COUNT(*) rows,
           CAST(SUM(sd.OutQuantity) AS decimal(18,2)) outQty
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=sd.ProdKey
     WHERE sm.OrderYear='2026' AND sm.OrderWeek IN ('33-01','33-02','34-01','34-02')
       AND p.CountryFlower=N'콜롬비아카네이션' AND ISNULL(sd.OutQuantity,0)>0
     GROUP BY sm.OrderWeek, ISNULL(sd.isFix,0)
     ORDER BY sm.OrderWeek, isFix
  `);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
