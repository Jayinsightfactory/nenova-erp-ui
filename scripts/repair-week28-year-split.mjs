/**
 * 28-01 연도분열 수리 — 업로드가 orderYear=2025 로 만든 마스터/출고일 정정
 * 원인: normalizeOrderYear('28-01') 레거시 규칙(NN-NN→2025)
 * 실행: node scripts/repair-week28-year-split.mjs [--apply]
 */
import fs from 'fs';
import sql from 'mssql';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const APPLY = process.argv.includes('--apply');
const SCRATCH = 'C:/Users/USER/AppData/Local/Temp/claude/C--Users-USER/73f1a8df-325e-449a-8369-a54280c3131b/scratchpad';

// 중복 루스커스(2025쪽 SdetailKey) — 엑셀 1배가 정답, 2025쪽 삭제
const DUP_RUSCUS_DK25 = [79647, 79662, 79706, 79707, 79710];
// 중복쌍: 2025마스터 → 2026마스터 이동
const MOVE_PAIRS = [
  { sk25: 5495, sk26: 5392 }, // 그린화원
  { sk25: 5496, sk26: 5390 }, // 꽃길
  { sk25: 5498, sk26: 5358 }, // 레바논 꽃방
  { sk25: 5499, sk26: 5324 }, // 수경원예
  { sk25: 5500, sk26: 5349 }, // 수연원예
];

const pool = await sql.connect({
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 },
});
const q = (sqlText) => pool.request().query(sqlText);

// ── 0) 백업
const backup = {};
backup.masters = (await q(`SELECT sm.* FROM ShipmentMaster sm WHERE sm.OrderWeek='28-01'`)).recordset;
backup.details = (await q(`SELECT sd.* FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey WHERE sm.OrderWeek='28-01'`)).recordset;
backup.dates = (await q(`SELECT x.* FROM ShipmentDate x JOIN ShipmentDetail sd ON x.SdetailKey=sd.SdetailKey JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey WHERE sm.OrderWeek='28-01'`)).recordset;
backup.orderMasters = (await q(`SELECT * FROM OrderMaster WHERE OrderWeek='28-01' AND ISNULL(OrderYear,'')='2025'`)).recordset;
const bkPath = `${SCRATCH}/backup-week28-year-split.json`;
fs.writeFileSync(bkPath, JSON.stringify(backup));
console.log(`백업: 마스터${backup.masters.length} 상세${backup.details.length} 날짜${backup.dates.length} 주문마스터${backup.orderMasters.length} → ${bkPath}`);

// 사전 스냅샷: cust×prod 합 (루스커스 중복 제거 반영 전)
const beforeSum = (await q(`
  SELECT sm.CustKey, sd.ProdKey, SUM(sd.OutQuantity) AS s
    FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
   WHERE sm.OrderWeek='28-01' AND ISNULL(sm.isDeleted,0)=0
   GROUP BY sm.CustKey, sd.ProdKey`)).recordset;
const beforeMap = new Map(beforeSum.map(r => [`${r.CustKey}|${r.ProdKey}`, Number(r.s)]));

if (!APPLY) { console.log('\n[dry-run] --apply 로 실행하세요'); process.exit(0); }

