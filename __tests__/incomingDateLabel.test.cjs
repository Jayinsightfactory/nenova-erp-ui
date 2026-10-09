const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const { incomingDateLabel } = await import('../lib/incomingDateLabel.js');
  for (const [input, expected] of [
    ['2026-10-08T00:00:00.000Z', '2026-10-08'],
    ['2025-12-31T23:59:59-12:00', '2025-12-31'],
    ['2026-01-01T00:00:00+14:00', '2026-01-01'],
    ['2025-12-31', '2025-12-31'], ['2024-02-29 00:00:00', '2024-02-29'],
    [null, '—'], [undefined, '—'], ['', '—'], ['확인 필요', '확인 필요'],
    ['2025-02-29T00:00:00Z', '2025-02-29T00:00:00Z'],
    ['2026-13-01', '2026-13-01'], ['2026-01-00', '2026-01-00'],
    ['2026-10-08garbage', '2026-10-08garbage'],
  ]) assert.equal(incomingDateLabel(input), expected);
  const page = fs.readFileSync('pages/incoming.js', 'utf8');
  assert.match(page, /입력일자:m\.InputDate/, 'export retains original ERP value');
  assert.ok(page.includes("String(a.InputDate || '').localeCompare(String(b.InputDate || ''))"), 'sorting retains original values');
  assert.match(page, /whiteSpace: 'nowrap'.*incomingDateLabel\(value\)/, 'only display uses a one-line label');
  console.log('incoming date labels: cross-year/offset preservation, missing/invalid fallback, raw export/sort retained');
})().catch(error => { console.error(error); process.exitCode = 1; });
