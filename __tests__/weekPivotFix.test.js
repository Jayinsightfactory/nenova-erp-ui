// 차수피벗 확정 표시 단위 검증
// 실행: node __tests__/weekPivotFix.test.js

async function main() {
  const {
    isWeekPivotLineFixed,
    isWeekPivotCellFixed,
    weekPivotFixState,
  } = await import('../lib/weekPivotFix.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  const rows = [
    { ProdKey: 1, CustKey: 10, OrderWeek: '24-01', outQty: 5, isFix: 1 },
    { ProdKey: 2, CustKey: 10, OrderWeek: '24-01', outQty: 3, isFix: 0 },
    { ProdKey: 1, CustKey: 11, OrderWeek: '24-01', outQty: 0, isFix: 1 },
    { ProdKey: 3, CustKey: 10, OrderWeek: '24-02', outQty: 2, isFix: 1 },
  ];

  console.log('=== isWeekPivotLineFixed ===');
  assert('출고+isFix=확정', isWeekPivotLineFixed(rows[0]));
  assert('출고+isFix0=미확정', !isWeekPivotLineFixed(rows[1]));
  assert('수량0은 미확정', !isWeekPivotLineFixed(rows[2]));

  console.log('\n=== isWeekPivotCellFixed (품목별) ===');
  assert('품목1 업체10 확정', isWeekPivotCellFixed(rows, 1, 10, '24-01'));
  assert('품목2 업체10 미확정', !isWeekPivotCellFixed(rows, 2, 10, '24-01'));
  assert('품목1 업체11 수량0 → 미확정', !isWeekPivotCellFixed(rows, 1, 11, '24-01'));
  assert('업체10 전체 잠금 아님(품목2)', !isWeekPivotCellFixed(rows, 2, 10, '24-01'));

  console.log('\n=== weekPivotFixState ===');
  assert('24-01 부분확정', weekPivotFixState(rows, '24-01') === 'partial');
  assert('24-02 전체확정', weekPivotFixState(rows, '24-02') === 'fixed');

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
