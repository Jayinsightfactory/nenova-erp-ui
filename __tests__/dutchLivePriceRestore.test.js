import assert from 'node:assert/strict';
import { buildDutchPriceCarry, readDutchPriceCarry, restoreDutchLivePrices, writeDutchPriceCarry } from '../lib/dutchLivePriceRestore.js';
import { createDutchBulkPriceConfig, dutchPriceKey } from '../lib/dutchVolumePrice.js';
import { buildDutchPreviewEntries } from '../lib/dutchVolumeDraft.js';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeDutchBulkPriceConfig } from '../lib/dutchVolumePrice.js';

const a = { id: 'D5', customer: '업체A\nCL1', product: '장미', color: '빨강', sourceCustKey: 1, quantity: 3 };
const b = { ...a, id: 'E5', customer: '업체B\nCL2', sourceCustKey: 2 };
const c = { ...a, id: 'F5', customer: '업체C\nCL3', sourceCustKey: 3 };
const entries = [a, b, c], config = createDutchBulkPriceConfig(entries);
const matches = rows => rows.map(entry => ({ id: entry.id, custKey: entry.sourceCustKey, prodKey: 10, status: 'matched' }));
const preview = (rows, costs) => ({ entryMatches: matches(rows), rows: rows.map((entry, i) => ({ entryIds: [entry.id], currentCost: costs[i] ?? null })) });
const restore = (extra = {}) => restoreDutchLivePrices({ year: 2026, week: '44-02', entries, preview: preview(entries, [15000, 0, null]), bulkPriceConfig: config, ...extra });
const price = (result, entry) => result.prices[dutchPriceKey(entry, result.bulkPriceConfig)];
let result = restore();
assert.equal(price(result, a), 15000);
assert.equal(price(result, b), 0, 'explicit saved zero survives');
assert.equal(price(result, c), undefined, 'uniform key must not spread a price into a new customer');
assert.equal(result.individualized, true);
assert.equal(buildDutchPreviewEntries(entries, result.prices, e => dutchPriceKey(e, result.bulkPriceConfig))[1].unitPrice, 0);

const makeCarry = (r, rows = entries, extra = {}) => buildDutchPriceCarry({ year: 2026, week: '44-02', entries: rows, prices: r.prices, bulkPriceConfig: r.bulkPriceConfig, baseline: r.baseline, matches: Object.fromEntries(matches(rows).map(m => [m.id, m])), ...extra });
assert.equal(makeCarry(result).records.length, 0, 'automatic DB hydration is not an edit');
const latest = restore({ carry: makeCarry(result), preview: preview(entries, [17000, 0, null]) });
assert.equal(price(latest, a), 17000, 'a newer DB cost wins over the prior displayed DB cost');
result.prices[dutchPriceKey(a, result.bulkPriceConfig)] = '18000';
const carry = makeCarry(result);
assert.equal(carry.records.length, 1);
const moved = { ...a, id: 'G12', quantity: 99 };
const reloaded = restore({ entries: [moved, b, c], preview: preview([moved, b, c], [17000, 0, null]), carry });
assert.equal(price(reloaded, moved), '18000', 'pending edit survives workbook address and quantity changes');
assert.equal(moved.quantity, 99, 'carry never restores old quantity');
assert.equal(price(restore({ carry, year: 2025 }), a), 15000, 'same week/pair in another year is isolated');
assert.equal(price(restore({ carry, week: '45-01' }), a), 15000, 'another week is isolated');
const otherProduct = preview(entries, [15000, 0, null]); otherProduct.entryMatches[0].prodKey = 11;
assert.equal(price(restore({ carry, preview: otherProduct }), a), 15000, 'same cell with another resolved product is isolated');
const otherCustomer = preview(entries, [15000, 0, null]);
const changedCustomer = { ...a, sourceCustKey: 4 };
otherCustomer.entryMatches[0].custKey = 4;
assert.equal(price(restore({ entries: [changedCustomer, b, c], carry, preview: otherCustomer }), changedCustomer), 15000);

