/**
 * 잔량분배 게시판 — 복구 후 화면이 보여줄 값 read-only 재현
 * node scripts/probe-shilla-board-after-repair.mjs [year] [week]
 * 게시판 API 의 ORDER_SQL / SHIPMENT_SQL 과 같은 범위로 조회해 buildGroupRows 로 계산한다.
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildGroupRows, buildOverviewSections } from '../lib/shillaMiuBoard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const year = String(process.argv[2] || '2026');
const week = String(process.argv[3] || '33');

const pool = await sql.connect({
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
});

const ORDER_SQL = `SELECT LEFT(om.OrderWeek,2) week,om.OrderWeek orderWeek,p.ProdKey prodKey,p.CounName country,COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName,p.OutUnit unit,
  SUM(ISNULL(od.OutQuantity,CASE WHEN p.OutUnit IN (N'박스',N'BOX') THEN od.BoxQuantity WHEN p.OutUnit IN (N'단',N'BUNCH') THEN od.BunchQuantity WHEN p.OutUnit IN (N'송이',N'STEAM',N'STEM') THEN od.SteamQuantity ELSE od.BoxQuantity END)) qty
  FROM OrderMaster om
  JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
  JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
 WHERE om.OrderYear=@yr AND LEFT(om.OrderWeek,2)=@wk AND om.CustKey=@cust AND ISNULL(om.isDeleted,0)=0
 GROUP BY LEFT(om.OrderWeek,2),om.OrderWeek,p.ProdKey,p.CounName,p.DisplayName,p.ProdName,p.OutUnit`;

const SHIPMENT_SQL = `SELECT LEFT(sm.OrderWeek,2) week,sm.OrderWeek orderWeek,p.ProdKey prodKey,p.CounName country,COALESCE(NULLIF(p.DisplayName,N''),p.ProdName) prodName,p.OutUnit unit,SUM(ISNULL(sd.OutQuantity,0)) qty
  FROM ShipmentMaster sm
  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
 WHERE sm.OrderYear=@yr AND LEFT(sm.OrderWeek,2)=@wk AND sm.CustKey=@cust AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)>0
 GROUP BY LEFT(sm.OrderWeek,2),sm.OrderWeek,p.ProdKey,p.CounName,p.DisplayName,p.ProdName,p.OutUnit`;

const read = async (text, cust) => {
  const r = await pool
    .request()
    .input('yr', sql.NVarChar, year)
    .input('wk', sql.NVarChar, week)
    .input('cust', sql.Int, cust)
    .query(text);
  return r.recordset || [];
};

const groups = (
  await pool.request().query(
    `SELECT GroupKey groupKey,GroupName groupName,BaseCustKey baseCustKey,BaseCustName baseCustName,
            ReceiverCustKey receiverCustKey,ReceiverCustName receiverCustName
       FROM dbo.WebShillaMiuBoardGroup WHERE IsActive=1 ORDER BY DisplayOrder,GroupKey`,
  )
).recordset;

const boards = [];
for (const group of groups) {
  const [baseOrders, baseShipments, receiverOrders, receiverShipments] = await Promise.all([
    read(ORDER_SQL, group.baseCustKey),
    read(SHIPMENT_SQL, group.baseCustKey),
    read(ORDER_SQL, group.receiverCustKey),
    read(SHIPMENT_SQL, group.receiverCustKey),
  ]);
  boards.push({
    group,
    rows: buildGroupRows({
      weeks: [week],
      baseOrders,
      baseShipments,
      receiverOrders,
      receiverShipments,
      allocations: [],
    }),
  });
}

console.log(`\n########## ${year}년 ${week}차 잔량분배 게시판 (복구 후 · 읽기 전용 재현) ##########`);
for (const { group, rows } of boards) {
  console.log(`\n=== ${group.groupName} 탭 — ${group.baseCustName}(CustKey ${group.baseCustKey}) ===`);
  console.table(
    rows.map((r) => {
      const w = r.weeks[week];
      return {
        품목: r.prodName.slice(0, 42),
        단위: r.unit,
        예상물량: w.expectedQty,
        현재분배: w.currentQty,
        '업체최종분배(임시)': w.effectiveFinalQty,
        업체잔량: w.residualQty,
        미우이관: w.transferQty,
      };
    }),
  );
  const sum = (f) => rows.reduce((a, r) => a + (r.weeks[week]?.[f] || 0), 0);
  console.log(
    `합계 — 품목 ${rows.length} · 예상 ${sum('expectedQty')} · 현재분배 ${sum('currentQty')} · 미우이관 ${sum('transferQty')}`,
  );
}

const receiverSelfMap = new Map();
for (const receiverCustKey of [...new Set(groups.map((g) => g.receiverCustKey))]) {
  const [orders, shipments] = await Promise.all([
    read(ORDER_SQL, receiverCustKey),
    read(SHIPMENT_SQL, receiverCustKey),
  ]);
  for (const s of shipments) {
    const key = `${receiverCustKey}|${s.prodKey}|${s.unit || ''}`;
    const row = receiverSelfMap.get(key) || {
      receiverCustKey, prodKey: s.prodKey, prodName: s.prodName, unit: s.unit, country: s.country, qty: 0, expectedQty: 0,
    };
    row.qty += Number(s.qty || 0);
    receiverSelfMap.set(key, row);
  }
  for (const s of orders) {
    const key = `${receiverCustKey}|${s.prodKey}|${s.unit || ''}`;
    const row = receiverSelfMap.get(key) || {
      receiverCustKey, prodKey: s.prodKey, prodName: s.prodName, unit: s.unit, country: s.country, qty: 0, expectedQty: 0,
    };
    row.expectedQty += Number(s.qty || 0);
    receiverSelfMap.set(key, row);
  }
}

const overview = buildOverviewSections({
  week,
  boards,
  receiverSelf: [...receiverSelfMap.values()],
});
for (const section of overview) {
  console.log(`\n=== 전체 탭 — 수령 ${section.receiverCustName} ===`);
  const shown = section.rows.filter((r) => r.residualTotal || r.receiverSelfQty || r.receiverTotal);
  console.table(
    shown.map((r) => {
      const cell = {};
      for (const g of section.groups)
        cell[`${g.groupName}잔량`] = r.byGroup[g.groupKey] ? r.byGroup[g.groupKey].transferQty : '-';
      return { 품목: r.prodName.slice(0, 38), 단위: r.unit, ...cell, 잔량합계: r.residualTotal, 미우자체: r.receiverSelfQty, 미우총수량: r.receiverTotal };
    }),
  );
  console.log(`0 제외 표시 품목 ${shown.length} / 전체 ${section.rows.length}`);
}

await pool.close();
console.log('\n[done] read-only. 운영 원장 쓰기 0건.');
