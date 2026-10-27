const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const root = path.resolve(__dirname, '..');
const helper = import('../lib/profitCustomerMarginPresentation.mjs');

function compile(relative, helpers) {
  const filename = path.join(root, relative);
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const defaultRequire = m.require.bind(m);
  m.require = request => request.endsWith('profitCustomerMarginPresentation.mjs') ? helpers : defaultRequire(request);
  m._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  }).code, filename);
  return m.exports;
}
const metric = { quantity: 10, positiveQuantity: 10, netSales: 10000, vat: 1000, avgNetPrice: 1000, avgGrossPrice: 1100,
  costAmount: null, marginAmount: null, marginPct: null, quantityShare: .2, revenueShare: .15,
  coverage: { knownSales: 4000, totalSales: 10000, unknownProducts: [101] }, warnings: ['이월 원가 근거 부족'] };
const product = { prodKey: 101, productName: '카네이션 A', unit: '단', current: metric, previous: { ...metric, quantityShare: .1 },
  costBasis: { openingQuantity: 3, openingAmount: null, receiptQuantity: 10, receiptAmount: 5000, unitCost: null, status: '미확정', reason: '검증된 기초원가 없음' } };
const group = { key: 'CO|카네이션|단', category: '콜롬비아 카네이션', country: '콜롬비아', flower: '카네이션', unit: '단', current: metric, previous: { ...metric, marginPct: .2 }, products: [product],
  customers: [{ custKey: 533, custName: '주광', current: metric, previous: { ...metric, quantityShare: .1 }, products: [product] }],
  drivers: { profitDelta: null, marginDeltaPp: null, contributions: [], residual: null,
    coverage: { commonPairs: 1, pricedCommonPairs: 0 }, commonCohort: { revenueDelta: 1000 }, revenueDrivers: [{ key: 'mix', label: '업체 구성', amount: 1000 }], warnings: ['원가 미확정'] } };

test('presentation preserves null/zero, fraction percentages, point differences and full-scope unit groups', async () => {
  const h = await helper;
  assert.equal(h.displayNumber(null), '미확정'); assert.equal(h.displayNumber(0), '0'); assert.equal(h.displayNumber(NaN), '미확정');
  assert.equal(h.displayPercent(.125), '12.5%'); assert.equal(h.displayPoints(h.differencePoints(.15, .1)), '+5%p');
  assert.equal(h.differencePoints(null, .1), null);
  assert.equal(h.salesPhysicalAverageCost({ costAmount: 795, physicalQuantity: 7.95, quantity: 8 }), 100);
  assert.equal(h.salesPhysicalAverageCost({ costAmount: 795, quantity: 8 }), null);
  const groups = [group, { ...group, key: 'CO|카네이션|송이', unit: '송이', customers: [], products: [] }];
  const before = JSON.stringify(groups);
  assert.equal(h.filterMarginGroups(groups, '주광').length, 1);
  assert.equal(h.filterMarginGroups(groups, '').length, 2);
  assert.equal(h.filterMarginGroups(groups, '카네이션')[0].current.netSales, 10000);
  assert.equal(JSON.stringify(groups), before); assert.match(h.coverageText(metric), /4,000 \/ 10,000원.*1품목/);
  const customerProducts = [{ prodKey: '101', unit: '단', current: metric }, { prodKey: 101, unit: '송이', current: metric }];
  const attached = h.attachGroupCostBasis(customerProducts, [product]);
  assert.equal(attached[0].costBasis, product.costBasis); assert.equal(attached[1].costBasis, null);
  assert.equal(customerProducts[0].costBasis, undefined);
  assert.equal(h.attachGroupCostBasis(customerProducts, [product, product])[0].costBasis, null);
});

