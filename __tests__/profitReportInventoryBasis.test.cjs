const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

(async () => {
  const helper = await import('../lib/profitReportInventoryBasis.mjs');
  const { buildInventoryBasis: basis } = helper;
  const input = {
    category: '콜롬비아 수국', year: '2026', major: '26', averageEligible: true,
    stock: { week: '26-02', snapshotConfirmed: true, endQty: 5, priceEvidenceStatus: 'VERIFIED_CATEGORY_AVERAGE', priceEvidenceSources: ['erp:2026:26-02:category-average'] },
    value: 7000, average: { value: 7000, unitCost: 1400 }, units: ['송이'],
    inputs: { purchaseForeign: 10, forwardingForeign: 3, taxableRate: 1000, customsCost: 1000, purchaseQty: 10, stockQty: 5 },
  };
  const original = JSON.stringify(input);
  const avg = basis(input);
  assert.equal(avg.method, 'category_average');
  assert.equal(avg.average.totalCost, 14000);
  assert.equal(avg.average.unitCost, 1400);
  assert.equal(avg.unit, '송이');
  assert.equal(JSON.stringify(input), original, 'display never mutates valuation input');
  assert.equal(basis({ ...input, year: '2025' }).year, '2025');
  assert.equal(basis({ ...input, year: null }).average, null);
  assert.equal(basis({ ...input, major: '00' }).average, null);
  const estimated = basis({ ...input, average: { ...input.average, estimated: true }, stock: { ...input.stock, priceEvidenceStatus: 'APPROVED_ESTIMATE' } });
  assert.equal(estimated.method, 'category_average');
  assert.equal(estimated.estimated, true);
  const directInput = { ...input, average: null, value: 8000, stock: { ...input.stock, priceEvidenceStatus: 'VERIFIED_FIFO_PURCHASE' } };
  const mixed = basis({ ...directInput, category: '콜롬비아 장미', units: ['단', '송이'], stock: { ...directInput.stock, unitMismatch: true } });
  assert.equal(mixed.reason, 'unit_mismatch');
  assert.equal(mixed.method, 'product_cost');
  assert.equal(mixed.average, null);
  assert.equal(mixed.unit, null);
  const noPurchase = basis({ ...directInput, category: '베트남', inputs: { ...input.inputs, purchaseQty: 0 } });
  assert.equal(noPurchase.reason, 'no_purchase');
  assert.equal(noPurchase.value, 8000);
  for (const country of ['호주', '중국', '태국', '에콰도르', '네덜란드', '미지 국가']) {
    const direct = basis({ ...directInput, category: country, averageEligible: false });
    assert.equal(direct.reason, 'not_proven_category');
    assert.equal(direct.average, null, `${country}: never invent aggregate unit cost`);
  }
  const confirmed = basis({ ...input, confirmed: true });
  assert.equal(confirmed.method, 'confirmed_snapshot');
  assert.equal(confirmed.value, 7000);
  assert.equal(confirmed.average, null);
  assert.equal(confirmed.quantity, null);
  assert.equal(confirmed.year, null, 'do not claim current-period operands for legacy opening inventory');
  assert.equal(confirmed.week, null, 'never label a legacy confirmed value with a fresh snapshot week');
  assert.deepEqual(confirmed.sources, [], 'never attach fresh source evidence to legacy confirmed amounts');
  assert.equal(basis({ ...input, confirmed: true, average: { ...input.average, estimated: true }, stock: { ...input.stock, priceEvidenceStatus: 'APPROVED_ESTIMATE' } }).estimated, false);
  assert.equal(confirmed.reason, 'confirmed_legacy');
  assert.equal(basis({ ...input, value: 0, stock: { ...input.stock, endQty: 0 } }).method, 'no_stock');
  const unconvertibleZero = basis({ ...input, value: 0, stock: { ...input.stock, endQty: 0, conversionMissingCount: 1 } });
  assert.equal(unconvertibleZero.method, 'missing', 'excluded unconvertible stock is not an empty inventory');
  assert.equal(unconvertibleZero.reason, 'conversion_missing');
  assert.equal(unconvertibleZero.quantity, null, 'incomplete conversion must not expose an unproven zero quantity');
  assert.equal(unconvertibleZero.value, 0, 'display metadata preserves the existing numeric value');
  const mixedNetZero = basis({ ...directInput, value: 0, units: ['단', '송이'], stock: { ...directInput.stock, endQty: -5 + 5, unitMismatch: true } });
  assert.equal(mixedNetZero.method, 'product_cost', 'opposite quantities in different units do not prove empty inventory');
  assert.equal(mixedNetZero.reason, 'unit_mismatch');
  assert.equal(mixedNetZero.value, 0);
  assert.equal(basis({ ...input, value: null }).method, 'missing');
  assert.equal(basis({ ...input, stock: { ...input.stock, snapshotConfirmed: false } }).reason, 'missing_snapshot');
  assert.equal(basis({ ...input, value: null, stock: { ...input.stock, conversionMissingCount: 1 } }).reason, 'conversion_missing');
  assert.equal(basis({ ...input, units: [] }).unit, null);
  assert.equal(basis({ ...input, units: ['개'] }).unit, null);
  assert.equal(basis({ ...input, units: ['송이', ''] }).unit, null);
  assert.equal(basis({ ...directInput, stock: { ...directInput.stock, priceEvidenceStatus: 'APPROVED_ESTIMATE' } }).estimated, true);
  const previous = basis({ ...input, major: '25', stock: { ...input.stock, week: '25-02' } });
  assert.equal(previous.major, '25');
  assert.notDeepEqual(previous, avg);

  const { computeProfitRow } = await import('../lib/profitReportCalc.js');
  const row = { category: input.category, manual: {}, stock: input.stock,
    auto: { N: 100000, L: -200, O: 100, Q: 10, S: 3, R: 1000, H: 1000, E: 6000, F: 7000 } };
  assert.deepEqual(computeProfitRow(row), computeProfitRow({ ...row, inventoryValuation: { begin: previous, end: avg } }), 'additive evidence leaves every numeric calculation unchanged');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { transformSync } = require('next/dist/build/swc');
  const filename = path.resolve('components/ProfitInventoryBasis.js');
  const ui = new Module(filename);
  ui.filename = filename;
  ui.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = ui.require.bind(ui);
  ui.require = id => id.includes('profitReportInventoryBasis.mjs') ? helper : originalRequire(id);
  ui._compile(transformSync(fs.readFileSync(filename, 'utf8'), { filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' } }).code, filename);
  const data = { rows: [
    { category: '콜롬비아 수국', inventoryValuation: { begin: previous, end: estimated } },
    { category: '콜롬비아 장미', inventoryValuation: { begin: mixed, end: mixed } },
    { category: '베트남', inventoryValuation: { begin: avg, end: noPurchase } },
    { category: '확정본 예시', inventoryValuation: { begin: confirmed, end: confirmed } },
  ] };
  const html = renderToStaticMarkup(React.createElement(ui.exports.default, { data, edits: { '콜롬비아 수국': { R: 1200 } } }));
  for (const text of ['평균 도착원가', '14,000', '1,400', '송이', '승인 추정 포함', '단위가 혼합', '매입수량이 없어', '확정 당시', '역산하지 않습니다', '입력 편집 중']) assert.ok(html.includes(text), text);
  assert.match(html, /<details open=""/);
  assert.match(html, /<summary/);
  assert.match(html, /id="profit-inventory-basis"/);
  assert.ok(!html.includes('max-height'));
  assert.ok(!html.includes('overflow-y'));
  const legacy = renderToStaticMarkup(React.createElement(ui.exports.default, { data: { confirmed: true, rows: [{ category: '과거 확정', calc: { E: 123, F: 456 } }] } }));
  assert.ok(legacy.includes('123원'));
  assert.ok(legacy.includes('상세 평가 근거 미보관'));
  const unknownUnitHtml = renderToStaticMarkup(React.createElement(ui.exports.default, { data: { rows: [{ category: '단위 누락', inventoryValuation: { end: basis({ ...input, units: [] }) } }] } }));
  assert.ok(unknownUnitHtml.includes('단위 미확인'));
  assert.ok(!unknownUnitHtml.includes('원/금액기준 수량'));
  const mixedHtml = renderToStaticMarkup(React.createElement(ui.exports.default, { data: { rows: [{ category: '혼합 단위', inventoryValuation: { end: mixed } }] } }));
  assert.ok(mixedHtml.includes('환산재고: 단위별 확인 필요'));
  assert.ok(!mixedHtml.includes('환산재고 5'), 'do not display summed mixed-unit quantity as a usable quantity');
  assert.equal(mixed.quantity, 5, 'retain raw quantity metadata for audit');
  const mixedZeroHtml = renderToStaticMarkup(React.createElement(ui.exports.default, { data: { rows: [{ category: '혼합 단위 순수량 0', inventoryValuation: { end: mixedNetZero } }] } }));
  assert.ok(mixedZeroHtml.includes('환산재고: 단위별 확인 필요'));
  assert.ok(!mixedZeroHtml.includes('환산재고수량 0'));
  const page = fs.readFileSync('pages/sales/profit-report.js', 'utf8');
  const panelIndex = page.indexOf('<ProfitInventoryBasis data=');
  const mainTableIndex = page.lastIndexOf('<table style={st.table}>', panelIndex);
  assert.ok(mainTableIndex >= 0 && panelIndex > page.indexOf('</table>', mainTableIndex), 'main report precedes expanded evidence table');
  assert.ok(panelIndex < page.indexOf('상세 확인 내역', panelIndex), 'evidence precedes existing validation details');
  assert.ok(page.indexOf('href="#profit-inventory-basis"') < mainTableIndex, 'compact anchor stays above results');
  assert.match(page, /if \(panel\) panel.open = true/);
  const source = fs.readFileSync('pages/api/sales/profit-report.js', 'utf8');
  assert.match(source, /inputs: previous.averageInputs/);
  assert.match(source, /inputs: currentAverageInputs/);
  assert.match(source, /value: calc\.E, confirmed: true/);
  assert.match(source, /value: calc\.F, confirmed: true/);
  assert.ok(require('../lib/profitReportCalcHash.cjs').listFiles(process.cwd()).includes('lib/profitReportInventoryBasis.mjs'));
  const renderArg = process.argv.find(arg => arg.startsWith('--render='));
  if (renderArg) {
    const output = path.resolve(renderArg.slice('--render='.length));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>재고 평가 근거 표시 회귀</title><body style="margin:20px;font-family:Arial,sans-serif">' + html + '</body></html>');
    console.log(`Rendered fixture: ${output}`);
  }
  console.log('PASS inventory basis display: average/direct/exception/estimated/confirmed/year/zero/numeric preservation and rendered UI');
})().catch(error => { console.error(error); process.exitCode = 1; });
