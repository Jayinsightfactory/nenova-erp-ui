import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ADDITIONAL_INVOICE_COST_FORMULAS as profiles, additionalInvoiceCostPreview as calculate } from '../lib/invoiceReceiptAdditionalCost.js';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(country = 'US') {
  const formula = profiles[country === 'US' ? 'US_CNF_BOX_V1' : 'VN_CNF_STEM_V1'];
  return { document: { reviewedMetadata: { country, transportMode: 'AIR' } },
    rows: [{ lineId: id, prodKey: 1, actualQuantity: 70, unit: 'BOX', unitPrice: 67.45, lineAmount: 4721.5, currency: 'USD' }],
    input: { formulaId: formula.formulaId, freightAmount: 0, customsTotalKRW: 474540,
      lineInputs: [{ lineId: id, tariffRate: 0 }] },
    common: { formula, nativeCurrency: 'USD', freightCurrency: 'USD', exchangeRate: 1400, effectiveFreightAmount: 0, share: 1 } };
}
const run = f => { const issues = []; const result = calculate(f.document, f.rows, f.input, f.common, issues); return { ...result, issues }; };
function blocked(f, code) { const result = run(f); assert.deepEqual(result.lines, []); assert.ok(result.issues.some(issue => issue.code === code), JSON.stringify(result.issues)); }

test('malformed input collections and array numbers fail as review issues', () => {
  const f = fixture(); f.input.lineInputs = {};
  blocked(f, 'LINE_INPUTS_REQUIRED');
  const g = fixture(); g.input.customsTotalKRW = [0];
  blocked(g, 'CUSTOMS_TOTAL_REQUIRED');
});