const tx = new sql.Transaction(pool);
await tx.begin();
const tq = (sqlText) => new sql.Request(tx).query(sqlText);
try {
  // ── 1) 중복 루스커스 2025쪽 삭제 (ShipmentDate 먼저)
  const dkList = DUP_RUSCUS_DK25.join(',');
  const d1 = await tq(`DELETE FROM ShipmentDate WHERE SdetailKey IN (${dkList})`);
  const d2 = await tq(`DELETE FROM ShipmentDetail WHERE SdetailKey IN (${dkList})`);
  console.log(`1) 중복 루스커스 삭제: 상세${d2.rowsAffected[0]} 날짜행${d1.rowsAffected[0]}`);

  // ── 2) 이동 전 잔여 충돌 검사 (있으면 중단)
  for (const { sk25, sk26 } of MOVE_PAIRS) {
    const c = await tq(`
      SELECT COUNT(*) AS n FROM ShipmentDetail a JOIN ShipmentDetail b ON b.ShipmentKey=${sk26} AND b.ProdKey=a.ProdKey
       WHERE a.ShipmentKey=${sk25}`);
    if (c.recordset[0].n > 0) throw new Error(`이동 충돌 잔존: sk25=${sk25}→sk26=${sk26} (${c.recordset[0].n}건)`);
  }

  // ── 3) 상세 이동 + 빈 2025 마스터 하드삭제 (isDeleted=1 금지 — 재활용 트랩)
  for (const { sk25, sk26 } of MOVE_PAIRS) {
    const mv = await tq(`UPDATE ShipmentDetail SET ShipmentKey=${sk26} WHERE ShipmentKey=${sk25}`);
    const left = await tq(`SELECT COUNT(*) AS n FROM ShipmentDetail WHERE ShipmentKey=${sk25}`);
    if (left.recordset[0].n !== 0) throw new Error(`sk25=${sk25} 상세 잔존`);
    await tq(`DELETE FROM ShipmentMaster WHERE ShipmentKey=${sk25}`);
    console.log(`3) sk${sk25}→sk${sk26} 이동 ${mv.rowsAffected[0]}건 + 빈마스터 삭제`);
  }

  // ── 4) 나머지 2025 마스터 연도 정정
  const u1 = await tq(`
    UPDATE ShipmentMaster SET OrderYear='2026', OrderYearWeek='202628'
     WHERE OrderWeek='28-01' AND ISNULL(isDeleted,0)=0 AND ISNULL(OrderYearWeek,'') LIKE '2025%'`);
  console.log(`4) 분배마스터 연도정정: ${u1.rowsAffected[0]}건`);

  // ── 5) 주문마스터 연도 정정 (5557 로뎀, 5564 참좋은 — 업로드 신규생성분)
  const u2 = await tq(`
    UPDATE OrderMaster SET OrderYear='2026'
     WHERE OrderWeek='28-01' AND ISNULL(isDeleted,0)=0 AND ISNULL(OrderYear,'')='2025'
       AND OrderMasterKey IN (5557, 5564)`);
  console.log(`5) 주문마스터 연도정정: ${u2.rowsAffected[0]}건`);

  // ── 6) 출고일 +364일 (요일 보존: 2025-07-09수 → 2026-07-08수)
  const u3 = await tq(`
    UPDATE sd SET sd.ShipmentDtm = DATEADD(day, 364, sd.ShipmentDtm)
      FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
     WHERE sm.OrderWeek='28-01' AND ISNULL(sm.isDeleted,0)=0
       AND sd.ShipmentDtm >= '2025-07-01' AND sd.ShipmentDtm < '2025-08-01'`);
  const u4 = await tq(`
    UPDATE x SET x.ShipmentDtm = DATEADD(day, 364, x.ShipmentDtm)
      FROM ShipmentDate x JOIN ShipmentDetail sd ON x.SdetailKey=sd.SdetailKey
      JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
     WHERE sm.OrderWeek='28-01' AND ISNULL(sm.isDeleted,0)=0
       AND x.ShipmentDtm >= '2025-07-01' AND x.ShipmentDtm < '2025-08-01'`);
  console.log(`6) 출고일 시프트: 상세${u3.rowsAffected[0]}건 날짜행${u4.rowsAffected[0]}건`);

  // ── 7) 트랜잭션 내 검증
  const v1 = await tq(`
    SELECT COUNT(*) AS n FROM ShipmentMaster WHERE OrderWeek='28-01' AND ISNULL(isDeleted,0)=0 AND ISNULL(OrderYearWeek,'') NOT LIKE '2026%'`);
  const v2 = await tq(`
    SELECT COUNT(*) AS n FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
     WHERE sm.OrderWeek='28-01' AND ISNULL(sm.isDeleted,0)=0 AND (sd.ShipmentDtm < '2026-07-01' OR sd.ShipmentDtm >= '2026-08-01')`);
  const v3 = await tq(`
    SELECT COUNT(*) AS n FROM (
      SELECT sm.CustKey FROM ShipmentMaster sm WHERE sm.OrderWeek='28-01' AND ISNULL(sm.isDeleted,0)=0
      GROUP BY sm.CustKey HAVING COUNT(*) > 1) t`);
  const v4 = await tq(`
    SELECT sm.CustKey, sd.ProdKey, SUM(sd.OutQuantity) AS s
      FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
     WHERE sm.OrderWeek='28-01' AND ISNULL(sm.isDeleted,0)=0 GROUP BY sm.CustKey, sd.ProdKey`);
  // 합계 보존 검증: 중복루스커스 5쌍만 절반, 나머지는 동일해야 함
  const dupCustProd = new Set(); // sk25 middlemen — cust|prod of the 5 ruscus
  let sumMismatch = 0;
  const afterMap = new Map(v4.recordset.map(r => [`${r.CustKey}|${r.ProdKey}`, Number(r.s)]));
  for (const [k, before] of beforeMap) {
    const after = afterMap.get(k) ?? 0;
    if (after === before) continue;
    if (after * 2 === before) { dupCustProd.add(k); continue; } // 루스커스 절반 = 의도됨
    sumMismatch++;
    console.log(`   ⚠ 합계변동: ${k} ${before}→${after}`);
  }
  console.log(`7) 검증: 비2026마스터=${v1.recordset[0].n} 이상출고일=${v2.recordset[0].n} 중복마스터업체=${v3.recordset[0].n} 의도된절반(루스커스)=${dupCustProd.size} 예상외변동=${sumMismatch}`);
  if (v1.recordset[0].n || v2.recordset[0].n || v3.recordset[0].n || sumMismatch || dupCustProd.size !== 5) {
    throw new Error('검증 실패 — 롤백');
  }
  await tx.commit();
  console.log('\n✅ COMMIT 완료');
} catch (e) {
  await tx.rollback();
  console.error('\n❌ ROLLBACK:', e.message);
  process.exitCode = 1;
}
await pool.close();
