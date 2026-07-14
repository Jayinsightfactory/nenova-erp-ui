#!/usr/bin/env node
/**
 * 2026-07-14 음수재고 정리 (사장님 승인: 1,2번)
 *   Part1. Product.Stock 음수 41건 → 최신 ProductStock 스냅샷으로 동기화
 *          (STOCK_INTEGRITY_DESIGN §3.2: live만 틀림·ps 맞음 → StockHistory 기록 없음, live=ps UPDATE)
 *   Part2. 26차 음수 스냅샷 정리 — 순델타0 페어 (+X at 음수차수 / −X at 다음차수)
 *          → 해당 차수 스냅샷만 0으로, 이후 차수·현재고 불변. Descr='수동보정:차수잔량', ChangeID=nenovaSS3
 *
 * Usage: node scripts/fix-negative-stock-20260714.mjs          (dry-run)
 *        node scripts/fix-negative-stock-20260714.mjs --apply
 */
import fs from 'fs';
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = (await import('mssql')).default;
const APPLY = process.argv.includes('--apply');
const UID = 'nenovaSS3';

const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});
const run = async (q, params = {}) => {
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) req.input(k, v.type, v.value);
  return (await req.query(q)).recordset;
};

const NEXT_WEEK = { '26-01': '26-02', '26-02': '27-01' };
const fmt = n => Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});

console.log(`\n===== ${APPLY ? '⚠️ APPLY 모드' : 'DRY-RUN (DB 변경 없음)'} =====\n`);

// ── Part 2 대상: 26-01/26-02 음수 스냅샷 중 그 주 출고가 있는 품목 (승인된 6건 기준)
const targets = await run(`
  SELECT sm.OrderWeek, ps.ProdKey, p.ProdName, p.CounName, ps.Stock AS snap
    FROM ProductStock ps
    JOIN StockMaster sm ON sm.StockKey = ps.StockKey
    JOIN Product p ON p.ProdKey = ps.ProdKey
   WHERE sm.OrderWeek IN ('26-01','26-02')
     AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026'
     AND ps.Stock < -0.01
     AND EXISTS (SELECT 1 FROM ShipmentDetail sd JOIN ShipmentMaster sm2 ON sm2.ShipmentKey=sd.ShipmentKey
                  WHERE sd.ProdKey=ps.ProdKey AND sm2.OrderWeek=sm.OrderWeek AND sm2.isDeleted=0
                    AND ISNULL(sd.OutQuantity,0) > 0)
   ORDER BY sm.OrderWeek, ps.Stock ASC`);
console.log(`Part2 대상 (26차 음수 스냅샷·그 주 출고 있음): ${targets.length}건`);
targets.forEach(t => console.log(`  [${t.OrderWeek}] ${t.CounName}/${t.ProdName}: 스냅샷 ${t.snap}`));

// ── 사전 정합성 검사: 대상 품목의 26-01~28-02 체인이 flow-math와 일치하는지
//    (일치해야 재계산 cascade가 이후 차수를 안 바꿈)
const prodKeys = [...new Set(targets.map(t => t.ProdKey))];
const chainCheck = {};
for (const pk of prodKeys) {
  const chain = await run(`
    SELECT sm.OrderWeek, sm.OrderYearWeek, ps.Stock AS snap,
      ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey
        WHERE wd.ProdKey=${pk} AND wm.OrderWeek=sm.OrderWeek AND wm.isDeleted=0),0) AS inQty,
      ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd JOIN ShipmentMaster sm2 ON sm2.ShipmentKey=sd.ShipmentKey
        WHERE sd.ProdKey=${pk} AND sm2.OrderWeek=sm.OrderWeek AND sm2.isDeleted=0 AND ISNULL(sd.isFix,0)=1),0) AS outFixed,
      ISNULL((SELECT SUM(sh.AfterValue-sh.BeforeValue) FROM StockHistory sh
        WHERE sh.ProdKey=${pk} AND sh.OrderWeek=sm.OrderWeek
          AND sh.ChangeType IN (SELECT Descr FROM CodeInfo WHERE Category='StockType')),0) AS adjQty
    FROM StockMaster sm
    LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=${pk}
    WHERE sm.OrderWeek IN ('25-02','26-01','26-02','27-01','27-02','28-01','28-02')
      AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026'
    ORDER BY sm.OrderYearWeek`);
  let ok = true;
  for (let i = 1; i < chain.length; i++) {
    const expected = Number(chain[i-1].snap||0) + Number(chain[i].inQty) - Number(chain[i].outFixed) + Number(chain[i].adjQty);
    if (Math.abs(expected - Number(chain[i].snap||0)) > 0.02) {
      ok = false;
      console.log(`  ⚠ ProdKey=${pk} ${chain[i].OrderWeek}: 체인 불일치 (기대 ${fmt(expected)} vs 스냅샷 ${fmt(chain[i].snap)}) — 이 품목 스킵`);
    }
  }
  chainCheck[pk] = ok;
}
const safeTargets = targets.filter(t => chainCheck[t.ProdKey]);
console.log(`체인 정합 통과: ${safeTargets.length}/${targets.length}건`);

// ── 기준선 저장 (27차~28차 스냅샷 + 라이브 — 적용 후 불변 검증용)
const baseline = {};
for (const pk of prodKeys) {
  baseline[pk] = await run(`
    SELECT sm.OrderWeek, ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
     WHERE ps.ProdKey=${pk} AND sm.OrderWeek IN ('27-01','27-02','28-01','28-02')
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026'`);
}