test('read-only GET transmits both years, refuses mismatch/array/partial comparison and never refreshes report', async () => {
  const h = await helper;
  assert.throws(() => h.marginQuery({ year: ['2026'], week: 39 }));
  assert.throws(() => h.marginQuery({ year: 2026, week: 39, compareYear: 2025 }));
  assert.throws(() => h.marginQuery({ year: 2026, week: 0 }));
  assert.throws(() => h.marginQuery({ year: 2026, week: 39, compareYear: 2026, compareWeek: 39 }), /이전/);
  const calls = [];
  const payload = { ok: true, current: { year: 2026, major: 1 }, previous: { year: 2025, major: 53 }, groups: [group], reported: [], metadata: { readOnly: true } };
  await h.loadCustomerMargin({ year: 2026, week: 1, compareYear: 2025, compareWeek: 53 }, { fetcher: async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => payload }; } });
  assert.match(calls[0][0], /year=2026&week=01&compareYear=2025&compareWeek=53/); assert.equal(calls[0][1].method, 'GET'); assert.equal(calls.length, 1);
  await assert.rejects(h.loadCustomerMargin({ year: 2025, week: 1 }, { fetcher: async () => ({ ok: true, json: async () => payload }) }), /응답이 다릅니다/);
  await assert.rejects(h.loadCustomerMargin({ year: 2026, week: 1 }, { fetcher: async () => ({ ok: false, status: 502 }) }), /HTTP 502/);
  assert.match(h.customerMarginUrl(2026, 39), /year=2026&week=39&popup=1/);
});

test('canonical report categories distinguish nine freight groups sharing the domestic-wax product classification', async () => {
  const h = await helper; const ui = compile('components/ProfitCustomerMarginView.js', h);
  const categories = ['콜롬비아 카네이션', '콜롬비아 수국', '미국', '네덜란드', '콜롬비아 루스커스', '콜롬비아 장미', '중국', '태국', '기타(미분류)'];
  const groups = categories.map(category => ({ ...group, key: category, category, country: '국내', flower: '왁스', unit: '박스', kinds: ['O'] }));
  const labels = groups.map(g => h.marginGroupLabel(g));
  assert.equal(new Set(labels.map(l => l.title)).size, 9);
  assert(labels.every((l, i) => l.title.startsWith(categories[i]) && l.title.includes('운임/기타매출') && l.sourceLabel === '원품목 분류: 국내 · 왁스'));
  assert.equal(h.marginGroupLabel({ category: '태국', country: '태국', flower: '모카라', kinds: ['N'] }).title, '태국 · 모카라');
  assert.match(h.marginGroupLabel({ category: '중국', country: '국내', flower: '왁스', kinds: ['L'] }).title, /차감$/);
  const html = renderToStaticMarkup(React.createElement(ui.default, { data: { current: { year: 2026, major: 39 }, previous: { year: 2026, major: 38 }, groups, reported: [], warnings: [] } }));
  assert.match(html, /콜롬비아 카네이션 · 운임\/기타매출/); assert.match(html, /태국 · 운임\/기타매출/); assert.match(html, /원품목 분류: 국내 · 왁스/);
});

test('rendered tables expose missing cost, VAT distinction, whole scope, independent legacy K and source time', async () => {
  const h = await helper; const ui = compile('components/ProfitCustomerMarginView.js', h);
  const data = { current: { year: 2026, major: 39, asOf: '2026-10-27' }, previous: { year: 2026, major: 38 }, groups: [group],
    warnings: ['저장 보고서와 현재 SQL 시점 다름'], reported: [{ category: '콜롬비아 카네이션', current: { K: .3481, J: 50000, AJ: 10000, source: '계산 저장본' }, previous: { K: -.0089 } }] };
  const html = renderToStaticMarkup(React.createElement(ui.default, { data }));
  assert.match(html, /34.81%/); assert.match(html, /-0.89%/); assert.match(html, /미확정/); assert.match(html, /저장 보고서와 현재 SQL 시점 다름/);
  assert.match(html, /검색해도 각 행의 비중/); assert.match(html, /aria-controls=/); assert.match(html, /scope="col"/); assert.match(html, /<caption>/);
  assert.doesNotMatch(html, /height:\s*\d+(px|vh)|overflow-y:\s*(auto|scroll)/);
  const details = renderToStaticMarkup(React.createElement(ui.MarginGroupDetails, { group }));
  assert.match(details, /VAT제외/); assert.match(details, /VAT포함/); assert.match(details, /주광/); assert.match(details, /\+10%p/);
  assert.match(details, /공통 판매대상의 매출 변화/); assert.match(details, /판매이익 영향이 아닌 매출 영향/);
  const cost = renderToStaticMarkup(React.createElement(ui.ProductCostDetails, { product }));
  assert.match(cost, /ProdKey 101/); assert.match(cost, /검증된 기초원가 없음/); assert.match(cost, /기초수량/);
  const link = compile('components/ProfitCustomerMarginLink.js', h).default;
  assert.match(renderToStaticMarkup(React.createElement(link, { year: 2026, major: 39 })), /noopener noreferrer/);
  assert.match(renderToStaticMarkup(React.createElement(link, { year: 2026, major: 39, disabled: true })), /disabled=""/);
});

