/**
 * 잔량분배 게시판 — 후보 CustKey 생애 활동/별칭/33차 품목 read-only 진단 (2차)
 * node scripts/probe-shilla-board-scope2.mjs
 * SELECT 만 수행한다. 운영 원장 쓰기 없음.
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
});

const q = async (label, text) => {
  const r = await pool.request().query(text);
  console.log(`\n=== ${label} ===`);
  console.table(r.recordset);
  return r.recordset;
};

const KEYS = '444,445,446,456,457,652,680,683';

await q('후보 Customer 상세(별칭/비고 후보)', `
  SELECT CustKey, CustName, CustCode, Group1, CustArea, Manager, ProductType,
         SearchComment, UseType, TransType, BaseOutDay, OrderCode, ISNULL(isDeleted,0) isDeleted, Descr
    FROM Customer WHERE CustKey IN (${KEYS}) ORDER BY CustKey`);

await q('후보 CustKey 생애 주문 합계(연도별)', `
  SELECT om.CustKey, c.CustName, om.OrderYear,
         COUNT(DISTINCT LEFT(om.OrderWeek,2)) weeks,
         MAX(TRY_CONVERT(INT,LEFT(om.OrderWeek,2))) lastWeek,
         SUM(ISNULL(od.OutQuantity,0)) outQty
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
    JOIN Customer c ON c.CustKey=om.CustKey
   WHERE om.CustKey IN (${KEYS}) AND ISNULL(om.isDeleted,0)=0
   GROUP BY om.CustKey, c.CustName, om.OrderYear ORDER BY om.CustKey, om.OrderYear`);

await q('후보 CustKey 생애 분배 합계(연도별)', `
  SELECT sm.CustKey, c.CustName, sm.OrderYear,
         COUNT(DISTINCT LEFT(sm.OrderWeek,2)) weeks,
         MAX(TRY_CONVERT(INT,LEFT(sm.OrderWeek,2))) lastWeek,
         SUM(ISNULL(sd.OutQuantity,0)) outQty
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey
   WHERE sm.CustKey IN (${KEYS}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
   GROUP BY sm.CustKey, c.CustName, sm.OrderYear ORDER BY sm.CustKey, sm.OrderYear`);

await q('미우 후보(456/457) 2026 28~34차 주문·분배', `
  SELECT k.CustKey, c.CustName, w.wk, ISNULL(o.q,0) orderQty, ISNULL(s.q,0) shipQty
    FROM (VALUES (456),(457)) k(CustKey)
    JOIN Customer c ON c.CustKey=k.CustKey
   CROSS JOIN (VALUES (N'28'),(N'29'),(N'30'),(N'31'),(N'32'),(N'33'),(N'34')) w(wk)
   OUTER APPLY (SELECT SUM(ISNULL(od.OutQuantity,0)) q FROM OrderMaster om
                  JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
                 WHERE om.OrderYear=N'2026' AND ISNULL(om.isDeleted,0)=0 AND om.CustKey=k.CustKey AND LEFT(om.OrderWeek,2)=w.wk) o
   OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) q FROM ShipmentMaster sm
                  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
                 WHERE sm.OrderYear=N'2026' AND ISNULL(sm.isDeleted,0)=0 AND sm.CustKey=k.CustKey
                   AND ISNULL(sd.OutQuantity,0)>0 AND LEFT(sm.OrderWeek,2)=w.wk) s
   ORDER BY k.CustKey, w.wk`);

await q('신라호텔(446) 2026 33차 주문 품목', `
  SELECT om.OrderWeek, p.ProdKey, COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName, p.OutUnit unit,
         SUM(ISNULL(od.OutQuantity,0)) orderQty,
         SUM(ISNULL(od.BoxQuantity,0)) box, SUM(ISNULL(od.BunchQuantity,0)) bunch, SUM(ISNULL(od.SteamQuantity,0)) steam
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
    JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
   WHERE om.OrderYear=N'2026' AND ISNULL(om.isDeleted,0)=0 AND om.CustKey=446 AND LEFT(om.OrderWeek,2)=N'33'
   GROUP BY om.OrderWeek, p.ProdKey, p.DisplayName, p.ProdName, p.OutUnit
   ORDER BY om.OrderWeek, prodName`);

await q('신라호텔(446) 2026 32차 주문·분배 품목', `
  SELECT p.ProdKey, COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName, p.OutUnit unit,
         ISNULL(o.q,0) orderQty, ISNULL(s.q,0) shipQty
    FROM Product p
   OUTER APPLY (SELECT SUM(ISNULL(od.OutQuantity,0)) q FROM OrderMaster om
                  JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
                 WHERE om.OrderYear=N'2026' AND ISNULL(om.isDeleted,0)=0 AND om.CustKey=446
                   AND LEFT(om.OrderWeek,2)=N'32' AND od.ProdKey=p.ProdKey) o
   OUTER APPLY (SELECT SUM(ISNULL(sd.OutQuantity,0)) q FROM ShipmentMaster sm
                  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
                 WHERE sm.OrderYear=N'2026' AND ISNULL(sm.isDeleted,0)=0 AND sm.CustKey=446
                   AND ISNULL(sd.OutQuantity,0)>0 AND LEFT(sm.OrderWeek,2)=N'32' AND sd.ProdKey=p.ProdKey) s
   WHERE ISNULL(p.isDeleted,0)=0 AND (o.q IS NOT NULL OR s.q IS NOT NULL)
   ORDER BY prodName`);

await q('OrderDetail.OutQuantity NULL 비율(2026 30~34차)', `
  SELECT LEFT(om.OrderWeek,2) wk, COUNT(*) rows,
         SUM(CASE WHEN od.OutQuantity IS NULL THEN 1 ELSE 0 END) nullOutQty
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
   WHERE om.OrderYear=N'2026' AND ISNULL(om.isDeleted,0)=0
     AND TRY_CONVERT(INT,LEFT(om.OrderWeek,2)) BETWEEN 30 AND 34
   GROUP BY LEFT(om.OrderWeek,2) ORDER BY wk`);

await q('웹 저장값(WebShillaMiuBoardAllocation) 현황', `
  IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation',N'U') IS NULL SELECT N'없음' note;
  ELSE SELECT OrderYear, GroupKey, UseWeek, COUNT(*) rows,
              SUM(CASE WHEN FinalQty IS NULL THEN 0 ELSE 1 END) finalSet, SUM(Qty) legacyQty
         FROM dbo.WebShillaMiuBoardAllocation WHERE ISNULL(isDeleted,0)=0
        GROUP BY OrderYear, GroupKey, UseWeek ORDER BY OrderYear, GroupKey, UseWeek`);

await pool.close();
console.log('\n[done] read-only. 운영 원장 쓰기 0건.');
