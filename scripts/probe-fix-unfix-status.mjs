/**
 * 확정/확정취소 AppLog + fix-status 직접 조회
 * node scripts/probe-fix-unfix-status.mjs [week]  (기본 22-01)
 */
const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';
const WEEK = process.argv[2] || '22-01';

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userId: USER, password: PASS }),
  });
  const d = await r.json();
  if (!d.token) throw new Error(`Login failed: ${r.status} ${JSON.stringify(d)}`);
  return d.token;
}

async function get(path, token) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: r.status, json };
}

async function main() {
  const token = await login();
  console.log(`\n=== fix-status ${WEEK} ===`);
  const fs = await get(`/api/shipment/fix-status?fromWeek=${encodeURIComponent(WEEK)}&toWeek=${encodeURIComponent(WEEK)}`, token);
  console.log('HTTP', fs.status);
  const weekRow = (fs.json?.weeks || []).find(w => w.OrderWeek === WEEK || w.WeekKey === WEEK);
  console.log('Week row:', weekRow ? JSON.stringify(weekRow, null, 2) : '(none)');
  console.log('Categories sample:', (fs.json?.categories || []).slice(0, 5));

  console.log(`\n=== AppLog shipmentFix (unfix/fix, ${WEEK}) ===`);
  const log = await get('/api/dev/app-log?limit=80&category=shipmentFix', token);
  console.log('HTTP', log.status);
  const rows = (log.json?.logs || [])
    .filter(l => String(l.Detail || '').includes(WEEK))
    .filter(l => String(l.Step || '').startsWith('unfix_') || String(l.Step || '').startsWith('fix_') || String(l.Step || '').includes('stock_calc'));
  if (!rows.length) {
    console.log('(해당 차수 로그 없음 — 전체 최근 15건)');
    (log.json?.logs || []).slice(0, 15).forEach(l => console.log(`  ${l.CreateDtm} ${l.Step} ${String(l.Detail || '').slice(0, 120)}`));
  } else {
    rows.forEach(l => {
      const mark = l.IsError ? 'ERR' : '   ';
      console.log(`${mark} ${l.CreateDtm} | ${l.Step} | ${l.Detail}`);
    });
  }

  const lastProg = [...rows].reverse().find(l => String(l.Step || '').includes('stock_calc_progress') || String(l.Step || '').includes('stock_calc_item'));
  const lastDone = [...rows].reverse().find(l => String(l.Step || '').includes('stock_calc_done') || l.Step === 'unfix_done');
  const lastErr = [...rows].reverse().find(l => l.IsError || String(l.Step || '').includes('_error'));

  console.log('\n=== 진단 요약 ===');
  if (lastDone) console.log('마지막 완료:', lastDone.Step, lastDone.Detail);
  if (lastProg && !lastDone) console.log('진행 중단 지점(추정):', lastProg.Step, lastProg.Detail);
  if (lastErr) console.log('마지막 오류:', lastErr.Step, lastErr.Detail);
  if (!lastDone && !lastProg) console.log('확정취소/확정 로그 없음 — 해당 차수 미처리 또는 AppLog 미기록');
}

main().catch(e => { console.error(e); process.exit(1); });
