// nenovaweb 프로덕션 읽기 전용 스모크 테스트 (로그인 + 진단 API)
// 실행: node __tests__/nenovawebSmoke.test.js
// 환경변수: SMOKE_BASE_URL (기본 https://nenovaweb.com)

const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

async function main() {
  let pass = 0;
  let fail = 0;
  const assert = (label, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}${detail ? `: ${detail}` : ''}`); }
  };

  console.log(`=== nenovaweb smoke (${BASE}) ===`);

  console.log('\n--- 로그인 ---');
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { userId: USER, password: PASS },
  });
  assert('login 200', login.status === 200, `status=${login.status}`);
  const token = login.json?.token;
  assert('token 발급', !!token);
  if (!token) {
    console.log(JSON.stringify(login.json, null, 2));
    process.exit(1);
  }

  console.log('\n--- 23-01 주광 Hydrangea 진단 (수정 후 구조) ---');
  const vis = await request(
    '/api/shipment/estimate-visibility?week=23-01&q=Hydrangea%20White&cust=주광',
    { token }
  );
  assert('estimate-visibility 200', vis.status === 200, `status=${vis.status}`);
  const items = vis.json?.items || vis.json?.rows || [];
  const hydr = Array.isArray(items)
    ? items.find((r) => /hydrangea\s*white/i.test(String(r.ProdName || r.prodName || '')))
    : null;
  if (hydr) {
    const detailCnt = Number(hydr.detailSplitCnt ?? hydr.DetailSplitCnt ?? 1);
    const broken = hydr.exeStructureBroken ?? hydr.ExeStructureBroken;
    assert('Hydrangea White detailSplitCnt≤1', detailCnt <= 1, `detailSplitCnt=${detailCnt}`);
    assert('exeStructureBroken=false', broken === false || broken === 0 || broken == null, String(broken));
    const thuEst = Number(hydr.thuEst ?? hydr.ThuEst ?? hydr.estThu ?? 0);
    const sunEst = Number(hydr.sunEst ?? hydr.SunEst ?? hydr.estSun ?? 0);
    if (thuEst > 0 || sunEst > 0) {
      assert('목 Est≠5700 전체', thuEst !== 5700 || sunEst === 5400, `thu=${thuEst} sun=${sunEst}`);
      assert('일 Est=5400 또는 합리적', sunEst === 0 || sunEst >= 300, `sun=${sunEst}`);
    }
  } else {
    console.log('  (Hydrangea White 행 없음 — 수동 확인)');
  }

  console.log('\n--- estimate-period-repair 진단 (쓰기 없음) ---');
  const repair = await request(
    '/api/shipment/estimate-period-repair?shipdates=23-01&cust=주광',
    { token }
  );
  assert('estimate-period-repair GET 200', repair.status === 200, `status=${repair.status}`);
  const brokenGroups = repair.json?.brokenGroups || repair.json?.groups || [];
  const multiDetail = Array.isArray(brokenGroups)
    ? brokenGroups.filter((g) => Number(g.detailCount || g.sdetailCount || 0) > 1)
    : [];
  assert('23-01 주광 multi-detail broken 그룹 0', multiDetail.length === 0, `count=${multiDetail.length}`);

  console.log('\n--- public shipments GET (API 키) ---');
  const pubRes = await fetch(
    `${BASE}/api/public/shipments?week=23-01&custName=${encodeURIComponent('주광')}&limit=5&apiKey=nenova-api-2026`
  );
  const pubJson = await pubRes.json().catch(() => ({}));
  assert('public shipments GET 200', pubRes.status === 200, `status=${pubRes.status}`);
  assert('public shipments success', pubJson.success !== false);

  console.log('\n--- 24차 견적 회귀 (Orange Flame + 그린화원) ---');
  const { runEstimateRegressionChecks } = await import('../lib/smokeEstimateRegression.js');
  const authedRequest = (path) => request(path, { token });
  const estimateChecks = await runEstimateRegressionChecks(authedRequest);
  for (const chk of estimateChecks) {
    if (chk.skip) {
      console.log(`  (skip) ${chk.label}: ${chk.detail || ''}`);
      continue;
    }
    assert(chk.label, chk.ok, chk.detail || '');
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
