/**
 * exe vs web 확정 불일치 진단
 * node scripts/probe-fix-parity-audit.mjs 2026-25-01
 */
const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';
const WEEK_INPUT = process.argv[2] || '';
const MATCH = WEEK_INPUT.match(/^(\d{4})-(\d{2}-\d{2})$/);
if (!MATCH) throw new Error('조회 차수는 연도를 포함한 YYYY-WW-SS 형식으로 입력하세요.');
const ORDER_YEAR = MATCH[1];
const WEEK = MATCH[2];

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER, password: PASS }),
  }).then((r) => r.json());
  if (!login.token) throw new Error('login failed');
  const h = { Authorization: `Bearer ${login.token}`, Accept: 'application/json' };
  const audit = await fetch(`${BASE}/api/dev/fix-parity-audit?orderYear=${encodeURIComponent(ORDER_YEAR)}&week=${encodeURIComponent(`${ORDER_YEAR}-${WEEK}`)}`, { headers: h }).then((r) => r.json());
  const fullWeek = `${ORDER_YEAR}-${WEEK}`;
  const fix = await fetch(`${BASE}/api/shipment/fix-status?orderYear=${encodeURIComponent(ORDER_YEAR)}&fromWeek=${encodeURIComponent(fullWeek)}&toWeek=${encodeURIComponent(fullWeek)}`, { headers: h }).then((r) => r.json());
  console.log(`\n=== fix-parity-audit ${WEEK} ===\n`);
  console.log(JSON.stringify(audit, null, 2));
  console.log(`\n=== fix-status ${WEEK} ===\n`);
  console.log(JSON.stringify(fix.weeks?.[0], null, 2));
  if (audit.risks?.length) {
    console.log('\n=== 위험 요약 ===');
    audit.risks.forEach((r) => console.log(' •', r));
  }
  process.exit(audit.success ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