test('US 40-1 primary ledger: box CNF, box customs and explicit zero tariff', () => {
  const result = run(fixture()); assert.deepEqual(result.issues, []);
  assert.equal(result.lines[0].totalCostKRW, 7084640);
  assert.equal(result.lines[0].costPerUnitKRW, 101209.142857);
  assert.equal(result.lines[0].componentAmounts.cnfNative, 4721.5);
  assert.equal(result.lines[0].componentAmounts.freightIncluded, true);
  assert.equal(result.expected95, null);
});
test('US BUNCH and STEM conversions preserve total and match primary source L13', () => {
  const f = fixture(); f.rows[0].unit = 'BUNCH'; f.rows[0].actualQuantity = 1750;
  f.input.lineInputs[0].bunchesPerBox = 25;
  assert.equal(run(f).lines[0].costPerUnitKRW, 4048.365714);
  f.rows[0].unit = 'STEM'; f.rows[0].actualQuantity = 43750; f.input.lineInputs[0].stemsPerBunch = 25;
  assert.equal(run(f).lines[0].totalCostKRW, 7084640);
});
test('VN 24-1 active rows: CNF STEM includes freight; customs quantity allocation', () => {
  const f = fixture('VN'); f.common.exchangeRate = 1550; f.input.customsTotalKRW = 392000;
  f.rows = [ [720, 6.75], [560, 6.75], [64, 8.75] ].map(([qty, price], i) => ({
    lineId: `${i + 1}`, prodKey: i + 1, actualQuantity: qty, unit: 'STEM', unitPrice: price, lineAmount: qty * price, currency: 'USD' }));
  f.input.lineInputs = f.rows.map(row => ({ lineId: row.lineId, tariffRate: 0.05 }));
  const result = run(f); assert.deepEqual(result.issues, []);
  assert.equal(result.lines[0].costPerUnitKRW, 11277.291667);
  assert.equal(result.lines[2].costPerUnitKRW, 14532.291667);
  assert.ok(Math.abs(result.lines.reduce((s, row) => s + row.componentAmounts.customsKRW, 0) - 392000) < 0.000001);
  assert.equal(Math.round(result.lines.reduce((s, row) => s + row.totalCostKRW, 0)), 15365000);
});
test('VN BUNCH and BOX use explicit STEM conversion without changing invoice price', () => {
  const f = fixture('VN'); Object.assign(f.rows[0], { actualQuantity: 2, unit: 'BUNCH', unitPrice: 5, lineAmount: 100 });
  f.input.lineInputs[0].stemsPerBunch = 10;
  assert.equal(run(f).lines[0].componentAmounts.cnfNative, 100);
  f.rows[0].unit = 'BOX'; f.rows[0].actualQuantity = 1; f.input.lineInputs[0].bunchesPerBox = 2;
  assert.equal(run(f).lines[0].componentAmounts.cnfNative, 100);
});
for (const country of ['US', 'VN']) {
  for (const [label, mutate, code] of [
    ['country', f => { f.document.reviewedMetadata.country = 'CN'; }, 'FORMULA_COUNTRY_MISMATCH'],
    ['sea', f => { f.document.reviewedMetadata.transportMode = 'SEA'; }, 'FORMULA_TRANSPORT_MISMATCH'],
    ['missing transport', f => { delete f.document.reviewedMetadata.transportMode; }, 'FORMULA_TRANSPORT_MISMATCH'],
    ['native currency', f => { f.common.nativeCurrency = 'EUR'; }, 'FORMULA_CURRENCY_MISMATCH'],
    ['line currency', f => { f.rows[0].currency = 'CNY'; }, 'LINE_CURRENCY_MISMATCH'],
    ['freight double count', f => { f.input.freightAmount = 1; }, 'CNF_FREIGHT_DOUBLE_COUNT'],
    ['missing freight', f => { delete f.input.freightAmount; }, 'CNF_FREIGHT_DOUBLE_COUNT'],
    ['AWB share', f => { f.common.share = 0.5; }, 'CNF_ALLOCATION_SCOPE_REQUIRED'],
    ['missing customs', f => { delete f.input.customsTotalKRW; }, 'CUSTOMS_TOTAL_REQUIRED'],
    ['boolean customs', f => { f.input.customsTotalKRW = false; }, 'CUSTOMS_TOTAL_REQUIRED'],
    ['missing tariff', f => { delete f.input.lineInputs[0].tariffRate; }, 'TARIFF_RATE_REQUIRED'],
    ['unknown unit', f => { f.rows[0].unit = 'KG'; }, 'UNIT_CONVERSION_REQUIRED'],
    ['missing conversion', f => { f.rows[0].unit = 'BUNCH'; }, 'UNIT_CONVERSION_REQUIRED'],
    ['amount drift', f => { f.rows[0].lineAmount += 1; }, 'CNF_AMOUNT_MISMATCH'],
    ['unsupported extra cost', f => { f.input.lineInputs[0].otherCostPerUnitKRW = 100; }, 'ADDITIONAL_COST_UNSUPPORTED'],
  ]) test(`${country} rejects ${label}`, () => { const f = fixture(country);
    if (country === 'VN') Object.assign(f.rows[0], { unit: 'STEM' });
    mutate(f); blocked(f, code); });
}
test('zero fees/rates stay zero; cancelled row gets no customs', () => {
  const f = fixture(); f.input.customsTotalKRW = 0;
  f.rows.push({ ...f.rows[0], lineId: 'zero', actualQuantity: 0, lineAmount: 0 });
  f.input.lineInputs.push({ lineId: 'zero', tariffRate: 0 });
  const result = run(f); assert.deepEqual(result.issues, []);
  assert.equal(result.lines[0].totalCostKRW, 6610100);
  assert.equal(result.lines[1].totalCostKRW, 0); assert.equal(result.lines[1].costPerUnitKRW, null);
});
test('aliases, no input mutation, duplicate and out-of-scope inputs', () => {
  const f = fixture(); f.document.reviewedMetadata.country = '미국';
  const before = JSON.stringify(f); assert.equal(run(f).issues.length, 0); assert.equal(JSON.stringify(f), before);
  f.input.lineInputs.push({ ...f.input.lineInputs[0] }); blocked(f, 'LINE_INPUT_DUPLICATE');
  f.input.lineInputs.pop(); f.input.lineInputs.push({ lineId: 'foreign', tariffRate: 0 }); blocked(f, 'LINE_INPUT_OUT_OF_SCOPE');
});
test('UI unused extra-cost blanks/null/omission/zero are accepted; invalid/nonzero rejected', () => {
  for (const value of ['', '  ', null, undefined, 0, '0']) {
    const f = fixture(); f.input.lineInputs[0].otherCostPerUnitKRW = value;
    assert.deepEqual(run(f).issues, []);
  }
  for (const value of ['invalid', false, true, NaN, Infinity, -1, 1]) {
    const f = fixture(); f.input.lineInputs[0].otherCostPerUnitKRW = value;
    blocked(f, 'ADDITIONAL_COST_UNSUPPORTED');
  }
});
test('cancelled rows retain zero components/null cost without tariff or conversion inputs', () => {
  for (const country of ['US', 'VN']) {
    const f = fixture(country);
    if (country === 'VN') f.rows[0].unit = 'STEM';
    f.rows.push({ ...f.rows[0], lineId: 'cancelled', unit: 'BUNCH', actualQuantity: 0, lineAmount: 0 });
    const result = run(f); assert.deepEqual(result.issues, []);
    const cancelled = result.lines[1];
    assert.equal(cancelled.quantity, 0); assert.equal(cancelled.costPerUnitKRW, null);
    assert.equal(cancelled.totalCostKRW, 0);
    assert.equal(cancelled.componentAmounts.cancellation, true);
    for (const value of Object.values(cancelled.componentAmounts))
      if (typeof value === 'number') assert.equal(value, 0);
    assert.equal(result.lines[0].componentAmounts.customsKRW, f.input.customsTotalKRW);
    f.rows[1].lineAmount = 1; blocked(f, 'CANCELLED_LINE_AMOUNT_INVALID');
  }
});
test('prepared source files match profile hashes and primary ledger formulas', () => {
  const base = new URL('../outputs/drive-pair-discovery/', import.meta.url);
  const downloads = JSON.parse(readFileSync(new URL('downloaded-costs.json', base)));
  const evidence = JSON.parse(readFileSync(new URL('cost-cell-evidence.json', base)));
  for (const profile of Object.values(profiles)) {
    const source = downloads.find(row => row.country === profile.country);
    assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'), profile.formulaSourceHash);
    const sheet = evidence.find(row => row.country === profile.country).sheets.find(sheet => sheet.name === profile.formulaSourceSheet);
    const cells = new Map(sheet.cells.flat().map(cell => [cell.cell, cell.raw]));
    const ledger = { US: ['I13', '=$M$9/$C$9'], VN: ['J19', '=$N$9/$D$9'],
      AU: ['J13', '=$N$9/$D$9'], NZ: ['J13', '=$N$9/$C$9'], EC: ['G14', '=E14/$C$10'] }[profile.country];
    assert.equal(cells.get(ledger[0]), ledger[1]);
  }
});