const sourceCarry = makeCarry(result, entries, { matches: {} });
assert.equal(price(restore({ carry: sourceCarry }), a), '18000', 'unresolved uploads may use the exact source identity');
assert.equal(price(restore({ carry: sourceCarry, entries: [{ ...a, product: '튤립' }, b, c] }), { ...a, product: '튤립' }), 15000, 'source-only carry cannot follow reused addresses');
const blank = { ...carry, records: [{ ...carry.records[0], price: '' }] };
assert.equal(price(restore({ carry: blank }), a), '', 'blank preserve intent is distinct from zero');
assert.equal(price(restore({ carry: { ...carry, records: [{ ...carry.records[0], price: 0 }] } }), a), 0);
const conflict = restore({ carry: { ...carry, records: [...carry.records, { ...carry.records[0], price: 19000 }] } });
assert.equal(price(conflict, a), 15000, 'ambiguous pending prices must not arbitrarily replace DB');
assert.equal(conflict.conflictCount, 1);
assert.equal(price(restore({ carry: { ...carry, records: [null, { ...carry.records[0], price: -1 }] } }), a), 15000);
const uniform = restore({ preview: preview(entries, [15000, 15000, 15000]) });
assert.equal(uniform.individualized, false);
assert.equal(Object.keys(uniform.prices).length, 1);

const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
assert.equal(writeDutchPriceCarry(storage, carry), true);
assert.deepEqual(readDutchPriceCarry(storage, 2026, '44-02'), carry);
assert.equal(readDutchPriceCarry(storage, 2025, '44-02'), null);
assert.equal(readDutchPriceCarry({ getItem: () => '{bad' }, 2026, '44-02'), null);
assert.equal(writeDutchPriceCarry({ setItem() { throw Error('quota'); } }, carry), false);

// Execute the real page's load acceptance flow: both previews are read-only,
// and the final plan must use the restored prices, not the initial empty input.
const page = fs.readFileSync(new URL('../pages/stats/dutch-volume-board.js', import.meta.url), 'utf8');
const source = page.slice(page.indexOf('  async function acceptSource('), page.indexOf('  async function loadLive('));
for (const scenario of ['LIVE', 'UPLOAD', 'failed', 'stale']) {
  const mode = scenario === 'UPLOAD' ? 'UPLOAD' : 'LIVE';
  const calls = [], state = {};
  const context = {
    priceBaselineRef: { current: {} }, yearRef: { current: 2026 }, weekRef: { current: '44-02' }, sourceRef: {}, sourceBaseRef: {}, sourceModeRef: {},
    dutchSourceIdentity: () => 'fixture-source', localStorage: { getItem: () => null }, BULK_PRICE_CONFIG_KEY: 'fixture',
    readDutchDraft: () => ({ entries, prices: {}, dayEdits: {} }), migrateDutchPriceDraft() {},
    normalizeDutchBulkPriceConfig, migrateDutchBulkPriceConfig: (_e, prices) => ({ prices }),
    applyDutchWeekdayEdits: (_x, workbook) => workbook, XLSXStyled: {}, invalidate() {},
    buildDutchPriceCarry, restoreDutchLivePrices,
    runPreview: async (_entries, prices, year, week, _identity, _name, bulkPriceConfig) => {
      if (scenario === 'failed') return undefined;
      if (scenario === 'stale') context.yearRef.current = 2025;
      calls.push({ prices, year, week, bulkPriceConfig }); return preview(entries, [15000, 0, null]);
    },
  };
  for (const name of new Set(source.match(/\bset[A-Z]\w+/g))) context[name] = value => { state[name] = value; };
  await vm.runInNewContext(`${source}; acceptSource({}, 'fixture.xlsx', 'live:2026:44-02', [], '${mode}', {livePriceCarry: ${JSON.stringify(carry)}})`, context);
  assert.equal(calls.length, scenario === 'failed' ? 0 : scenario === 'LIVE' ? 2 : 1);
  if (scenario === 'failed' || scenario === 'stale') {
    assert.equal(context.priceBaselineRef.current, null, 'failed/stale matching cannot replace the pending-edit cache');
    assert.deepEqual(state.setPrices, {});
  }
  if (scenario === 'LIVE') {
    assert.equal(calls[1].prices[dutchPriceKey(a, calls[1].bulkPriceConfig)], '18000');
    assert.equal(calls[1].prices[dutchPriceKey(b, calls[1].bulkPriceConfig)], 0);
    assert.equal(context.priceBaselineRef.current[a.id], 15000);
    assert.ok(calls.every(call => call.year === 2026 && call.week === '44-02'));
  }
}
console.log('Dutch live price restore: saved/zero/blank prices, pending edits, current DB priority, cross-year/pair isolation and storage passed');