test('keyboard row navigation preserves inputs and Escape closes nearest evidence then restores summary focus', async () => {
  const h = await helper;
  let focused = -1, prevented = 0;
  const buttons = [0, 1, 2].map(i => ({ focus: () => { focused = i; }, matches: () => true, closest: () => ({ querySelectorAll: () => buttons }) }));
  h.navigateMarginRows({ key: 'ArrowDown', currentTarget: buttons[0], preventDefault: () => prevented++ }); assert.equal(focused, 1);
  h.navigateMarginRows({ key: 'End', currentTarget: buttons[0], preventDefault: () => prevented++ }); assert.equal(focused, 2);
  h.navigateMarginRows({ key: 'ArrowUp', currentTarget: { matches: () => false }, preventDefault: () => prevented++ }); assert.equal(prevented, 2);
  const details = { open: true, querySelector: () => ({ focus: () => { focused = 9; } }) };
  h.closeMarginDetails({ key: 'Escape', target: { closest: () => details }, stopPropagation() {}, preventDefault() {} });
  assert.equal(details.open, false); assert.equal(focused, 9);
});

test('top-level cost coverage compares both periods, preserves missing versus zero and never sums overlapping reasons', async () => {
  const h = await helper; const ui = compile('components/ProfitCustomerMarginView.js', h);
  const current = { year: 2026, major: 39 }, previous = { year: 2026, major: 38 };
  const coverage = { current: { knownProducts: 176, unknownProducts: 119, knownSales: 70364125, totalSales: 295687742, salesCoverage: 70364125 / 295687742, reasonCountsOverlap: true,
    reasons: [{ reason: '입고 도착원가 부족', productCount: 10, sales: 10000 }, { reason: '수량 대사 추가 검산 필요', productCount: 8, sales: 8000 }] },
    previous: { knownProducts: 142, unknownProducts: 86, knownSales: 23200, totalSales: 100000, salesCoverage: .232, reasons: [], reasonCountsOverlap: true } };
  const render = value => renderToStaticMarkup(React.createElement(ui.CostCoverageSummary, { current, previous, coverage: value }));
  const html = render(coverage);
  assert.match(html, /2026년 38차/); assert.match(html, /2026년 39차/); assert.match(html, /23.8%/); assert.match(html, /23.2%/);
  assert.match(html, /70,364,125 \/ 295,687,742/); assert.match(html, /<td>176<\/td>/); assert.match(html, /<td>119<\/td>/);
  assert.match(html, /승인 추정 포함/); assert.match(html, /전체 확정 영업마진으로 해석하지/); assert.match(html, /중복될 수 있으므로 합산하지/);
  assert.match(html, /수량 대사 추가 검산 필요/); assert.doesNotMatch(html, /18,000/);
  const missing = render(undefined); assert.match(missing, /<b>미확정<\/b>/); assert.doesNotMatch(missing, /<b>0%<\/b>/);
  assert.match(render({ current: { knownProducts: 0, unknownProducts: 1, knownSales: 0, totalSales: 100, salesCoverage: 0 } }), /<b>0%<\/b>/);
  const page = renderToStaticMarkup(React.createElement(ui.default, { data: { current, previous, groups: [group], reported: [], metadata: { costCoverage: coverage } } }));
  assert(page.indexOf('원가 확인범위 (승인 추정 포함)') < page.indexOf('모든 품종 · 업체비중과 판매마진'));
});