function addedFixture(country) {
  const f = fixture();
  const formula = Object.values(profiles).find(profile => profile.country === country);
  f.document.reviewedMetadata.country = country; f.common.formula = formula; f.input.formulaId = formula.formulaId;
  f.common.nativeCurrency = 'EUR'; f.common.freightCurrency = 'EUR'; f.rows[0].currency = 'EUR';
  f.rows[0].unit = formula.priceBasis;
  return f;
}
test('AU source numeric fixture, mixed current tariffs and BUNCH conversions', () => {
  const f = addedFixture('AU'); f.common.exchangeRate = 1090; f.input.customsTotalKRW = 285130;
  Object.assign(f.rows[0], { actualQuantity: 1035, unitPrice: 14.5, lineAmount: 15007.5 });
  assert.equal(run(f).lines[0].costPerUnitKRW, 16080.487923);
  f.rows[0].unit = 'STEM'; f.rows[0].actualQuantity = 10350; f.input.lineInputs[0].stemsPerBunch = 10;
  assert.equal(run(f).lines[0].costPerUnitKRW, 1608.048792);
  f.rows[0].unit = 'BOX'; f.rows[0].actualQuantity = 103.5; f.input.lineInputs[0].bunchesPerBox = 10;
  assert.equal(run(f).issues.length, 0);
  f.rows.push({ ...f.rows[0], lineId: 'mixed' }); f.input.lineInputs.push({ lineId: 'mixed', tariffRate: 0.069, bunchesPerBox: 10 });
  const result = run(f); assert.equal(result.issues.length, 0);
  assert.equal(result.lines[0].componentAmounts.tariffKRW, 0);
  assert.ok(result.lines[1].componentAmounts.tariffKRW > 0);
});
test('NZ source numeric fixture, explicit 5-stem conversion; no historical 702 adjustment', () => {
  const f = addedFixture('NZ'); f.common.exchangeRate = 800; f.input.customsTotalKRW = 177750;
  Object.assign(f.rows[0], { actualQuantity: 760, unitPrice: 7.06, lineAmount: 5365.6 });
  f.input.lineInputs[0].tariffRate = 0.082;
  assert.equal(run(f).lines[0].costPerUnitKRW, 6345.017579);
  f.rows[0].unit = 'BUNCH'; f.rows[0].actualQuantity = 152; f.input.lineInputs[0].stemsPerBunch = 5;
  assert.equal(run(f).lines[0].costPerUnitKRW, 31725.087895);
});
test('EC source numeric fixture; freight and customs allocate quantity, not goods value', () => {
  const f = addedFixture('EC'); f.common.exchangeRate = 1380; f.input.customsTotalKRW = 312380;
  f.input.freightAmount = 1379.6; f.common.effectiveFreightAmount = 1379.6;
  Object.assign(f.rows[0], { actualQuantity: 2400, unitPrice: 0.6, lineAmount: 1440 });
  f.rows.push({ ...f.rows[0], lineId: 'second', unitPrice: 1.2, lineAmount: 2880 });
  f.input.lineInputs = f.rows.map(row => ({ lineId: row.lineId, tariffRate: 0.25 }));
  const result = run(f); assert.deepEqual(result.issues, []);
  assert.equal(result.lines[0].costPerUnitKRW, 1595.872917);
  assert.equal(result.lines[0].componentAmounts.freightNative, 689.8);
  assert.equal(result.lines[1].componentAmounts.freightNative, 689.8);
  assert.equal(result.lines[0].componentAmounts.customsKRW, 156190);
  f.input.freightAmount = 0; f.common.effectiveFreightAmount = 0; f.input.customsTotalKRW = 0;
  assert.equal(run(f).lines[0].costPerUnitKRW, 1035);
});
for (const country of ['AU', 'NZ', 'EC']) {
  for (const [label, mutate, code] of [
    ['country', f => { f.document.reviewedMetadata.country = 'CN'; }, 'FORMULA_COUNTRY_MISMATCH'],
    ['transport', f => { f.document.reviewedMetadata.transportMode = 'SEA'; }, 'FORMULA_TRANSPORT_MISMATCH'],
    ['currency mismatch', f => { f.common.freightCurrency = 'USD'; }, 'FORMULA_CURRENCY_MISMATCH'],
    ['missing currency', f => { f.common.nativeCurrency = ''; }, 'FORMULA_CURRENCY_MISMATCH'],
    ['line currency', f => { f.rows[0].currency = 'USD'; }, 'LINE_CURRENCY_MISMATCH'],
    ['unit', f => { f.rows[0].unit = 'KG'; }, 'UNIT_CONVERSION_REQUIRED'],
    ['missing conversion', f => { f.rows[0].unit = 'BOX'; }, 'UNIT_CONVERSION_REQUIRED'],
    ['missing tariff', f => { f.input.lineInputs = []; }, 'TARIFF_RATE_REQUIRED'],
    ['missing customs', f => { delete f.input.customsTotalKRW; }, 'CUSTOMS_TOTAL_REQUIRED'],
    ['missing FX', f => { f.common.exchangeRate = null; }, 'EXCHANGE_RATE_REQUIRED'],
    ['zero denominator', f => { f.rows[0].actualQuantity = 0; f.rows[0].lineAmount = 0; }, 'ALLOCATION_QUANTITY_REQUIRED'],
  ]) test(`${country} rejects ${label}`, () => { const f = addedFixture(country); mutate(f); blocked(f, code); });
  test(`${country} explicitly zero rates/fees and cancelled rows`, () => {
    const f = addedFixture(country); f.input.customsTotalKRW = 0;
    f.rows.push({ ...f.rows[0], lineId: 'cancelled', actualQuantity: 0, lineAmount: 0, unit: 'BUNCH' });
    const result = run(f); assert.deepEqual(result.issues, []); assert.equal(result.lines[1].totalCostKRW, 0);
    assert.equal(result.lines[1].costPerUnitKRW, null);
  });
}
test('AU/NZ reject extra CNF freight; EC rejects absent/negative freight', () => {
  for (const country of ['AU', 'NZ']) { const f = addedFixture(country); f.input.freightAmount = 1; blocked(f, 'CNF_FREIGHT_DOUBLE_COUNT'); }
  for (const value of [undefined, null, '', -1, false]) { const f = addedFixture('EC'); f.input.freightAmount = value; blocked(f, 'FREIGHT_AMOUNT_REQUIRED'); }
});
test('1000 tiny positive allocations use cumulative rounding with no negative residual', () => {
  const f = addedFixture('EC'); f.input.customsTotalKRW = 0.0006;
  f.input.freightAmount = 0.0006; f.common.effectiveFreightAmount = 0.0006;
  f.rows = Array.from({ length: 1000 }, (_, i) => ({ ...f.rows[0], lineId: String(i).padStart(4, '0'), actualQuantity: 1, unitPrice: 0, lineAmount: 0 }));
  f.input.lineInputs = f.rows.map(row => ({ lineId: row.lineId, tariffRate: 0 }));
  const result = run(f); assert.deepEqual(result.issues, []); assert.equal(result.lines.length, 1000);
  for (const field of ['customsKRW', 'freightNative']) {
    assert.ok(result.lines.every(row => row.componentAmounts[field] >= 0));
    assert.ok(Math.abs(result.lines.reduce((s, row) => s + row.componentAmounts[field], 0) - 0.0006) < 1e-12);
  }
});
test('numeric overflow fails closed for factors, money, rounding and sum', () => {
  for (const mutate of [
    f => { f.common.exchangeRate = 1e308; },
    f => { f.input.customsTotalKRW = 1e308; },
    f => { f.rows[0].unit = 'BOX'; f.input.lineInputs[0].bunchesPerBox = 1e308; f.input.lineInputs[0].stemsPerBunch = 1e308; },
    f => { f.rows[0].actualQuantity = 1e308; f.rows[0].unitPrice = 0; f.rows[0].lineAmount = 0; f.rows.push({ ...f.rows[0], lineId: 'overflow' }); f.input.lineInputs.push({ lineId: 'overflow', tariffRate: 0 }); },
  ]) { const f = addedFixture('NZ'); mutate(f); blocked(f, 'COST_NUMERIC_OVERFLOW'); }
});
test('explicit EXE box/bunch/stem quantities must match conversion, not EstQuantity', () => {
  const f = addedFixture('NZ'); Object.assign(f.rows[0], { actualQuantity: 2, unit: 'BUNCH', unitPrice: 5, lineAmount: 100,
    bunchQuantity: 2, stemQuantity: 20, boxQuantity: 1, estQuantity: 999 });
  Object.assign(f.input.lineInputs[0], { stemsPerBunch: 10, bunchesPerBox: 2 });
  assert.deepEqual(run(f).issues, []);
  for (const field of ['bunchQuantity', 'stemQuantity', 'boxQuantity']) {
    const g = structuredClone(f); g.rows[0][field] += 1; blocked(g, 'RECEIPT_UNIT_QUANTITY_MISMATCH');
  }
  f.rows[0].stemQuantity = false; blocked(f, 'RECEIPT_UNIT_QUANTITY_MISMATCH');
});
