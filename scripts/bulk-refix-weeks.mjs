#!/usr/bin/env node
/**
 * 낮은 차수부터 전체(전 카테고리) 재확정
 * Usage: node scripts/bulk-refix-weeks.mjs --from 20-01 --to 25-01 [--apply]
 */
const BASE = process.env.NENOWA_BASE || 'https://nenovaweb.com';
const APPLY = process.argv.includes('--apply');
const fromWeek = process.argv[process.argv.indexOf('--from') + 1] || '20-01';
const toWeek = process.argv[process.argv.indexOf('--to') + 1] || '25-01';
const TIMEOUT_MS = 45 * 60 * 1000;

const WEEK_ORDER = [
  '20-01', '20-02', '21-01', '21-02', '22-01', '22-02',
  '23-01', '23-02', '24-01', '24-02', '25-01', '25-02', '25-03', '25-04',
];

function weeksInRange(from, to) {
  const a = WEEK_ORDER.indexOf(from);
  const b = WEEK_ORDER.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`Invalid range ${from} ~ ${to}`);
  return WEEK_ORDER.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function sortAsc(wks) {
  return [...wks].sort((x, y) => WEEK_ORDER.indexOf(x) - WEEK_ORDER.indexOf(y));
}

function sortDesc(wks) {
  return [...wks].sort((x, y) => WEEK_ORDER.indexOf(y) - WEEK_ORDER.indexOf(x));
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'nenovaSS3', password: '0000' }),
  });
  const d = await r.json();
  if (!d.token) throw new Error('login failed');
  return d.token;
}

async function fixAction(token, week, action) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/shipment/fix`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ week, action, force: true }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function auditWeek(token, week) {
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const [parity, status] = await Promise.all([
    fetch(`${BASE}/api/dev/fix-parity-audit?week=${encodeURIComponent(week)}`, { headers: h }).then((r) => r.json()),
    fetch(`${BASE}/api/shipment/fix-status?fromWeek=${week}&toWeek=${week}`, { headers: h }).then((r) => r.json()),
  ]);
  const row = (status.weeks || [])[0] || {};
  return {
    week,
    ok: parity.exeAligned === true,
    webFixStatus: parity.webFixStatus,
    exeAligned: parity.exeAligned,
    stockFixStatus: row.stockFixStatus,
    risks: parity.risks || [],
  };
}

async function main() {
  const targetWeeks = weeksInRange(fromWeek, toWeek);
  const toIdx = WEEK_ORDER.indexOf(toWeek);
  const extraHigher = WEEK_ORDER.slice(toIdx + 1).filter((w) => w <= '25-02');
  const unfixWeeks = sortDesc([...new Set([...extraHigher, ...targetWeeks])]);
  const fixWeeks = sortAsc([...targetWeeks, ...extraHigher]);

  console.log('Mode:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('Target fix range:', fromWeek, '~', toWeek);
  console.log('Unfix order (high→low):', unfixWeeks.join(', '));
  console.log('Fix order (low→high):', fixWeeks.join(', '));

  if (!APPLY) {
    console.log('\nAdd --apply to execute.');
    return;
  }

  const token = await login();
  const errors = [];

  console.log('\n=== PHASE 1: UNFIX (high → low) ===');
  for (const week of unfixWeeks) {
    const t0 = Date.now();
    console.log(`\n[unfix] ${week} ...`);
    try {
      const { status, data } = await fixAction(token, week, 'unfix');
      const sec = ((Date.now() - t0) / 1000).toFixed(0);
      if (!data.success && status !== 200) {
        console.log(`  FAIL (${sec}s) status=${status}`, data.error || data.message);
        errors.push({ week, action: 'unfix', error: data.error || data.message });
      } else {
        console.log(`  OK (${sec}s)`, data.message || '');
        if (data.parity) console.log(`  parity: ${data.parity.status} exeAligned=${data.parity.exeAligned}`);
      }
    } catch (e) {
      console.log(`  ERROR ${e.message}`);
      errors.push({ week, action: 'unfix', error: e.message });
    }
  }

  console.log('\n=== PHASE 2: FIX (low → high) ===');
  for (const week of fixWeeks) {
    const t0 = Date.now();
    console.log(`\n[fix] ${week} ...`);
    try {
      const { status, data } = await fixAction(token, week, 'fix');
      const sec = ((Date.now() - t0) / 1000).toFixed(0);
      if (!data.success) {
        console.log(`  FAIL (${sec}s) status=${status}`, data.error || data.message);
        errors.push({ week, action: 'fix', error: data.error || data.message });
        if (data.code === 'LOWER_UNFIXED_EXISTS') {
          console.log('  Stopping — lower week unfixed. Fix lower weeks first.');
          break;
        }
      } else {
        console.log(`  OK (${sec}s)`, data.message || '');
        if (data.parity) console.log(`  parity: ${data.parity.status} exeAligned=${data.parity.exeAligned}`);
      }
    } catch (e) {
      console.log(`  ERROR ${e.message}`);
      errors.push({ week, action: 'fix', error: e.message });
    }
  }

  console.log('\n=== PHASE 3: AUDIT ===');
  for (const week of fixWeeks) {
    try {
      const a = await auditWeek(token, week);
      console.log(`${week}: exeAligned=${a.ok} status=${a.webFixStatus} stock=${a.stockFixStatus}${a.risks.length ? ' risks=' + a.risks.length : ''}`);
    } catch (e) {
      console.log(`${week}: audit error ${e.message}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('errors:', errors.length);
  errors.forEach((e) => console.log(`  ${e.action} ${e.week}: ${e.error}`));
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