test('real driver payload with all costs unknown still renders price analysis without claiming full profit attribution', async () => {
  const h = await helper; const ui = compile('components/ProfitCustomerMarginView.js', h);
  const { decomposeCustomerMargin } = await import('../lib/profitCustomerMarginDrivers.mjs');
  const pair = (netSales, unitCost) => ({ prodKey: 101, custKey: 533, unit: '단', quantity: 10, netSales, unitCost });
  const drivers = decomposeCustomerMargin({ previous: [pair(100, null)], current: [pair(120, null)] });
  const html = renderToStaticMarkup(React.createElement(ui.MarginDrivers, { drivers, current: metric, previous: metric }));
  assert.match(html, /동일품목·업체 판매단가 변화/); assert.match(html, /판매이익 영향이 아닌 매출 영향/);
  assert.match(html, /전체 판매이익 차이 <b>미확정/); assert.match(html, /전체 판매마진율 차이 <b>비교 불가/);
  assert.match(html, /공통 1쌍 중 원가 확인 0쌍/);
});

test('partial cost cohort and physical-versus-billed residual remain distinct; cross-year source and existing K stay intact', async () => {
  const h = await helper; const ui = compile('components/ProfitCustomerMarginView.js', h);
  const { decomposeCustomerMargin } = await import('../lib/profitCustomerMarginDrivers.mjs');
  const pair = (prodKey, netSales, unitCost) => ({ prodKey, custKey: 533, unit: '단', quantity: 10, netSales, unitCost });
  const partial = decomposeCustomerMargin({ previous: [pair(1, 100, 5), pair(2, 100, null)], current: [pair(1, 120, 5), pair(2, 140, null)] });
  const html = renderToStaticMarkup(React.createElement(ui.MarginDrivers, { drivers: partial, current: metric, previous: metric }));
  assert.match(html, /공통 2쌍 중 원가 확인 1쌍/); assert.match(html, /해당 공통대상의 마진율 차이/); assert.match(html, /전체 판매이익 차이 <b>미확정/);
  const residual = decomposeCustomerMargin({ previous: [pair(1, 100, 5)], current: [pair(1, 120, 5)], previousMargin: 50, currentMargin: 65 });
  const residualHtml = renderToStaticMarkup(React.createElement(ui.MarginDrivers, { drivers: residual, current: { marginPct: 65 / 120 }, previous: { marginPct: .5 } }));
  assert.match(residualHtml, /청구\/실물 수량차이/); assert.match(residualHtml, /<td>-5<\/td>/); assert.match(residualHtml, /평균판매가는 청구수량 기준/);
  const report = renderToStaticMarkup(React.createElement(ui.ReportedMarginTable, {
    previous: { year: 2025, major: 53 }, current: { year: 2026, major: 1 }, rows: [{ category: '국가', isTotal: true,
      current: { K: .1, variant: 'noEnding', source: '확정본', asOf: '2026-01-08' }, previous: { K: .2, source: '계산본', asOf: '2025-12-31' },
      drivers: [{ key: 'E', label: '기초재고액 변화', amount: -500, percentagePoints: -2 }],
      bridge: { profitDelta: 100, marginDeltaPp: -10, residual: 600, rateResidual: -8, denominator: { previous: 200, current: 100 }, warnings: ['REPORTED_PROFIT_BRIDGE_RESIDUAL'] },
      adjustments: [{ year: 2026, week: '01-01', quantity: -2, unit: '단', reason: '전산 정리', recordedAt: '2026-01-08' }] }],
  }));
  assert.match(report, /2025년 53차/); assert.match(report, /2026년 1차/); assert.match(report, /기초재고액 변화/); assert.match(report, /-500/);
  assert.match(report, /전산 정리/); assert.match(report, /기존 보고서의 저장된 이익률/); assert.match(report, /임의 단가를 곱해 손익 영향으로 단정하지 않습니다/);
  assert.match(report, /미설명 금액 600원/); assert.match(report, /미설명 수익률 차이 -8%p/); assert.match(report, /항목별 금액 기여의 합이 일치하지 않습니다/);
});
