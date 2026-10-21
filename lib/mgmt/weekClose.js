// 차수 마감 체크리스트(읽기: ERP 원장, 쓰기: web_mgmt.WeekCloseCheck 추가 전용).
// 쿼리 원천: UNQUOTED=Estimate(ShipmentKey), NEGATIVE_STOCK=pages/api/shipment/stock-status.js view=negativeStock 복제,
//  UNPAID=lib/mgmt/receivables.js, UNREMITTED=WarehouseMaster 농장 vs dbo.WebFarmRemit(pages/api/incoming-price/remit.js).
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../db.js';
import { mgmtQuery } from './safeQuery.js';
import { ensureMgmtSchema } from './schema.js';
import { getArBalances } from './receivables.js';
import { buildChecklist, latestChecks, weeksInclude } from './weekCloseCore.js';

// OrderWeek 조건: '42-1' → ('42-1','42-01'), '42' → LIKE '42-%'
const wk = (w) => (w.variants
  ? { sql: 'IN (@w1, @w2)', p: { w1: { type: sql.NVarChar, value: w.variants[0] }, w2: { type: sql.NVarChar, value: w.variants[1] } } }
  : { sql: 'LIKE @w1', p: { w1: { type: sql.NVarChar, value: `${w.major}-%` } } });

// 개별 항목 실패는 0 이 아니라 null(미연결)로 표기
async function safe(fn) { try { return await fn(); } catch { return null; } }

async function countUnquoted(year, w) {
  const k = wk(w);
  const r = await mgmtQuery(
    `SELECT COUNT(*) AS n FROM ShipmentMaster sm
      WHERE sm.isDeleted=0 AND sm.isFix=1 AND sm.OrderYear=@yr AND sm.OrderWeek ${k.sql}
        AND NOT EXISTS (SELECT 1 FROM Estimate e WHERE e.ShipmentKey=sm.ShipmentKey)`,
    { yr: { type: sql.NVarChar, value: year }, ...k.p });
  return Number(r.recordset[0].n) || 0;
}

async function countNegative(year, w) {
  const k = wk(w);
  const r = await mgmtQuery(
    `SELECT p.ProdKey,
        ISNULL((SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm2 ON ps.StockKey=sm2.StockKey
                 WHERE ps.ProdKey=p.ProdKey AND sm2.OrderYear=@yr AND sm2.OrderWeek < @wmin
                   AND (sm2.isFix IS NULL OR sm2.isFix=1) ORDER BY sm2.OrderWeek DESC),0) AS confirmedStock,
        ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
                 WHERE wd.ProdKey=p.ProdKey AND wm.OrderYear=@yr AND wm.OrderWeek ${k.sql} AND wm.isDeleted=0),0) AS inQty,
        ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
                 WHERE sd.ProdKey=p.ProdKey AND sm.OrderYear=@yr AND sm.OrderWeek ${k.sql} AND sm.isDeleted=0),0) AS outQty
       FROM Product p
      WHERE p.isDeleted=0 AND EXISTS (SELECT 1 FROM ShipmentDetail sd2 JOIN ShipmentMaster sm3 ON sd2.ShipmentKey=sm3.ShipmentKey
                 WHERE sd2.ProdKey=p.ProdKey AND sm3.OrderYear=@yr AND sm3.OrderWeek ${k.sql} AND sm3.isDeleted=0 AND sd2.OutQuantity>0)`,
    { yr: { type: sql.NVarChar, value: year }, wmin: { type: sql.NVarChar, value: `${w.major}-00` }, ...k.p });
  return r.recordset.filter((x) => (Number(x.confirmedStock) || 0) + (Number(x.inQty) || 0) - (Number(x.outQty) || 0) < 0).length;
}

async function countEmptySdetail(year, w) {
  const k = wk(w);
  const r = await mgmtQuery(
    `SELECT COUNT(*) AS n FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
      WHERE sm.isDeleted=0 AND sm.OrderYear=@yr AND sm.OrderWeek ${k.sql} AND ISNULL(sd.OutQuantity,0)=0`,
    { yr: { type: sql.NVarChar, value: year }, ...k.p });
  return Number(r.recordset[0].n) || 0;
}

