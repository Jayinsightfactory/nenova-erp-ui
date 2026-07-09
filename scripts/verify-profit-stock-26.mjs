// 26차 기말재고(F) 신규 로직 검증 — 엑셀 "매출원가 양식.xlsx"(26차) 정답과 대조 (일회성, 읽기 전용)
// lib/profitReport.js 의 신규 SQL 표현식과 동일 기준: 매입수량=EstQuantity 우선, 재고수량=품목별 전표 박스당수량
import fs from 'fs';
import path from 'path';
for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const { default: sql } = await import('mssql');
const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
});
const CASE_CATEGORY = `
  CASE
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%수국%' THEN N'콜롬비아 수국'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%카네이션%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%장미%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%루스커스%' THEN N'콜롬비아 루스커스'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%알스트로%' THEN N'콜롬비아 알스트로'
    WHEN ISNULL(p.CounName,'') LIKE N'%네덜란드%' THEN N'네덜란드'
    WHEN ISNULL(p.CounName,'') LIKE N'%호주%' THEN N'호주'
    WHEN ISNULL(p.CounName,'') LIKE N'%태국%' THEN N'태국'
    WHEN ISNULL(p.CounName,'') LIKE N'%중국%' THEN N'중국'
    WHEN ISNULL(p.CounName,'') LIKE N'%에콰도르%' THEN N'에콰도르'
    WHEN ISNULL(p.CounName,'') LIKE N'%미국%' THEN N'미국'
    WHEN ISNULL(p.CounName,'') LIKE N'%이스라엘%' THEN N'이스라엘'
    WHEN ISNULL(p.CounName,'') LIKE N'%뉴질랜드%' THEN N'뉴질랜드'
    WHEN ISNULL(p.CounName,'') LIKE N'%일본%' THEN N'일본'
    WHEN ISNULL(p.CounName,'') LIKE N'%베트남%' THEN N'베트남'
    ELSE N'기타(미분류)'
  END`;
const WD_UNIT_QTY_EXPR = `
  CASE WHEN ISNULL(wd.EstQuantity,0) > 0 THEN wd.EstQuantity
       WHEN ISNULL(wd.BunchQuantity,0) > 0 THEN wd.BunchQuantity
       WHEN ISNULL(wd.SteamQuantity,0) > 0 THEN wd.SteamQuantity
       ELSE ISNULL(wd.BoxQuantity,0) END`;
const YR = '2026', MAJOR = '26';

const purch = await pool.request().query(`
  SELECT ${CASE_CATEGORY} AS Category, SUM(${WD_UNIT_QTY_EXPR}) AS q, SUM(ISNULL(wd.TPrice,0)) AS usd
    FROM WarehouseDetail wd
    JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
   WHERE wm.OrderWeek LIKE '${MAJOR}-%' AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = '${YR}'
   GROUP BY ${CASE_CATEGORY}`);

const wk = await pool.request().query(`
  SELECT TOP 1 OrderWeek FROM StockMaster WHERE OrderYear='${YR}' AND OrderWeek LIKE '${MAJOR}-%' ORDER BY OrderWeek DESC`);
const week = wk.recordset[0]?.OrderWeek;
const stock = await pool.request().query(`
  SELECT ${CASE_CATEGORY} AS Category,
         SUM(ISNULL(ps.Stock,0) * COALESCE(lc.UnitPerBox,
               CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box
                    WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box ELSE 1 END)) AS q,
         SUM(ISNULL(ps.Stock,0) * COALESCE(lc.UnitPerBox,
               CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box
                    WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box ELSE 1 END) * ISNULL(lc.UnitCost,0)) AS rc
    FROM ProductStock ps
    JOIN StockMaster smk ON ps.StockKey=smk.StockKey
    JOIN Product p ON ps.ProdKey=p.ProdKey
    OUTER APPLY (
      SELECT TOP 1
             wd.TPrice * 1.0 / NULLIF(${WD_UNIT_QTY_EXPR}, 0) AS UnitCost,
             (${WD_UNIT_QTY_EXPR}) * 1.0 / NULLIF(wd.BoxQuantity, 0) AS UnitPerBox
        FROM WarehouseDetail wd
        JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       WHERE wd.ProdKey = ps.ProdKey AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wd.TPrice,0) > 0
       ORDER BY wm.OrderYear DESC, wm.OrderWeek DESC, wd.WdetailKey DESC
    ) lc
   WHERE smk.OrderYear='${YR}' AND smk.OrderWeek='${week}' AND ISNULL(ps.Stock,0) > 0
   GROUP BY ${CASE_CATEGORY}`);

const purchBy = Object.fromEntries(purch.recordset.map(x => [x.Category, x]));
const stockBy = Object.fromEntries(stock.recordset.map(x => [x.Category, x]));

// 엑셀 26차 정답: D열 매입수량 / G(매입액원화)·H(그외통관비)·F(기말재고액) / 기말수량(재고잔량 시트)
const EXCEL = {
  '콜롬비아 수국':    { purchQty: 23090, endQty: 450, G: 44311596.978, H: 2318580,     F: 908773.47 },
  '콜롬비아 카네이션': { purchQty: 7485,  endQty: 120, G: 65440766.186, H: 2802770.907, F: 1094084.76 },
  '콜롬비아 장미':    { purchQty: 2336,  endQty: null, G: 21163312.295, H: 885183.591,  F: 377542.739 },
  '콜롬비아 알스트로': { purchQty: 3200,  endQty: null, G: null, H: null, F: null },
  '네덜란드':         { purchQty: 5585,  endQty: null, G: null, H: null, F: null },
  '중국':             { purchQty: 1155,  endQty: null, G: null, H: null, F: null },
  '에콰도르':         { purchQty: 1400,  endQty: null, G: null, H: null, F: null },
  '베트남':           { purchQty: 1600,  endQty: null, G: null, H: null, F: 3779004.64 },
  '태국':             { purchQty: 1950,  endQty: null, G: null, H: null, F: null },
  '콜롬비아 루스커스': { purchQty: 675,   endQty: null, G: null, H: null, F: null },
  '호주':             { purchQty: 0,     endQty: 224,  G: 0,    H: 0,    F: 2760184.608 },
};

console.log(`26차 기말 스냅샷: ${week}`);
console.log('카테고리 | 매입수량 DB vs 엑셀 | 기말수량 DB (엑셀) | F: 신규공식(DB수량+엑셀G·H) vs 엑셀F | 최근원가Σ(외화)');
for (const [cat, ex] of Object.entries(EXCEL)) {
  const p = purchBy[cat] || { q: 0 };
  const s = stockBy[cat] || { q: 0, rc: 0 };
  let fCalc = null;
  if (ex.G != null && Number(p.q) > 0) fCalc = (ex.G + (ex.H || 0)) / Number(p.q) * Number(s.q);
  console.log(
    `${cat} | ${Number(p.q)} vs ${ex.purchQty}` +
    ` | ${Math.round(Number(s.q))}${ex.endQty != null ? ` (엑셀 ${ex.endQty})` : ''}` +
    (fCalc != null ? ` | ${Math.round(fCalc).toLocaleString()} vs ${Math.round(ex.F || 0).toLocaleString()}` : ' | -') +
    ` | ${Math.round(Number(s.rc)).toLocaleString()}`
  );
}
await pool.close();
