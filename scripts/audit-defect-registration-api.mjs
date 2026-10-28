// Read-only registration audit: never invokes register/save/delete.
// Credentials and raw ledger payloads are never written or printed.
const [year, week] = process.argv.slice(2).map(Number);
if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) throw new Error('Usage: node scripts/audit-defect-registration-api.mjs YEAR WEEK');
const base = process.env.NENOVAWEB_URL;
const token = process.env.NENOVAWEB_TOKEN;
if (!base || !token) throw new Error('Authenticated ERP environment required');
async function request(params, body) {
  const url = new URL('/api/sales/defect-deductions', base);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`ERP audit HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw new Error('ERP audit response failed');
  return result;
}
const data = await request({ year, week, view: 'support' });
const rows = data.rows.filter(row => row.autoSourceExcluded || /^kakao-defect:/i.test(String(row.sourceFileName || '').trim()));
const customers = new Map();
const mismatches = [];
const errors = {};
let passed = 0;
for (let start = 0; start < rows.length; start += 10) {
  const batch = rows.slice(start, start + 10);
  const check = await request({}, { action: 'preflight', year, week, rows: batch });
  const eligible = batch.filter(row => row.registrationEligible === true);
  const preview = eligible.length ? await request({ year, week, view: 'registration-preview', ids: eligible.map(row => row.deductionKey).join(',') }) : { rows: [] };
  for (const row of batch) {
    const group = customers.get(row.custKey) || { custKey: row.custKey, rows: 0, eligible: 0, blocked: 0 };
    group.rows++;
    const pf = check.rows.find(item => Number(item.deductionKey) === Number(row.deductionKey));
    if (!pf) throw new Error('Missing preflight row');
    if (row.registrationEligible) {
      group.eligible++;
      const pv = preview.rows.find(item => Number(item.deductionKey) === Number(row.deductionKey));
      if (pf.error || !pv || pv.error || !(pv.after?.ShipmentKey > 0) || !(pv.after?.Cost > 0)
          || Number(pf.shipmentKey) !== Number(pv.after?.ShipmentKey) || Number(pf.cost) !== Number(pv.after?.Cost)) {
        mismatches.push({ key: row.deductionKey, custKey: row.custKey, code: pf.errorCode || 'ELIGIBILITY_PARITY', error: pf.error || pv?.error || 'preview/context mismatch' });
      } else passed++;
    } else {
      group.blocked++;
      const code = row.registrationEligibilityCode || 'UNKNOWN';
      errors[code] = (errors[code] || 0) + 1;
      if (code === 'AUTO_SOURCE_REVIEW_REQUIRED') mismatches.push({ key: row.deductionKey, custKey: row.custKey, code });
      // Completed rows intentionally fail list eligibility but preflight may allow an idempotent update.
      if (!pf.error && !['ALREADY_REGISTERED', 'MANUAL_COMPLETED'].includes(code)) mismatches.push({ key: row.deductionKey, custKey: row.custKey, code: 'BLOCKED_LIST_PASSES_PREFLIGHT' });
    }
    customers.set(row.custKey, group);
  }
  console.log(JSON.stringify({ checked: Math.min(start + 10, rows.length), total: rows.length, passed, mismatches: mismatches.length }));
}
console.log(JSON.stringify({ year, week, supportRows: data.rows.length, automaticRows: rows.length, customers: [...customers.values()], passed, errors, mismatches }, null, 2));
if (mismatches.length) process.exitCode = 1;
