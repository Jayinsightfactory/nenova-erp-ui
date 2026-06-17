/**
 * Orange Flame (exe 누락) + 그린화원 24차 (web 누락) 견적 진단
 * node scripts/probe-estimate-orange-green-24.mjs          — 상세 덤프
 * node scripts/probe-estimate-orange-green-24.mjs --strict — smoke와 동일 assert (exit 1 on fail)
 */
import {
  runEstimateRegressionChecks,
  countBadNormalEstimateRows,
} from '../lib/smokeEstimateRegression.js';

const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';
const STRICT = process.argv.includes('--strict');

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
  return { status: res.status, json };
}

async function main() {
  const login = await request('/api/auth/login', { method: 'POST', body: { userId: USER, password: PASS } });
  if (!login.json?.token) {
    console.error('Login failed', login.status, login.json);
    process.exit(1);
  }
  const token = login.json.token;
  const authedRequest = (path) => request(path, { token });

  if (STRICT) {
    console.log(`=== probe strict (${BASE}) ===`);
    const checks = await runEstimateRegressionChecks(authedRequest);
    let fail = 0;
    for (const chk of checks) {
      if (chk.skip) {
        console.log(`  (skip) ${chk.label}`);
        continue;
      }
      const mark = chk.ok ? '✓' : '✗';
      console.log(`  ${mark} ${chk.label}${chk.detail ? `: ${chk.detail}` : ''}`);
      if (!chk.ok) fail++;
    }
    process.exit(fail > 0 ? 1 : 0);
  }

  const checks = [
    { label: 'Orange Flame visibility 24-01', path: '/api/shipment/estimate-visibility?week=24-01&weeks=24-01,24-02&q=Orange%20Flame' },
    { label: 'Orange Flame visibility 24-02', path: '/api/shipment/estimate-visibility?week=24-02&weeks=24-01,24-02&q=Flame' },
    { label: 'Orange Flame cost audit 24-01', path: '/api/dev/estimate-cost-source-audit?week=24-01&prod=Orange%20Flame&limit=30' },
    { label: 'Orange Flame cost audit 24-02', path: '/api/dev/estimate-cost-source-audit?week=24-02&prod=Flame&limit=30' },
    { label: '그린화원 visibility 24-01', path: '/api/shipment/estimate-visibility?week=24-01&weeks=24-01,24-02&q=%EA%B7%B8%EB%A6%B0' },
    { label: '그린화원 period repair GET', path: '/api/shipment/estimate-period-repair?weeks=24-01,24-02&q=%EA%B7%B8%EB%A6%B0%ED%99%94%EC%9B%90' },
    { label: '그린화원 shipdates 24-01', path: '/api/shipment/estimate-period-repair?shipdates=24-01&cust=%EA%B7%B8%EB%A6%B0' },
  ];

  for (const c of checks) {
    console.log(`\n=== ${c.label} ===`);
    const r = await authedRequest(c.path);
    console.log(`HTTP ${r.status}`);
    console.log(JSON.stringify(r.json, null, 2).slice(0, 4000));
  }

  console.log('\n=== 그린화원 estimate list week=24 ===');
  const est = await authedRequest('/api/estimate?week=24&includeUnfixed=0');
  const green = (est.json?.shipments || []).filter((s) => String(s.CustName || '').includes('그린'));
  console.log('Green shipments:', green.length);
  for (const g of green.slice(0, 3)) {
    console.log(`  ${g.CustName} keys=${g.ShipmentKeys} weeks=${g.SubWeeks}`);
    const keys = String(g.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
    for (const sk of keys) {
      const items = await authedRequest(`/api/estimate?shipmentKey=${sk}&byDate=1`);
      console.log(`    SK=${sk} items=${items.json?.items?.length || 0}`);
      for (const row of (items.json?.items || []).slice(0, 12)) {
        console.log(`      ${String(row.ProdName || '').slice(0, 45)} qty=${row.Quantity} cost=${row.Cost} amt=${row.Amount} type=${row.EstimateType}`);
      }
      const zeroRows = countBadNormalEstimateRows(items.json?.items);
      if (zeroRows.length) {
        console.log(`    ⚠ zero qty/cost: ${zeroRows.map((r) => r.ProdName).join(', ')}`);
      }
    }
  }

  const regression = await runEstimateRegressionChecks(authedRequest);
  console.log('\n=== regression summary ===');
  for (const chk of regression) {
    console.log(`  ${chk.skip ? 'skip' : chk.ok ? 'OK' : 'FAIL'} ${chk.label}${chk.detail ? `: ${chk.detail}` : ''}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
