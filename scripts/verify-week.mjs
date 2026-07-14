#!/usr/bin/env node
/**
 * 차수 검증 도구 (READ-ONLY) — "작업 끝나고 뭐가 어긋났는지" 한 방 점검
 *
 * 사용법:
 *   node scripts/verify-week.mjs 28                 # 2026년 28차(전 세부차수) 불변식 검사
 *   node scripts/verify-week.mjs 28 --snapshot      # 작업 '전' 스냅샷 저장 (.verify/2026-28.json)
 *   node scripts/verify-week.mjs 28 --diff          # 작업 '후' 스냅샷과 비교 — 의도 안 한 변경 탐지
 *   node scripts/verify-week.mjs 2025-52            # 연도 지정
 *
 * 절차 (docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md C-9):
 *   ① 수정 작업 전: --snapshot  ② 작업  ③ --diff → 바뀐 거래처/품목이 "의도한 것뿐"인지 눈으로 확인
 *   ④ 인자만 주고 실행(불변식 검사) → 위반 0건 확인. 확정 재사이클 후 ③④ 한 번 더.
 *
 * 불변식 (이슈 이력 기반 — 각각 실제 사고 유형의 시그니처):
 *   V1 단가↔견적 불일치 : ShipmentDate.Cost ≠ ShipmentDetail.Cost
 *       → "단가 변경했는데 견적서 총금액 그대로" (견적서는 ShipmentDate 기반이라 이게 어긋나면 옛 금액 출력)
 *   V2 견적 금액공식    : ShipmentDate.Amount ≠ ROUND(Cost×EstQuantity/1.1) (amountVatFromCostEst 규칙)
 *   V3 수량 분할 정합   : Σ ShipmentDate.ShipmentQuantity ≠ ShipmentDetail.OutQuantity
 *       → "계산값이 바뀌면서 총수량이 바뀜" 유형
 *   V4 견적 누락(날짜)  : ShipmentDate.ShipmentDtm 이 PeriodDay.BaseYmd(자정)와 정확매칭 안 됨
 *       → 시간대 밀림(03:00 등)으로 견적서에서 행 자체가 사라지는 유형
 *   V5 견적 누락(주문)  : 확정 출고인데 매칭 OrderDetail 없음 (ViewShipment⋈ViewOrder 조인 탈락)
 *   V6 견적 누락(빈날짜): OutQuantity>0 인데 ShipmentDate 행이 0개
 *   V7 확정상태 불일치  : ShipmentMaster.isFix ≠ ShipmentDetail.isFix (OutQuantity>0)
 *   V8 Manager 오염     : OrderMaster.Manager 가 UserInfo.UserID 에 없음 (분배 grid 거래처 사라짐 유형)
 *   V9 CustKey 불일치   : ShipmentDetail.CustKey ≠ ShipmentMaster.CustKey (exe 분배화면 누락 유형)
 *
 * DB 수정 없음. 위반 발견 시 exit 1.
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const args = process.argv.slice(2);
const MODE = args.includes('--snapshot') ? 'snapshot' : args.includes('--diff') ? 'diff' : 'check';
const weekArg = args.find(a => !a.startsWith('--'));
if (!weekArg) {
  console.error('사용법: node scripts/verify-week.mjs <대차수|YYYY-대차수> [--snapshot|--diff]');
  process.exit(2);
}
const m = String(weekArg).match(/^(?:(\d{4})-)?(\d{1,2})$/);
if (!m) { console.error(`차수 형식 오류: ${weekArg} (예: 28 또는 2025-52)`); process.exit(2); }
const YEAR = m[1] || String(new Date().getFullYear());
const MAJOR = m[2].padStart(2, '0');
const OYW = YEAR + MAJOR; // OrderYearWeek raw = 연도+대차수 (예: 202628)
const SNAP_DIR = path.join(process.cwd(), '.verify');
const SNAP_FILE = path.join(SNAP_DIR, `${YEAR}-${MAJOR}.json`);

fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/).forEach((line) => {
  const mm = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (mm) process.env[mm[1]] = mm[2];
});

const fmt = (n) => Number(n || 0).toLocaleString();

async function main() {
  const pool = await sql.connect({
    server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, requestTimeout: 120000 },
  });
  const run = async (q, params = {}) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v.type, v.value);
    return (await req.query(q)).recordset;
  };
  const P = { oyw: { type: sql.NVarChar, value: OYW }, weekLike: { type: sql.NVarChar, value: `${MAJOR}-%` }, yr: { type: sql.NVarChar, value: YEAR } };

  // 이 대차수의 sub-week 목록 (연도 일치 확인)
  const subWeeks = (await run(`
    SELECT DISTINCT sm.OrderWeek FROM ShipmentMaster sm
     WHERE sm.isDeleted=0 AND sm.OrderWeek LIKE @weekLike
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) = @yr
     ORDER BY sm.OrderWeek`, P)).map(r => r.OrderWeek);
  console.log(`\n=== ${YEAR}년 ${MAJOR}차 (${subWeeks.join(', ') || '세부차수 없음'}) — ${MODE} ===\n`);

  // 대상 ShipmentDetail 공통 FROM/WHERE (이 대차수·이 연도) — 추가 JOIN은 FROM과 WHERE 사이에
  const SD_FROM = `
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    JOIN Product p ON p.ProdKey = sd.ProdKey
    LEFT JOIN Customer c ON c.CustKey = sm.CustKey`;
  const SD_WHERE = `
   WHERE sm.isDeleted = 0 AND sm.OrderWeek LIKE @weekLike
     AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) = @yr`;
  const FROM_SD = SD_FROM + SD_WHERE;

  // ── 스냅샷 집계 (거래처별 견적총액·총수량 / 품목별 총수량)
  async function takeSnapshot() {
    const byCust = await run(`
      SELECT sm.CustKey, MAX(c.CustName) AS CustName,
             ROUND(SUM(CASE WHEN sd.OutQuantity>0 THEN ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0) ELSE 0 END),0) AS detailTotal,
             ROUND(SUM(CASE WHEN sd.OutQuantity>0 THEN sd.OutQuantity ELSE 0 END),3) AS qtyTotal,
             SUM(CASE WHEN sd.OutQuantity>0 THEN 1 ELSE 0 END) AS rowCnt
      ${FROM_SD}
      GROUP BY sm.CustKey`, P);
    const estByCust = await run(`
      SELECT sm.CustKey,
             ROUND(SUM(ISNULL(sdd.Amount,0)+ISNULL(sdd.Vat,0)),0) AS dateTotal
        FROM ShipmentDate sdd
        JOIN ShipmentDetail sd ON sd.SdetailKey = sdd.SdetailKey
        JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       WHERE sm.isDeleted=0 AND sm.OrderWeek LIKE @weekLike
         AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) = @yr
       GROUP BY sm.CustKey`, P);
    const dedByCust = await run(`
      SELECT sm.CustKey,
             ROUND(SUM(ISNULL(e.Amount,0)+ISNULL(e.Vat,0)),0) AS estimateTotal
        FROM Estimate e
        JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
       WHERE sm.isDeleted=0 AND sm.OrderYearWeek = @oyw
       GROUP BY sm.CustKey`, P);
    const byProd = await run(`
      SELECT sd.ProdKey, MAX(p.ProdName) AS ProdName,
             ROUND(SUM(CASE WHEN sd.OutQuantity>0 THEN sd.OutQuantity ELSE 0 END),3) AS qtyTotal
      ${FROM_SD}
      GROUP BY sd.ProdKey
      HAVING SUM(CASE WHEN sd.OutQuantity>0 THEN sd.OutQuantity ELSE 0 END) <> 0`, P);
    const estMap = Object.fromEntries(estByCust.map(r => [r.CustKey, Number(r.dateTotal)]));
    const dedMap = Object.fromEntries(dedByCust.map(r => [r.CustKey, Number(r.estimateTotal)]));
    return {
      takenAt: new Date().toISOString(), year: YEAR, major: MAJOR, subWeeks,
      customers: Object.fromEntries(byCust.map(r => [r.CustKey, {
        name: r.CustName, detailTotal: Number(r.detailTotal), qtyTotal: Number(r.qtyTotal), rowCnt: Number(r.rowCnt),
        dateTotal: estMap[r.CustKey] ?? 0, estimateTotal: dedMap[r.CustKey] ?? 0,
      }])),
      products: Object.fromEntries(byProd.map(r => [r.ProdKey, { name: r.ProdName, qtyTotal: Number(r.qtyTotal) }])),
    };
  }

  if (MODE === 'snapshot') {
    const snap = await takeSnapshot();
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(SNAP_FILE, JSON.stringify(snap, null, 2));
    const custs = Object.keys(snap.customers).length;
    const total = Object.values(snap.customers).reduce((s, c) => s + c.detailTotal, 0);
    console.log(`📸 스냅샷 저장: ${SNAP_FILE}`);
    console.log(`   거래처 ${custs}곳 · 분배총액(VAT포함) ${fmt(total)}원 · 품목 ${Object.keys(snap.products).length}개`);
    await pool.close();
    return;
  }

  if (MODE === 'diff') {
    if (!fs.existsSync(SNAP_FILE)) {
      console.error(`❌ 스냅샷 없음: ${SNAP_FILE} — 작업 전에 --snapshot 을 먼저 실행하세요.`);
      await pool.close(); process.exit(2);
    }
    const before = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
    const after = await takeSnapshot();
    let changes = 0;
    console.log(`기준 스냅샷: ${before.takenAt}\n`);
    const keys = new Set([...Object.keys(before.customers), ...Object.keys(after.customers)]);
    for (const k of [...keys].sort((a, b) => Number(a) - Number(b))) {
      const b = before.customers[k], a = after.customers[k];
      if (!b) { console.log(`  🆕 거래처 추가: ${a.name} — 총액 ${fmt(a.detailTotal)}`); changes++; continue; }
      if (!a) { console.log(`  🗑 거래처 소멸: ${b.name} — 총액 ${fmt(b.detailTotal)} → 0`); changes++; continue; }
      const diffs = [];
      if (Math.abs(a.detailTotal - b.detailTotal) > 0.5) diffs.push(`분배총액 ${fmt(b.detailTotal)}→${fmt(a.detailTotal)} (${a.detailTotal > b.detailTotal ? '+' : ''}${fmt(a.detailTotal - b.detailTotal)})`);
      if (Math.abs(a.dateTotal - b.dateTotal) > 0.5) diffs.push(`견적(출고일)총액 ${fmt(b.dateTotal)}→${fmt(a.dateTotal)}`);
      if (Math.abs(a.estimateTotal - b.estimateTotal) > 0.5) diffs.push(`차감류총액 ${fmt(b.estimateTotal)}→${fmt(a.estimateTotal)}`);
      if (Math.abs(a.qtyTotal - b.qtyTotal) > 0.001) diffs.push(`총수량 ${b.qtyTotal}→${a.qtyTotal}`);
      if (a.rowCnt !== b.rowCnt) diffs.push(`품목행 ${b.rowCnt}→${a.rowCnt}`);
      if (diffs.length) { console.log(`  ✏️ ${a.name}: ${diffs.join(' · ')}`); changes++; }
    }
    const pKeys = new Set([...Object.keys(before.products), ...Object.keys(after.products)]);
    for (const k of pKeys) {
      const b = before.products[k], a = after.products[k];
      if (b && a && Math.abs(a.qtyTotal - b.qtyTotal) > 0.001) { console.log(`  📦 ${a.name}: 총출고 ${b.qtyTotal}→${a.qtyTotal}`); changes++; }
      else if (!b && a) { console.log(`  🆕 품목 출고 추가: ${a.name} ${a.qtyTotal}`); changes++; }
      else if (b && !a) { console.log(`  🗑 품목 출고 소멸: ${b.name} ${b.qtyTotal}→0`); changes++; }
    }
    console.log(changes === 0
      ? '✅ 스냅샷 대비 변경 없음'
      : `\n총 ${changes}건 변경 — 위 목록이 전부 "의도한 수정"인지 확인하세요. 아니면 어긋난 것.`);
    await pool.close();
    return;
  }

  // ── 불변식 검사 (check 모드)
  const findings = [];
  const report = (code, title, rows, render) => {
    if (!rows.length) { console.log(`  ✅ ${code} ${title} — 0건`); return; }
    findings.push({ code, count: rows.length });
    console.log(`  ❌ ${code} ${title} — ${rows.length}건`);
    rows.slice(0, 10).forEach(r => console.log(`      ${render(r)}`));
    if (rows.length > 10) console.log(`      … 외 ${rows.length - 10}건`);
  };

  report('V1', '단가↔견적 불일치 (ShipmentDate.Cost≠Detail.Cost → 견적서에 옛 금액 출력)', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sd.SdetailKey, sd.Cost AS detailCost, sdd.Cost AS dateCost
    ${SD_FROM}
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    ${SD_WHERE}
    AND ABS(ISNULL(sdd.Cost,0) - ISNULL(sd.Cost,0)) > 0.5`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} 분배단가 ${fmt(r.detailCost)} vs 견적단가 ${fmt(r.dateCost)} (sdk=${r.SdetailKey})`);

  report('V2', '견적 금액공식 위반 (Amount≠ROUND(Cost×Est/1.1))', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sdd.SdateKey, sdd.Amount,
           ROUND(ISNULL(sdd.Cost,0)*ISNULL(sdd.EstQuantity,0)/1.1, 0) AS expected
    ${SD_FROM}
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    ${SD_WHERE}
    AND ABS(ISNULL(sdd.Amount,0) - ROUND(ISNULL(sdd.Cost,0)*ISNULL(sdd.EstQuantity,0)/1.1, 0)) > 1`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} Amount ${fmt(r.Amount)} ≠ 기대 ${fmt(r.expected)}`);

  report('V3', '수량 분할 정합 위반 (ΣShipmentDate.ShipmentQuantity≠OutQuantity)', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sd.SdetailKey, sd.OutQuantity, x.sumQty
    ${SD_FROM}
    CROSS APPLY (SELECT ROUND(SUM(ISNULL(sdd.ShipmentQuantity,0)),3) AS sumQty
                   FROM ShipmentDate sdd WHERE sdd.SdetailKey = sd.SdetailKey) x
    ${SD_WHERE}
    AND sd.OutQuantity > 0
    AND ABS(ISNULL(x.sumQty,0) - sd.OutQuantity) > 0.01`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} Out ${r.OutQuantity} vs 출고일합 ${r.sumQty}`);

  report('V4', '견적 누락 위험 — 출고일이 PeriodDay 자정과 불일치', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sdd.ShipmentDtm
    ${SD_FROM}
    JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
    ${SD_WHERE}
    AND NOT EXISTS (SELECT 1 FROM PeriodDay pd WHERE pd.BaseYmd = sdd.ShipmentDtm)`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} 출고일 ${new Date(r.ShipmentDtm).toISOString()} (자정 아님/기간 밖)`);

  report('V5', '견적 누락 위험 — 확정 출고인데 매칭 주문 없음 (vs⋈vo 조인 탈락)', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sd.OutQuantity
    ${FROM_SD}
    AND ISNULL(sd.isFix,0)=1 AND sd.OutQuantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM OrderDetail od
      JOIN OrderMaster om ON om.OrderMasterKey = od.OrderMasterKey
      WHERE om.isDeleted=0 AND od.isDeleted=0
        AND om.CustKey = sm.CustKey AND od.ProdKey = sd.ProdKey AND om.OrderWeek = sm.OrderWeek)`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} 출고 ${r.OutQuantity} — 주문 없음(견적서에 안 나옴)`);

  report('V6', '견적 누락 위험 — 출고 있는데 ShipmentDate 행 없음', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sd.OutQuantity
    ${FROM_SD}
    AND sd.OutQuantity > 0
    AND NOT EXISTS (SELECT 1 FROM ShipmentDate sdd WHERE sdd.SdetailKey = sd.SdetailKey)`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} 출고 ${r.OutQuantity} — 출고일 행 0개`);

  // 마감차수(26·27) 기준선 0건. 확정 진행 중인 현재 차수는 카테고리별 부분확정 중간상태로 다건이 정상 —
  // "마감 끝난 차수"에서 잡히면 진짜 문제.
  report('V7', '확정상태 불일치 (Master.isFix≠Detail.isFix — 확정 진행중엔 일시적 정상)', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sm.isFix AS masterFix, sd.isFix AS detailFix
    ${FROM_SD}
    AND sd.OutQuantity > 0
    AND ISNULL(sm.isFix,0) <> ISNULL(sd.isFix,0)`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} master=${r.masterFix} detail=${r.detailFix}`);

  report('V8', 'OrderMaster.Manager 오염 (UserID 아님 → 분배 grid 누락)', await run(`
    SELECT om.OrderMasterKey, om.Manager, c.CustName, om.OrderWeek
      FROM OrderMaster om
      LEFT JOIN Customer c ON c.CustKey = om.CustKey
     WHERE om.isDeleted=0 AND om.OrderWeek LIKE @weekLike
       AND ISNULL(CAST(om.OrderYear AS NVARCHAR(4)), @yr) = @yr
       AND NOT EXISTS (SELECT 1 FROM UserInfo u WHERE u.UserID = om.Manager)`, P),
    r => `[${r.OrderWeek}] ${r.CustName} Manager='${r.Manager}' (UserID 아님, omk=${r.OrderMasterKey})`);

  // 음수 이월은 "그 주 출고 없는 품목"이면 확정 검증(잔량검사)을 안 타는 사각지대 —
  // 여기서 잡아 실사/조정 유도. 과거 차수(23~26차) 잔존 음수는 알려진 legacy(2026-07-14 조사).
  report('V10', 'ProductStock 음수 스냅샷 (확정검증 사각지대 — 실사/조정 필요)', await run(`
    SELECT sm.OrderWeek, ps.ProdKey, p.ProdName, p.CounName, ps.Stock,
           CASE WHEN EXISTS (SELECT 1 FROM ShipmentDetail sd JOIN ShipmentMaster sm2 ON sm2.ShipmentKey=sd.ShipmentKey
                              WHERE sd.ProdKey=ps.ProdKey AND sm2.OrderWeek=sm.OrderWeek AND sm2.isDeleted=0
                                AND ISNULL(sd.OutQuantity,0)>0)
                THEN 1 ELSE 0 END AS hasShipment
      FROM ProductStock ps
      JOIN StockMaster sm ON sm.StockKey = ps.StockKey
      JOIN Product p ON p.ProdKey = ps.ProdKey
     WHERE sm.OrderWeek LIKE @weekLike
       AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) = @yr
       AND ps.Stock < -0.01
     ORDER BY ps.Stock ASC`, P),
    r => `[${r.OrderWeek}] ${r.CounName}/${r.ProdName} 스냅샷 ${r.Stock}${Number(r.hasShipment) ? '' : ' (그 주 출고 없음 → 확정검증 안 탐)'}`);

  // NULL 은 exe 분배가 원래 쓰는 정상 패턴(26·27차 기준선 각 ~200건) — "다른 값" 만 이상
  report('V9', 'CustKey 불일치 (Detail이 다른 거래처 값 → exe 분배화면 누락)', await run(`
    SELECT c.CustName, p.ProdName, sm.OrderWeek, sd.CustKey AS detailCust, sm.CustKey AS masterCust
    ${FROM_SD}
    AND sd.OutQuantity > 0
    AND sd.CustKey IS NOT NULL AND sd.CustKey <> 0
    AND sd.CustKey <> sm.CustKey`, P),
    r => `[${r.OrderWeek}] ${r.CustName}/${r.ProdName} detail.CustKey=${r.detailCust} ≠ master=${r.masterCust}`);

  console.log(findings.length === 0
    ? `\n✅ ${YEAR}년 ${MAJOR}차 불변식 위반 없음`
    : `\n❌ 위반 ${findings.map(f => `${f.code}:${f.count}`).join(', ')} — 위 상세를 확인하세요.`);
  await pool.close();
  if (findings.length) process.exit(1);
}

main().catch(e => { console.error('오류:', e.message); process.exit(2); });
