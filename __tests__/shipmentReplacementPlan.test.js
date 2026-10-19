import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReplacementPlan, assertReplacementPlan, assertReplacementRows, assertReplacementCoverage } from '../lib/shipmentReplacementPlan.js';

const options = { secret: 'isolated-test-secret-not-a-live-key', now: 10000000 };
const rows = [{ custKey: 1, prodKey: 389, uploadQty: 10, currentOutQty: 8 },
  ...[389, 390, 391, 392, 393, 394].map((prodKey, i) => ({ custKey: 686, prodKey,
    uploadQty: 0, currentOutQty: [5, 2, 3, 1, 1, 2][i], missingFromExcel: true }))];
const preview = { success: true, orderYear: '2026', week: '36-01', rows, unmatched: [],
  earlyImport: { mode: 'ALREADY_EXCLUDED', fingerprint: 'isolated-ledger', scope: { year: '2026' } } };
function body() {
  return { year: preview.orderYear, week: preview.week, rows: structuredClone(rows), fullCategoryReplacement: true,
    earlyImportMode: preview.earlyImport.mode, earlyLedgerFingerprint: preview.earlyImport.fingerprint,
    earlyImportScope: preview.earlyImport.scope, replacementPlan: createReplacementPlan(preview, 'tester', options) };
}
test('complete preview including six orderless cancellations survives JSON roundtrip', () => {
  assert.doesNotThrow(() => assertReplacementPlan(JSON.parse(JSON.stringify(body())), 'tester', options));
  const request = body(); request.rows[0] = Object.fromEntries(Object.entries(request.rows[0]).reverse());
  assert.doesNotThrow(() => assertReplacementPlan(request, 'tester', options));
});
for (const [name, mutate] of [
  ['missing customer column', b => b.rows.splice(1)],
  ['missing product row', b => b.rows.splice(3, 1)],
  ['quantity changed', b => b.rows[1].uploadQty = 5],
  ['other year', b => b.year = '2025'],
  ['other subweek', b => b.week = '36-02'],
  ['category check disabled', b => b.fullCategoryReplacement = false],
  ['category flag omitted', b => delete b.fullCategoryReplacement],
  ['early scope shrunk', b => b.earlyImportScope = {}],
  ['unsigned request', b => delete b.replacementPlan],
]) test(`reject ${name} before writes`, () => {
  const request = body(); mutate(request);
  assert.throws(() => assertReplacementPlan(request, 'tester', options), { code: 'SHIPMENT_REPLACEMENT_REVERIFY' });
});
test('unmatched even zero quantity and fixed previews cannot authorize writes', () => {
  assert.equal(createReplacementPlan({ ...preview, unmatched: [{ uploadQty: 0 }] }, 'tester', options), null);
  assert.equal(createReplacementPlan({ ...preview, rows: [{ ...rows[0], fixBlocked: true }] }, 'tester', options), null);
});
test('reject expiry, changed actor, forged token and invalid rows', () => {
  assert.throws(() => assertReplacementPlan(body(), 'other', options));
  assert.throws(() => assertReplacementPlan(body(), 'tester', { ...options, now: options.now + 1800001 }));
  const forged = body(); forged.replacementPlan += '0';
  assert.throws(() => assertReplacementPlan(forged, 'tester', options));
  for (const bad of [[], [rows[0], rows[0]], [{ ...rows[0], uploadQty: NaN }], [{ ...rows[0], uploadQty: -1 }]])
    assert.throws(() => assertReplacementRows(bad));
});
test('raw-ledger preflight and locked recheck include shipments with no order and dates-only residue', async () => {
  const ledger = rows.map(r => ({ year: '2026', week: '36-01', category: 'carnation', CustKey: r.custKey, ProdKey: r.prodKey }));
  ledger.push({ year: '2025', week: '36-01', category: 'carnation', CustKey: 900, ProdKey: 389 });
  ledger.push({ year: '2026', week: '36-02', category: 'carnation', CustKey: 901, ProdKey: 389 });
  ledger.push({ year: '2026', week: '36-01', category: 'rose', CustKey: 902, ProdKey: 999 });
  const before = JSON.stringify(ledger);
  for (const lock of [false, true]) {
    const query = async (text, params) => {
      assert.doesNotMatch(text, /\b(?:UPDATE\s|INSERT\s|DELETE\s|EXEC\s|ViewOrder|OrderDetail)\b/i);
      assert.match(text, /sm.OrderYear=@replacementYear AND sm.OrderWeek=@replacementWeek/);
      assert.match(text, /ShipmentDate/);
      assert.equal(text.includes('WITH (UPDLOCK, HOLDLOCK)'), lock);
      return { recordset: ledger.filter(r => r.year === params.replacementYear.value && r.week === params.replacementWeek.value && r.category === 'carnation') };
    };
    await assertReplacementCoverage(query, rows, '2026', '36-01', { NVarChar: 'text' }, lock);
    await assert.rejects(assertReplacementCoverage(query, rows.slice(0, 1), '2026', '36-01', { NVarChar: 'text' }, lock), /6건/);
  }
  assert.equal(JSON.stringify(ledger), before);
});
test('production route enforces plan before apply; transaction checks coverage before mutations and never skips fixed', () => {
  const api = readFileSync(new URL('../pages/api/shipment/distribute-import-apply.js', import.meta.url), 'utf8');
  const core = readFileSync(new URL('../lib/shipmentImport.js', import.meta.url), 'utf8');
  assert(api.indexOf('assertReplacementPlan(req.body') < api.indexOf('await applyImportRows('));
  assert.match(api, /fullCategoryReplacement: true/);
  assert.match(core, /withTransaction\(async \(tQ\) => \{\s*if \(fullCategoryReplacement\) await assertReplacementCoverage/);
  assert.match(core, /if \(fixCheck.fixBlocked\) \{\s*if \(fullCategoryReplacement\) throw/);
});
