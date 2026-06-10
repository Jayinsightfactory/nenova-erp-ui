// 24-01 등 차수: nenova.exe vs 웹 정합 자동 비교 (읽기 전용)
// node scripts/compare-week-exe.js [24-01]
const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';
const WEEK = process.argv[2] || '24-01';

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { userId: USER, password: PASS },
  });
  if (!login.json?.token) {
    console.error('LOGIN FAIL', login);
    process.exit(1);
  }
  const token = login.json.token;

  const [validate, repair, audit, estListFixed, shipList] = await Promise.all([
    req(`/api/estimate/validate?week=${WEEK}`, { token }),
    req(`/api/shipment/estimate-period-repair?weeks=${WEEK}`, { token }),
    req(`/api/dev/estimate-cost-source-audit?week=${WEEK}&limit=300`, { token }),
    req(`/api/estimate?week=${WEEK}`, { token }),
    req(`/api/shipment?week=${WEEK}`, { token }),
  ]);

  let estList = estListFixed;
  const shipRows = shipList.json?.shipments || [];
  const fixedCnt = shipRows.filter((s) => Number(s.isFix) === 1).length;
  const unfixedCnt = shipRows.length - fixedCnt;
  if (!(estList.json?.shipments || []).length && unfixedCnt > 0) {
    estList = await req(`/api/estimate?week=${WEEK}&includeUnfixed=1`, { token });
  }
  const includeUnfixed = estList !== estListFixed;

  console.log(`=== ${WEEK} exe vs 웹 자동 비교 (${BASE}) ===`);
  if (shipRows.length) {
    console.log(
      `    출고마스터 ${shipRows.length}건 (확정 ${fixedCnt} / 미확정 ${unfixedCnt})${includeUnfixed ? ' — 미확정 포함 조회' : ''}`
    );
  }
  console.log('');

  const v = validate.json || {};
  console.log(`[1] 견적 불변조건 validate — HTTP ${validate.status}`);
  const checks = v.checks || [];
  const failed = checks.filter((c) => !c.ok);
  console.log(`    pass=${v.pass ?? '?'} fail=${v.fail ?? failed.length}`);
  if (failed.length) {
    console.log('    실패 항목:');
    for (const c of failed.slice(0, 15)) {
      console.log(`      - ${c.id} (${c.week}): broken=${c.broken ?? c.count ?? '?'}`);
      (c.samples || []).slice(0, 2).forEach((s) => {
        console.log(`          ${s.CustName || ''} ${s.ProdName || ''}`);
      });
    }
  } else {
    console.log('    모든 검증 통과');
  }

  const r = repair.json || {};
  console.log(`\n[2] 출고일/견적수량 진단 — HTTP ${repair.status}`);
  const dateCnt = Number(r.dateMismatchCount || 0);
  const estCnt = Number(r.estMismatchCount || 0);
  const byProduct = r.byProduct || [];
  const dateSamples = (r.dateSamples || []).slice(0, 5);
  const estSamples = (r.estSamples || []).slice(0, 5);
  console.log(
    `    품목집계: ${byProduct.length}종 | 출고일불일치=${dateCnt} Est불일치=${estCnt} 확정행이슈=${r.fixedWeekRowCount ?? 0}`
  );
  dateSamples.forEach((x) => {
    console.log(`      날짜 ${x.CustName} ${x.ProdName} ${x.DateDtm || ''}`);
  });
  estSamples.forEach((x) => {
    console.log(
      `      Est ${x.CustName} ${x.ProdName} out=${x.OutQuantity} est=${x.EstQuantity} exp=${x.ExpEst ?? ''}`
    );
  });
  if (!dateCnt && !estCnt) {
    console.log('    exe 구조/출고일/Est 이상 없음');
  }

  const a = audit.json || {};
  console.log(`\n[3] Detail vs ShipmentDate vs ViewShipment (exe 견적 소스) — HTTP ${audit.status}`);
  const mismatches = a.allMismatches || [];
  console.log(`    Cost/Amount/Vat 불일치: ${mismatches.length}건`);
  const byCust = {};
  for (const m of mismatches) {
    const k = m.CustName || '?';
    byCust[k] = (byCust[k] || 0) + 1;
  }
  Object.entries(byCust)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([c, n]) => console.log(`      ${c}: ${n}건`));
  mismatches.slice(0, 12).forEach((m) => {
    console.log(
      `      ${m.CustName} | ${m.ProdName} | D:${m.DetailCost}/${m.DetailAmount} Date:${m.DateCost}/${m.DateAmount} View:${m.ViewCost}/${m.ViewAmount}`
    );
  });
  if (mismatches.length > 12) console.log(`      ... 외 ${mismatches.length - 12}건`);

  console.log(`\n[4] 웹 견적 로드(byDate) vs 인쇄 금액식 — HTTP ${estList.status}`);
  const weekShipments = shipRows.filter((s) => String(s.OrderWeek || '') === WEEK);
  const shipments = weekShipments.length ? weekShipments : estList.json?.shipments || [];
  console.log(`    거래처(출고마스터): ${shipments.length}건 (${WEEK} 기준)`);

  const samples = [];
  const scan = shipments.slice(0, Math.min(shipments.length, 30));
  for (const s of scan) {
    const sk = s.ShipmentKey || s.firstShipmentKey;
    if (!sk) continue;
    const itemsRes = await req(`/api/estimate?shipmentKey=${sk}&byDate=1`, { token });
    const list = itemsRes.json?.items || [];
    let badCost = 0;
    for (const it of list) {
      const qty = Number(it.Quantity || 0);
      const cost = Number(it.Cost || 0);
      const amt = Number(it.Amount || 0);
      const vat = Number(it.Vat || 0);
      if (qty > 0 && cost > 0 && Math.abs(cost * qty - (amt + vat)) > 2) badCost++;
    }
    if (list.length) {
      samples.push({
        cust: s.CustName,
        rows: list.length,
        badCost,
        fixed: Number(s.isFix || 0) === 1,
      });
    }
  }
  samples.forEach((s) => {
    console.log(
      `      ${s.cust}${s.fixed ? ' [확정]' : ''}: ${s.rows}행, 단가×수량 불일치=${s.badCost}`
    );
  });
  if (!samples.length && shipments.length) {
    console.log('    (byDate 행 없음 — 출고 상세 미생성 가능)');
  }

  const printBad = samples.reduce((acc, x) => acc + x.badCost, 0);
  console.log('\n=== 종합 판정 ===');
  const issues = [];
  if (failed.length) issues.push(`불변조건 실패 ${failed.length}항목`);
  if (dateCnt) issues.push(`출고일 불일치 ${dateCnt}건`);
  if (estCnt) issues.push(`EstQuantity 불일치 ${estCnt}건`);
  if (mismatches.length) issues.push(`Detail↔Date↔View 불일치 ${mismatches.length}건`);
  if (printBad) issues.push(`웹 인쇄 금액식 불일치 ${printBad}행`);

  if (!shipments.length && shipRows.length) {
    issues.push(`${WEEK} 출고는 ${shipRows.length}건 있으나 견적 목록 0건`);
  }

  if (!issues.length) {
    const note = unfixedCnt && !fixedCnt ? ' (전부 미확정 — exe 확정 전과 동일 상태)' : '';
    console.log(`OK — ${WEEK} 차수 exe·웹 정합 양호${note}`);
    process.exit(0);
  }
  console.log('주의:');
  issues.forEach((i) => console.log(`  • ${i}`));
  if (mismatches.length) {
    console.log('  ※ Detail↔Date 불일치 → /api/dev/estimate-cost-date-sync 로 복구 가능');
  }
  process.exit(issues.some((i) => i.includes('Est') || i.includes('출고일') || i.includes('불변')) ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
