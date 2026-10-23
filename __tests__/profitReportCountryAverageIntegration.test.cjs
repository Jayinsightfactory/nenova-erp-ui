const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const calc = await import('../lib/profitReportCalc.js');
  const valuation = await import('../lib/profitReportValuation.mjs');
  const basis = await import('../lib/profitReportInventoryBasis.mjs');
  const actualCosts = await import('../lib/profitReportActualCosts.mjs');
  const classification = await import('../lib/profitReportClassification.js');
  const resolver = await import('../lib/profitReportCountryResolver.js');
  const countries = ['네덜란드', '태국', '중국', '에콰도르'];
  const keys = [...countries, ...calc.CATEGORY_AVERAGE_INVENTORY_KEYS, '호주'];
  const map = value => Object.fromEntries(keys.map(key => [key, value]));
  const periods = new Map();
  const calls = [];
  const snapshotCalls = [];
  function period(major, year) {
    const id = `${year}:${major}`;
    if (!periods.has(id)) periods.set(id, {
      Q: map(100), S: map(10), H: map(20), R: map(2), manual: {},
      HSource: map('sql_actual_cost'), SSource: map('auto'), legacyS: map(10), actual: {}, available: true,
      normalized: Object.fromEntries(countries.map(category => [category, {
        eligible: true, unit: category === '중국' ? '단' : '송이', purchaseQty: 10, stockQty: 2,
        sources: [`normalized:${id}:${category}`], issues: [], negativeQty: 3,
      }])),
    });
    return periods.get(id);
  }
  const deps = {
    ...calc, ...valuation, ...basis, ...actualCosts,
    EXTRA_CATEGORY: classification.EXTRA_CATEGORY, CNF_CATEGORIES: classification.CNF_CATEGORIES,
    refreshProfitCategorySql: () => {},
    profitReportCategoriesForWeek: () => keys.map(key => ({ key })),
    currencyCodeForCategory: resolver.currencyCodeForCategory,
    salesByCategory: async () => map(1000), estimateByCategory: async () => ({ L: {}, O: {} }),
    purchaseByCategory: async (m, y) => ({ ...period(m, y).Q }),
    purchaseQtyByCategory: async () => map(10),
    forwardingByCategory: async (m, y) => ({ ...period(m, y).legacyS }),
    currencyRates: async () => [],
    invoiceRatesByCategory: async (m, y) => ({ ...period(m, y).R }),
    loadManual: async (m, y) => ({ manual: structuredClone(period(m, y).manual), evidence: {}, note: '' }),
    computeCustomsAndForwarding: async (m, y) => {
      const p = period(m, y);
      return { H: { ...p.H }, S: { ...p.S }, sources: { H: { ...p.HSource }, S: { ...p.SSource } },
        actualCosts: structuredClone(p.actual), components: {} };
    },
    stockSnapshotByCategory: async (m, y) => {
      calls.push(['stock', String(y), m]);
      return { week: `${m}-02`, stockKey: Number(m), snapshotAvailable: period(m, y).available,
        qtys: map(9), values: map(999), priceEvidenceStatus: map('VERIFIED_FIFO_PURCHASE'),
        priceEvidenceSources: Object.fromEntries(keys.map(k => [k, [`fifo:${y}:${m}:${k}`]])),
        unitsByCategory: map(['단']), unitMismatch: Object.fromEntries(countries.map(k => [k, true])),
        conversionMissingCounts: {}, negativeQtys: map(30), anchored: {} };
    },
    normalizedCountryInventoryQuantities: async (m, y, options) => {
      calls.push(['normalized', String(y), m]);
      assert.deepEqual(options?.snapshot, { orderYear: String(y), week: `${m}-02`, stockKey: Number(m),
        snapshotAvailable: period(m, y).available }, 'normalization must use exactly the already loaded report snapshot');
      snapshotCalls.push(structuredClone(options.snapshot));
      return structuredClone(period(m, y).normalized);
    },
    unclassifiedDetailsByCategory: async () => [], formatUnclassifiedNote: () => '',
    loadTaxableRates: async () => ({ byCategory: {}, byCurrency: {} }),
    kcsRatesByCategory: async () => ({ byCategory: {} }), getHistoricalTaxableRate: () => null,
    resolveTaxableRate: ({ snapshotRate }) => ({ rate: snapshotRate, source: snapshotRate > 0 ? 'invoice' : 'missing', suggestions: [] }),
    RATE_SOURCE: { MISSING: 'missing', MANUAL_INPUT: 'manual' },
    createWeekContextCache: fn => fn, resolveCarriedRatesForCategories: async () => ({}),
    CARRIED_RATE_SOURCE: 'carried', isEstimatedPurchaseRate: () => false,
    buildProfitReportAudit: () => ({ issues: [] }), manualInputManifest: {},
  };
  // Compile the actual exported API implementation. Only I/O and unrelated audit
  // orchestration are mocked; valuation, formulas and metadata helpers are real.
  const source = fs.readFileSync('pages/api/sales/profit-report.js', 'utf8');
  const start = source.indexOf('export function parseMajor(');
  const end = source.indexOf('/** 확정된 활성 스냅샷', start);
  assert.ok(start > 0 && end > start);
  const load = new Function(...Object.keys(deps), `${source.slice(start, end).replace(/\bexport /g, '')}; return loadReportData;`)(...Object.values(deps));
  const row = (report, key) => report.rows.find(r => r.category === key);
  const first = await load('31', '2026');
  for (const country of countries) {
    const r = row(first, country);
    assert.equal(r.auto.F, 48, `${country}: (100+10)*2+20, /10 *2`);
    assert.equal(r.auto.E, 48);
    assert.equal(r.stock.unitMismatch, false, 'successful normalized valuation removes raw unit conflict');
    assert.equal(r.stock.negativeQty, 3, 'negative stock evidence must use the same normalized unit as endQty, not legacy 30');
    assert.equal(r.inventoryValuation.end.average.purchaseQty, 10);
    assert.equal(r.inventoryValuation.end.quantity, 2);
    assert.equal(r.inventoryValuation.end.unit, country === '중국' ? '단' : '송이');
  }
  for (const country of calc.CATEGORY_AVERAGE_INVENTORY_KEYS) {
    assert.equal(row(first, country).auto.F, 216, `${country}: original raw9/legacy10 policy preserved`);
    assert.equal(row(first, country).inventoryValuation.end.normalization, undefined);
  }
  assert.equal(row(first, '호주').auto.F, 999, 'unapproved category retains verified item valuation');

  // Same prior/current operands including explicit zeros and Thai approved H.
  const p31 = period('31', '2026');
  p31.manual['네덜란드'] = { H: 0, S: 0, R: 3 };
  p31.actual['태국'] = { source: 'actual_cost_missing', total: null, policyInput: {
    orderYear: '2026', major: '31', gw: { GW1: 100 }, inboundWeeks: ['31-01'], row: {},
  } };
  p31.HSource['태국'] = 'actual_cost_missing';
  const prior = await load('31', '2026');
  const next = await load('32', '2026');
  for (const country of countries) assert.equal(row(next, country).auto.E, row(prior, country).auto.F, `${country}: previous E equals prior F with identical selected inputs`);
  assert.equal(row(prior, '네덜란드').auto.F, 60, 'manual zero H/S are not replaced');
  assert.equal(row(prior, '태국').inventoryValuation.end.estimated, true);
  assert.equal(row(next, '태국').inventoryValuation.begin.estimated, true);

  for (const country of countries) {
    p31.normalized[country].eligible = false;
    p31.normalized[country].reason = 'conversion_missing';
  }
  const blocked = await load('31', '2026');
  for (const country of countries) {
    assert.equal(row(blocked, country).auto.F, 999, 'incomplete normalization keeps verified item fallback');
    assert.equal(row(blocked, country).inventoryValuation.end.average, null);
    assert.equal(row(blocked, country).stock.unitMismatch, true);
    assert.equal(row(blocked, country).stock.negativeQty, 30, 'fallback retains the original quantity evidence consistently');
  }
  p31.normalized['중국'] = { eligible: false, reason: 'no_purchase', unit: '단', purchaseQty: 0, stockQty: 2 };
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, 'no-purchase normalized route cannot use a generic denominator');
  p31.normalized['중국'] = { eligible: true, unit: '단', purchaseQty: 10, stockQty: 2 };
  p31.R['중국'] = null;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, 'missing FX blocks average, not verified prior item evidence');
  p31.R['중국'] = 2;
  for (const source of ['missing', 'partial', 'actual_cost_missing']) {
    p31.HSource['중국'] = source;
    assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, `${source} customs blocks incomplete average`);
    assert.equal(row(await load('32', '2026'), '중국').auto.E, 999, `${source} previous customs also blocks incomplete average`);
  }
  p31.HSource['중국'] = 'historical';
  p31.SSource['중국'] = 'partial';
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, 'partial structured forwarding cannot be accepted merely because a sum exists');
  assert.equal(row(await load('32', '2026'), '중국').auto.E, 999, 'previous partial forwarding also blocks average');
  p31.SSource['중국'] = 'missing';
  delete p31.legacyS['중국'];
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, 'absent structured and legacy forwarding is unknown, not free');
  assert.equal(row(await load('32', '2026'), '중국').auto.E, 999);
  p31.legacyS['중국'] = 10;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 48, 'verified legacy forwarding remains admissible with historical customs');
  p31.legacyS['중국'] = 0;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, 'legacy SUM zero may be ISNULL of missing freight and cannot prove free forwarding');
  assert.equal(row(await load('32', '2026'), '중국').auto.E, 999);
  p31.SSource['중국'] = 'manual';
  p31.S['중국'] = 0;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 44, 'structured explicit zero remains valid forwarding evidence');
  p31.S['중국'] = 10;
  p31.SSource['중국'] = 'missing';
  p31.manual['중국'] = { S: 0 };
  delete p31.legacyS['중국'];
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 44, 'manual zero forwarding is valid evidence');
  assert.equal(row(await load('32', '2026'), '중국').auto.E, 44);
  delete p31.manual['중국'];
  p31.SSource['중국'] = 'auto';
  p31.HSource['중국'] = 'actual_cost_missing';
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 999, 'missing customs cannot become zero-cost average');
  p31.manual['중국'] = { H: 0 };
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 44, 'explicit zero customs is evidence');
  p31.normalized['중국'].stockQty = -2;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, -44, 'signed stock is not clamped');
  p31.normalized['중국'].stockQty = 0;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, 0);
  p31.available = false;
  assert.equal(row(await load('31', '2026'), '중국').auto.F, null, 'zero without a snapshot is not proven empty stock');

  calls.length = 0;
  snapshotCalls.length = 0;
  const january = await load('01', '2026');
  assert.equal(january.stockWeeks.beginOrderYear, '2025');
  assert.equal(january.stockWeeks.begin, '52-02');
  assert.deepEqual(calls.filter(c => c[0] === 'normalized'), [['normalized', '2026', '01'], ['normalized', '2025', '52']]);
  assert.deepEqual(snapshotCalls.map(s => [s.orderYear, s.week, s.stockKey]), [['2026', '01-02', 1], ['2025', '52-02', 52]]);
  assert.equal(row(january, '네덜란드').inventoryValuation.begin.year, '2025');
  console.log('profitReportCountryAverageIntegration: actual API / four-country average + fallback / prior F=E / Thai estimate / manual zero / FX+customs missing / signed+zero+snapshot / legacy6 / year boundary PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
