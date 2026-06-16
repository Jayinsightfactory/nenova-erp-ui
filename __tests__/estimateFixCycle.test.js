// 견적 확정 사이클 단위 검증
// 실행: node __tests__/estimateFixCycle.test.js

async function main() {
  const { getFixCycleWeeksForEditedItems } = await import('../lib/estimateFixCycle.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  const ship = { SubWeeksFix: '24-02:1', SubWeeks: '24-01,24-02' };
  const edited = [
    { OrderWeek: '24-01', ProdName: 'Hydrangea' },
    { OrderWeek: '24-01', ProdName: 'Freight' },
  ];

  console.log('=== getFixCycleWeeksForEditedItems ===');
  const cycle = getFixCycleWeeksForEditedItems(edited, ship);
  assert('24-01 수정 시 24-01 포함', cycle.includes('24-01'));
  assert('24-02 trailing 포함', cycle.includes('24-02'));

  const only02 = getFixCycleWeeksForEditedItems([{ OrderWeek: '24-02' }], ship);
  assert('24-02만 수정', only02.join(',') === '24-02');

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
