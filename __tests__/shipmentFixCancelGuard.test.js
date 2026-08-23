// node __tests__/shipmentFixCancelGuard.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};

async function main() {
  const {
    toOrderYearWeekKey,
    evaluateCheckFixCancel,
    evaluateUnfixStockCalcResult,
    LATER_FIXED_CODE,
    STOCK_CALC_FAILED_CODE,
    STOCK_CALC_RETRY_DELAYS_MS,
  } = await import('../lib/shipmentFixCancelGuard.js');

  console.log('=== toOrderYearWeekKey ===');
  assert('2026 33-02', toOrderYearWeekKey('2026', '33-02') === '20263302');
  assert('cross-year 2025 53-02 < 2026 01-01', toOrderYearWeekKey('2025', '53-02') < toOrderYearWeekKey('2026', '01-01'));
  assert('same week different year not equal', toOrderYearWeekKey('2025', '33-02') !== toOrderYearWeekKey('2026', '33-02'));

  console.log('\n=== evaluateCheckFixCancel ===');
  {
    const r = evaluateCheckFixCancel({ nextWeek: null, products: [{ prodName: 'Doncel' }] });
    assert('no next week ok', r.blocked === false);
  }
  {
    const r = evaluateCheckFixCancel({
      nextWeek: { orderYear: '2026', orderWeek: '34-01', orderYearWeek: '20263401' },
      products: [],
    });
    assert('next week but no detail-fix ok', r.blocked === false);
  }
  {
    const r = evaluateCheckFixCancel({
      nextWeek: { orderYear: '2026', orderWeek: '34-01', orderYearWeek: '20263401' },
      products: [{ prodKey: 1, prodName: 'CARNATION Doncel' }],
    });
    assert('detail-fix blocks', r.blocked === true);
    assert('code', r.code === LATER_FIXED_CODE);
    assert('mentions next week', r.error.includes('34-01'));
    assert('mentions product', r.error.includes('Doncel'));
  }
  {
    const r = evaluateCheckFixCancel({
      nextWeek: { orderYear: '2026', orderWeek: '01-01', orderYearWeek: '20260101' },
      products: [{ prodName: 'Rose' }],
    });
    assert('cross-year next week uses OrderYearWeek not OrderWeek string', r.blocked === true && r.error.includes('2026'));
  }

  console.log('\n=== evaluateUnfixStockCalcResult ===');
  assert('skip ok', evaluateUnfixStockCalcResult({ skipStockCalc: true, stockErrors: [{ message: 'x' }] }).ok === true);
  assert('no errors ok', evaluateUnfixStockCalcResult({ stockErrors: [] }).ok === true);
  {
    const r = evaluateUnfixStockCalcResult({ stockErrors: [{ message: 'deadlock' }] });
    assert('stock errors fail', r.ok === false && r.code === STOCK_CALC_FAILED_CODE);
  }
  assert('retry delays 1s 2s 4s', STOCK_CALC_RETRY_DELAYS_MS.join(',') === '1000,2000,4000');

  const fs = await import('node:fs');
  const fixApi = fs.readFileSync('pages/api/shipment/fix.js', 'utf8');
  const estimate = fs.readFileSync('pages/estimate.js', 'utf8');
  const fixStatusApi = fs.readFileSync('pages/api/shipment/fix-status.js', 'utf8');
  const gateSql = fs.readFileSync('docs/migrations/2026-08-23_nenova_stock_week_gate.sql', 'utf8');

  console.log('\n=== source contracts ===');
  assert('unfix uses CheckFixCancel helper', fixApi.includes('evaluateCheckFixCancel'));
  assert('unfix reads ViewShipment DetailFix', fixApi.includes('vs.DetailFix'));
  assert('unfix next week from StockMaster.OrderYearWeek', fixApi.includes('StockMaster') && fixApi.includes('OrderYearWeek > @oyw'));
  assert('unfix does not honour force for later-fixed', !/laterFixed\.length > 0 && !req\.body\.force/.test(fixApi));
  assert('unfix fails when stock calc fails', fixApi.includes('evaluateUnfixStockCalcResult'));
  assert('skipStockCalc clears gate', fixApi.includes('usp_NenovaStockWeekGateClear'));
  assert('estimate one-week unfix does not force-retry later-fixed', !estimate.includes('return await unfixOneWeek(subWeek, true)'));
  assert('estimate selected unfix does not recurse with force', !estimate.includes('await unfixSelectedFixStatusWeeks(true)'));
  assert('fix-status range does not force later-fixed', !fixStatusApi.includes('later.recordset.length > 0 && !force'));
  assert('gate SQL serializes FIX/CANCEL/CALC', gateSql.includes('usp_NenovaStockWeekGateEnter') && gateSql.includes("N'WAIT_CALC'"));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
