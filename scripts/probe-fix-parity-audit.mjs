/**
 * exe vs web 확정 불일치 진단
 * node scripts/probe-fix-parity-audit.mjs 25-01
 */
const BASE = process.env.SMOKE_BASE_URL || 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';
const WEEK = process.argv[2] || '25-01';

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER, password: PASS }),
  }).then((r) => r.json());
  if (!login.token) throw new Error('login failed');
  const h = { Authorization: `Bearer ${login.token}`, Accept: 'application/json' };
  const audit = await fetch(`${BASE}/api/dev/fix-parity-audit?week=${encodeURIComponent(WEEK)}`, { headers: h }).then((r) => r.json());
  const fix = await fetch(`${BASE}/api/shipment/fix-status?fromWeek=${encodeURIComponent(WEEK)}&toWeek=${encodeURIComponent(WEEK)}`, { headers: h }).then((r) => r.json());
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