// ── Part2 실행: 순델타0 페어 + cascade 재계산
console.log('\n── Part2: 순델타0 페어 (26차 스냅샷만 0으로, 이후 차수 불변) ──');
for (const t of safeTargets) {
  const X = Math.round(Math.abs(Number(t.snap)) * 100) / 100;
  const nextWk = NEXT_WEEK[t.OrderWeek];
  console.log(`  ${t.CounName}/${t.ProdName}: [${t.OrderWeek}] +${X} / [${nextWk}] -${X}`);
  if (!APPLY) continue;
  await run(`
    INSERT INTO StockHistory (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ProdKey)
    VALUES (GETDATE(), '2026', @wk, @uid, N'재고조정', N'재고수량', 0, @x, N'수동보정:차수잔량 음수이월정리(순델타0 +)', @pk),
           (GETDATE(), '2026', @nwk, @uid, N'재고조정', N'재고수량', @x, 0, N'수동보정:차수잔량 음수이월정리(순델타0 -)', @pk)`,
    { wk: { type: sql.NVarChar, value: t.OrderWeek }, nwk: { type: sql.NVarChar, value: nextWk },
      uid: { type: sql.NVarChar, value: UID }, x: { type: sql.Float, value: X },
      pk: { type: sql.Int, value: t.ProdKey } });
}
if (APPLY) {
  // 품목별 최소 차수부터 cascade 재계산
  const earliest = {};
  safeTargets.forEach(t => { if (!earliest[t.ProdKey] || t.OrderWeek < earliest[t.ProdKey]) earliest[t.ProdKey] = t.OrderWeek; });
  for (const [pk, wk] of Object.entries(earliest)) {
    const r = await run(`
      DECLARE @r INT, @m NVARCHAR(200);
      EXEC dbo.usp_StockCalculation @OrderYear='2026', @OrderWeek=@wk, @ProdKey=@pk, @iUserID=@uid, @oResult=@r OUTPUT, @oMessage=@m OUTPUT;
      SELECT ISNULL(@r,0) AS result, @m AS message;`,
      { wk: { type: sql.NVarChar, value: wk }, pk: { type: sql.Int, value: Number(pk) }, uid: { type: sql.NVarChar, value: UID } });
    console.log(`  재계산 ProdKey=${pk} from ${wk}: ${r[0].result === 0 ? 'OK' : '실패 ' + r[0].message}`);
  }
  // 검증: 26차 음수 해소 + 27차~ 기준선 불변
  console.log('\n── Part2 검증 ──');
  for (const pk of prodKeys.filter(k => chainCheck[k])) {
    const after = await run(`
      SELECT sm.OrderWeek, ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
       WHERE ps.ProdKey=${pk} AND sm.OrderWeek IN ('26-01','26-02','27-01','27-02','28-01','28-02')
         AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026' ORDER BY sm.OrderWeek`);
    const b = Object.fromEntries((baseline[pk]||[]).map(r => [r.OrderWeek, Number(r.Stock)]));
    for (const r of after) {
      const wk = r.OrderWeek, v = Number(r.Stock);
      if (wk.startsWith('26')) {
        console.log(`  pk=${pk} [${wk}] ${fmt(v)} ${v >= -0.01 ? '✅' : '❌ 여전히 음수'}`);
      } else if (wk in b && Math.abs(v - b[wk]) > 0.02) {
        console.log(`  pk=${pk} [${wk}] ❌ 기준선 변경됨! ${fmt(b[wk])} → ${fmt(v)}`);
      }
    }
  }
}

// ── Part1: Product.Stock 음수 → 최신 스냅샷 동기화 (StockHistory 없음)
console.log('\n── Part1: Product.Stock 음수 → 최신 스냅샷 동기화 ──');
const liveNegs = await run(`
  SELECT p.ProdKey, p.CounName, p.ProdName, p.Stock AS live,
    ISNULL((SELECT TOP 1 ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
      WHERE ps.ProdKey=p.ProdKey AND sm.OrderYearWeek IS NOT NULL ORDER BY sm.OrderYearWeek DESC),0) AS snap
  FROM Product p WHERE p.isDeleted=0 AND ISNULL(p.Stock,0) < 0 ORDER BY p.Stock ASC`);
console.log(`대상 ${liveNegs.length}건`);
for (const x of liveNegs) {
  console.log(`  ${x.CounName}/${x.ProdName}: 라이브 ${fmt(x.live)} → ${fmt(x.snap)}`);
  if (!APPLY) continue;
  await run(`UPDATE Product SET Stock = ROUND(@snap,2) WHERE ProdKey=@pk`,
    { snap: { type: sql.Float, value: Number(x.snap) }, pk: { type: sql.Int, value: x.ProdKey } });
}
if (APPLY) {
  const remain = await run(`SELECT COUNT(*) AS cnt FROM Product WHERE isDeleted=0 AND ISNULL(Stock,0) < 0`);
  console.log(`적용 후 Product.Stock 음수 잔여: ${remain[0].cnt}건`);
  try {
    await run(`INSERT INTO AppLog (Category, Step, Detail, IsError)
      VALUES (N'stockLiveSync', N'fix-negative-stock-20260714', N'live→snapshot ${liveNegs.length}건, 26차 순델타0 페어 ${safeTargets.length}건 (${UID})', 0)`);
  } catch { /* AppLog 없어도 무시 */ }
}

await pool.close();
console.log(`\n===== ${APPLY ? '적용 완료' : 'dry-run 완료 — 적용하려면 --apply'} =====`);
