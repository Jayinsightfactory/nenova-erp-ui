#!/usr/bin/env node
/** Part2 롤백 (pk 2158 리모늄, 181 Anthurium) — 오늘 넣은 순델타0 페어 삭제 + 스냅샷 기준선 복원
 *  (1255 Pink Mondial 은 검증 통과 → 유지)
 *  usp_StockCalculation 재실행 금지 — 재계산이 잠재 불일치를 다시 드러내므로 직접 UPDATE로 원복.
 */
import fs from 'fs';
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = (await import('mssql')).default;
const APPLY = process.argv.includes('--apply');
const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
});
const run = async (q, p = {}) => {
  const req = pool.request();
  for (const [k, v] of Object.entries(p)) req.input(k, v.type, v.value);
  return (await req.query(q)).recordset;
};

// 적용 전 기준선 (probe/dry-run 실측값)
const BASELINE = {
  2158: { '26-01': -37, '26-02': -45, '27-01': 0, '27-02': 0 },
  181:  { '26-01': -173, '26-02': -9, '27-01': -9, '27-02': 0 },
};

console.log(`===== ${APPLY ? '⚠️ APPLY' : 'DRY-RUN'} =====`);

// 1. 오늘 삽입한 페어 행 확인/삭제
const rows = await run(`
  SELECT StockHistoryKey, ProdKey, OrderWeek, BeforeValue, AfterValue, Descr
    FROM StockHistory
   WHERE ProdKey IN (2158, 181)
     AND Descr LIKE N'수동보정:차수잔량 음수이월정리%'
     AND ChangeDtm >= CAST(GETDATE() AS DATE)`);
console.log(`삭제 대상 StockHistory: ${rows.length}건`);
rows.forEach(r => console.log(`  key=${r.StockHistoryKey} pk=${r.ProdKey} [${r.OrderWeek}] ${r.BeforeValue}→${r.AfterValue}`));
if (APPLY && rows.length) {
  await run(`DELETE FROM StockHistory WHERE StockHistoryKey IN (${rows.map(r => r.StockHistoryKey).join(',')})`);
  console.log('  → 삭제 완료');
}

// 2. 스냅샷 기준선 복원 (직접 UPDATE, 재계산 없음)
for (const [pk, weeks] of Object.entries(BASELINE)) {
  for (const [wk, val] of Object.entries(weeks)) {
    const cur = await run(`
      SELECT ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
       WHERE ps.ProdKey=@pk AND sm.OrderWeek=@wk AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026'`,
      { pk: { type: sql.Int, value: +pk }, wk: { type: sql.NVarChar, value: wk } });
    const now = Number(cur[0]?.Stock ?? NaN);
    const need = Math.abs(now - val) > 0.01;
    console.log(`  pk=${pk} [${wk}] 현재 ${now} → 기준선 ${val} ${need ? '(복원)' : '(일치, 스킵)'}`);
    if (APPLY && need) {
      await run(`
        UPDATE ps SET ps.Stock = @val
          FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
         WHERE ps.ProdKey=@pk AND sm.OrderWeek=@wk AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026'`,
        { val: { type: sql.Float, value: val }, pk: { type: sql.Int, value: +pk }, wk: { type: sql.NVarChar, value: wk } });
    }
  }
}

if (APPLY) {
  console.log('\n── 복원 검증 ──');
  const chk = await run(`
    SELECT ps.ProdKey, sm.OrderWeek, ps.Stock FROM ProductStock ps JOIN StockMaster sm ON sm.StockKey=ps.StockKey
     WHERE ps.ProdKey IN (2158,181) AND sm.OrderWeek IN ('26-01','26-02','27-01','27-02')
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)),'2026')='2026' ORDER BY ps.ProdKey, sm.OrderWeek`);
  chk.forEach(r => {
    const want = BASELINE[r.ProdKey][r.OrderWeek];
    console.log(`  pk=${r.ProdKey} [${r.OrderWeek}] ${r.Stock} ${Math.abs(r.Stock - want) < 0.01 ? '✅' : '❌ (기대 ' + want + ')'}`);
  });
}
await pool.close();
console.log('===== 완료 =====');
