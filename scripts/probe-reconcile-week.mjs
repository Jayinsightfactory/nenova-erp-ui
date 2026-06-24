#!/usr/bin/env node
/**
 * 차수 재고 정합 복구 — node scripts/probe-reconcile-week.mjs 25-01 [--apply]
 */
const BASE = process.env.NENOWA_BASE || 'https://nenovaweb.com';
const week = process.argv.find((a) => /^\d{2}-\d{2}$/.test(a));
const APPLY = process.argv.includes('--apply');

if (!week) {
  console.error('Usage: node scripts/probe-reconcile-week.mjs 25-01 [--apply]');
  process.exit(1);
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'nenovaSS3', password: '0000' }),
  }).then((r) => r.json());
  const h = { Authorization: `Bearer ${login.token}`, Accept: 'application/json' };

  const auditBefore = await fetch(`${BASE}/api/dev/fix-parity-audit?week=${encodeURIComponent(week)}`, { headers: h }).then((r) => r.json());
  console.log('=== BEFORE ===');
  console.log('webFixStatus:', auditBefore.webFixStatus, 'exeAligned:', auditBefore.exeAligned);
  console.log('risks:', auditBefore.risks?.join(' | ') || '-');

  if (!APPLY) {
    console.log('\nDry-run. Add --apply to POST /api/shipment/fix-reconcile');
    return;
  }

  const res = await fetch(`${BASE}/api/shipment/fix-reconcile`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ week, forceFullWeekRecalc: true }),
  });
  const data = await res.json();
  console.log('\n=== RECONCILE ===');
  console.log(JSON.stringify(data, null, 2));

  const auditAfter = await fetch(`${BASE}/api/dev/fix-parity-audit?week=${encodeURIComponent(week)}`, { headers: h }).then((r) => r.json());
  console.log('\n=== AFTER ===');
  console.log('webFixStatus:', auditAfter.webFixStatus, 'exeAligned:', auditAfter.exeAligned);
  console.log('risks:', auditAfter.risks?.join(' | ') || '-');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