async function countUnpaid(year, w) {
  const k = wk(w);
  const r = await mgmtQuery(
    `SELECT DISTINCT sm.CustKey FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sm.ShipmentKey=sd.ShipmentKey
      WHERE sm.isDeleted=0 AND ISNULL(sd.isFix,0)=1 AND sm.OrderYear=@yr AND sm.OrderWeek ${k.sql}`,
    { yr: { type: sql.NVarChar, value: year }, ...k.p });
  const keys = new Set(r.recordset.map((x) => x.CustKey));
  if (!keys.size) return 0;
  const bal = await getArBalances();
  return bal.filter((b) => keys.has(b.custKey) && b.balance > 0).length;
}

async function countUnremitted(year, w) {
  const k = wk(w);
  const farms = await mgmtQuery(
    `SELECT DISTINCT wm.FarmName FROM WarehouseMaster wm
      WHERE wm.isDeleted=0 AND wm.OrderYear=@yr AND wm.OrderWeek ${k.sql} AND ISNULL(wm.FarmName,N'')<>N''`,
    { yr: { type: sql.NVarChar, value: year }, ...k.p });
  const remit = await mgmtQuery(
    `IF OBJECT_ID(N'dbo.WebFarmRemit',N'U') IS NULL
       SELECT CAST(NULL AS NVARCHAR(120)) AS FarmName, CAST(NULL AS NVARCHAR(200)) AS Weeks WHERE 1=0
     ELSE
       SELECT FarmName, Weeks FROM WebFarmRemit WHERE ISNULL(isDeleted,0)=0 AND OrderYear=@yr AND ISNULL(Status,N'CONFIRMED')=N'CONFIRMED'`,
    { yr: { type: sql.NVarChar, value: year } });
  const done = new Set(remit.recordset.filter((x) => weeksInclude(x.Weeks, w)).map((x) => x.FarmName));
  return farms.recordset.filter((f) => !done.has(f.FarmName)).length;
}

// 실행하지 않고 호출 가능 여부만
export function verifyWeekAvailability() {
  const p = path.join(process.cwd(), 'scripts', 'verify-week.mjs');
  return { available: fs.existsSync(p), command: 'npm run verify:week -- <차수>', note: '화면에서 실행하지 않음. 터미널에서 실행 후 결과를 메모에 남기세요.' };
}

export async function getWeekCloseState(year, w) {
  await ensureMgmtSchema();
  const week = w.variants ? w.variants[0] : w.major;
  const [unq, neg, emp, unp, rem] = await Promise.all([
    safe(() => countUnquoted(year, w)), safe(() => countNegative(year, w)), safe(() => countEmptySdetail(year, w)),
    safe(() => countUnpaid(year, w)), safe(() => countUnremitted(year, w)),
  ]);
  const counts = { UNQUOTED: unq, NEGATIVE_STOCK: neg, EMPTY_SDETAIL: emp, UNPAID: unp, UNREMITTED: rem };
  const rows = await mgmtQuery(
    `SELECT CheckKey, ItemCode, Status, Note, CreatedAt FROM web_mgmt.WeekCloseCheck WHERE OrderYear=@yr AND OrderWeek=@wk`,
    { yr: { type: sql.NVarChar, value: year }, wk: { type: sql.NVarChar, value: week } });
  return { year, week, items: buildChecklist(counts, latestChecks(rows.recordset)), verifyWeek: verifyWeekAvailability() };
}

export async function appendWeekCheck({ year, week, itemCode, status, note, actorId }) {
  await ensureMgmtSchema();
  await mgmtQuery(
    `INSERT INTO web_mgmt.WeekCloseCheck (OrderYear, OrderWeek, ItemCode, Status, Note, CreatedBy) VALUES (@yr,@wk,@it,@st,@nt,@by)`,
    { yr: { type: sql.NVarChar, value: year }, wk: { type: sql.NVarChar, value: week }, it: { type: sql.NVarChar, value: itemCode },
      st: { type: sql.NVarChar, value: status }, nt: { type: sql.NVarChar, value: note }, by: { type: sql.NVarChar, value: actorId || '' } });
}
