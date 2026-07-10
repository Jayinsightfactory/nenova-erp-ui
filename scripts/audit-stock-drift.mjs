// 카테고리별 ProductStock 스냅샷 드리프트 감사 (읽기전용).
// 매 차수 전환마다 DB스냅샷 증감 vs 입고+재고조정-출고 흐름을 비교해 불일치(drift)를 찾는다.
// 목적: 호주/베트남처럼 스냅샷이 오염된 카테고리가 또 있는지 26차 이전 확정 전에 전수 확인.
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
const sql = (await import('mssql')).default;

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 30000, requestTimeout: 60000 },
};

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

async function main() {
  const pool = await sql.connect(config);
  const orderYear = '2026';

  // 최근 10개 StockMaster 확정 주차 (스냅샷 시점) — 오름차순
  const weeksR = await pool.request()
    .input('yr', sql.NVarChar, orderYear)
    .query(`SELECT DISTINCT OrderWeek FROM StockMaster WHERE OrderYear=@yr AND OrderWeek LIKE '__-__' ORDER BY OrderWeek DESC`);
  const allWeeks = weeksR.recordset.map(r => r.OrderWeek).sort();
  const weeks = allWeeks.slice(-10); // 최근 10개 세부차수
  console.log('감사 대상 주차:', weeks.join(', '));

  // 카테고리별 주차별 DB 스냅샷 합계
  const stockR = await pool.request()
    .input('yr', sql.NVarChar, orderYear)
    .query(`
      SELECT ${CASE_CATEGORY} AS Category, smk.OrderWeek, SUM(ISNULL(ps.Stock,0)) AS q
        FROM ProductStock ps
        JOIN StockMaster smk ON ps.StockKey=smk.StockKey
        JOIN Product p ON ps.ProdKey=p.ProdKey
       WHERE smk.OrderYear=@yr AND smk.OrderWeek LIKE '__-__'
       GROUP BY ${CASE_CATEGORY}, smk.OrderWeek`);

  const stockMap = {}; // category -> week -> qty
  stockR.recordset.forEach(r => {
    stockMap[r.Category] = stockMap[r.Category] || {};
    stockMap[r.Category][r.OrderWeek] = Number(r.q);
  });

  const categories = Object.keys(stockMap).sort();
  const results = [];

  for (const cat of categories) {
    for (let i = 1; i < weeks.length; i++) {
      const prevWk = weeks[i - 1];
      const wk = weeks[i];
      const dbPrev = stockMap[cat]?.[prevWk];
      const dbThis = stockMap[cat]?.[wk];
      if (dbPrev == null || dbThis == null) continue; // 해당 주차 스냅샷 자체가 없으면 스킵

      const flowR = await pool.request()
        .input('prevWk', sql.NVarChar, prevWk)
        .input('wk', sql.NVarChar, wk)
        .query(`
          SELECT
            ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
                      JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
                      JOIN Product p ON wd.ProdKey=p.ProdKey
                     WHERE wm.OrderWeek > @prevWk AND wm.OrderWeek <= @wk AND wm.isDeleted=0
                       AND (${CASE_CATEGORY}) = N'${cat.replace(/'/g, "''")}'), 0) AS inQty,
            ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
                      JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
                      JOIN Product p ON sd.ProdKey=p.ProdKey
                     WHERE sm.OrderWeek > @prevWk AND sm.OrderWeek <= @wk AND sm.isDeleted=0
                       AND (${CASE_CATEGORY}) = N'${cat.replace(/'/g, "''")}'), 0) AS outQty,
            ISNULL((SELECT SUM(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) FROM StockHistory sh
                      JOIN Product p ON sh.ProdKey=p.ProdKey
                     WHERE sh.OrderWeek > @prevWk AND sh.OrderWeek <= @wk
                       AND (sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))
                       AND (${CASE_CATEGORY}) = N'${cat.replace(/'/g, "''")}'), 0) AS adjQty
        `);
      const { inQty, outQty, adjQty } = flowR.recordset[0];
      const dbDelta = dbThis - dbPrev;
      const flowDelta = inQty + adjQty - outQty;
      const drift = dbDelta - flowDelta;
      results.push({ cat, prevWk, wk, dbPrev, dbThis, inQty, outQty, adjQty, dbDelta, flowDelta, drift });
    }
  }

  // 카테고리별 누적 |drift| 집계
  const byCat = {};
  results.forEach(r => {
    byCat[r.cat] = byCat[r.cat] || { sumAbsDrift: 0, maxAbsDrift: 0, weeks: [] };
    byCat[r.cat].sumAbsDrift += Math.abs(r.drift);
    byCat[r.cat].maxAbsDrift = Math.max(byCat[r.cat].maxAbsDrift, Math.abs(r.drift));
    byCat[r.cat].weeks.push(r);
  });

  console.log('\n=== 카테고리별 누적 드리프트 (최근 %d개 주차 전환) ===', weeks.length - 1);
  const ranked = Object.entries(byCat).sort((a, b) => b[1].sumAbsDrift - a[1].sumAbsDrift);
  for (const [cat, info] of ranked) {
    console.log(`${cat.padEnd(14)} 누적|drift|=${info.sumAbsDrift.toFixed(1).padStart(10)}  최대|drift|=${info.maxAbsDrift.toFixed(1).padStart(10)}`);
  }

  console.log('\n=== 상세 (|drift| > 50 인 주차 전환만) ===');
  ranked.forEach(([cat, info]) => {
    info.weeks.filter(w => Math.abs(w.drift) > 50).forEach(w => {
      console.log(`[${cat}] ${w.prevWk}→${w.wk}  DB:${w.dbPrev}→${w.dbThis}(Δ${w.dbDelta})  입고${w.inQty}+조정${w.adjQty}-출고${w.outQty}=${w.flowDelta}  drift=${w.drift.toFixed(1)}`);
    });
  });

  await pool.close();
}

main().catch(e => { console.error(e); process.exit(1); });
