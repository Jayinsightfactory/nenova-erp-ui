// Pure policy and exact attached workbook evidence. No DB/network calls.
const assert = require('node:assert/strict');
const fixture = require('./fixtures/profit-customs-rates-26-31.json');

(async () => {
  const { approvedCustomsTiming: timing, isoWeekMondayDate, isApprovedCustomsTimingPeriod } = await import('../lib/profitReportCustomsRateTiming.mjs');
  const { mapCategoryDateRowsToWeights: map } = await import('../lib/kcsRateDateWeights.js');
  const { getHistoricalTaxableRate } = await import('../lib/profitReportHistoricalCustoms.js');
  const { RATE_SOURCE: S, EXACT_WEEK_RATE_SOURCES, resolveTaxableRate: resolve, isKcsRateEligibleWeek } = await import('../lib/taxableExchangeRate.js');
  const at = (category, currency, major = 32, orderYear = 2026) => timing({ category, currency, major, orderYear });
  for (const category of ['콜롬비아 수국', '콜롬비아 카네이션', '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로', '베트남']) {
    assert.equal(at(category, 'USD').date, '2026-08-03');
  }
  assert.equal(at('호주', 'AUD').date, '2026-08-03');
  for (const [category, currency] of [['네덜란드','EUR'],['태국','USD'],['에콰도르','USD'],['중국','CNY']]) {
    assert.equal(at(category, currency).date, '2026-08-10');
    assert.equal(at(category, currency).estimated, true);
    assert.equal(at(category, currency).source, S.APPROVED_TIMING_ESTIMATE);
  }
  assert.equal(at('중국', 'CNY', 29).date, '2026-07-13');
  assert.equal(at('중국', 'CNY', 28).date, '2026-07-13');
  assert.equal(at('중국', 'CNY', 30).date, '2026-07-27');
  assert.equal(at('중국', 'CNY', 31).date, '2026-08-03');
  assert.equal(at('중국', 'CNY', 29, 2027).isoWeekOffset, 1);
  assert.equal(at('태국', 'USD', 53).date, '2027-01-04');
  assert.equal(at('태국', 'USD', 1, 2027).date, '2027-01-11');
  assert.equal(isoWeekMondayDate(2026, 53), '2026-12-28');
  for (const [year, week] of [[2025,28],[2026,27],[2027,0],[2027,-1],[2027,53],[2028,54],[2027,1.5],[null,32],[2027,null]]) {
    assert.equal(isApprovedCustomsTimingPeriod(year, week), false, `${year}/${week}`);
    assert.equal(isKcsRateEligibleWeek(year, week), false, `${year}/${week}`);
    assert.equal(at('중국','CNY',week,year), null);
  }
  assert.equal(at('태국','CNY'), null);
  assert.equal(at('미등록','USD'), null);
  assert.equal(at('태국',''), null);

  const row = { Category: '호주', ResolvedDate: '2026-07-09', Weight: 100 };
  const modern = map([row], {orderYear:2026, major:28})[0];
  assert.equal(modern.date, '2026-07-06');
  assert.equal(modern.inputDate, '2026-07-09');
  assert.equal(modern.estimated, true);
  const legacy = map([row], {orderYear:2026, major:27})[0];
  assert.equal(legacy.date, '2026-07-09');
  assert.equal(legacy.dateSource, 'warehouse_input_date');
  assert.equal(legacy.estimated, false);
  assert.deepEqual(map([], {orderYear:2026,major:32}), []);
  assert.deepEqual(map([0,-1,NaN,Infinity].map(Weight=>({...row,Weight})), {orderYear:2026,major:32}), []);

  let count = 0;
  for (const book of fixture) {
    assert.match(book.sha256, /^[a-f0-9]{64}$/);
    for (const entry of book.rates) {
      assert.match(entry.cell, /^R\d+$/);
      assert.equal(getHistoricalTaxableRate(2026, book.week, entry.category), entry.rate, `${book.file} ${entry.cell} ${entry.category}`);
      assert.equal(getHistoricalTaxableRate(2025, book.week, entry.category), null);
      count++;
    }
  }
  assert.equal(count, 59);
  for (const week of [26,28,30,31]) assert.equal(getHistoricalTaxableRate(2026,week,'호주'), null);
  assert.equal(getHistoricalTaxableRate(2026,30,'에콰도르'), null);
  assert.equal(getHistoricalTaxableRate(2026,30,'베트남'), null);

  const candidate = {kcsRate:1450,kcsDetail:{source:S.APPROVED_TIMING_ESTIMATE,estimated:true}};
  assert.equal(resolve(candidate).source, S.APPROVED_TIMING_ESTIMATE);
  assert.equal(resolve(candidate).estimated, true);
  assert(EXACT_WEEK_RATE_SOURCES.has(S.APPROVED_TIMING_ESTIMATE));
  assert.equal(resolve({...candidate,snapshotRate:1500}).source,S.FREIGHT_COST_SNAPSHOT);
  assert.equal(resolve({...candidate,savedByCategory:{rate:1510,source:S.MANUAL_INPUT}}).source,S.MANUAL_INPUT);
  assert.equal(resolve({...candidate,historicalRate:1520}).source,S.EXCEL_HISTORICAL);
  assert.equal(resolve({...candidate,savedByCurrency:{rate:1530}}).source,S.SAVED_OFFICIAL_WEEK);
  assert.equal(resolve({kcsRate:1450}).source,S.KCS_API);
  for (const kcsRate of [0,-1,NaN,Infinity,null]) assert.equal(resolve({...candidate,kcsRate}).source,S.MISSING);
  console.log(`PASS: approved customs timing, ISO boundary, precedence, no-purchase and ${count} original R cells across 6 SHA-linked workbooks`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
