// Pivot 필터 옵션 단위 검증
// 실행: node __tests__/pivotFilterOptions.test.js

async function main() {
  const { buildPivotDimensionOptions, buildWeekPivotDimensionOptions } = await import('../lib/pivotFilterOptions.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  const rows = [
    { country: '콜롬비아', flower: '장미', prodName: 'Red' },
    { country: '콜롬비아', flower: '장미', prodName: 'Pink' },
    { country: '콜롬비아', flower: '수국', prodName: 'White' },
    { country: '에콰도르', flower: '장미', prodName: 'Yellow' },
  ];

  console.log('=== buildPivotDimensionOptions ===');
  const all = buildPivotDimensionOptions(rows, {});
  assert('국가 2개', all.countryOptions.length === 2);
  assert('꽃 2개', all.flowerOptions.length === 2);

  const co = buildPivotDimensionOptions(rows, { country: ['콜롬비아'] });
  assert('콜롬비아 꽃=장미+수국', co.flowerOptions.join(',') === '수국,장미');
  assert('콜롬비아+장미 품목 2개', buildPivotDimensionOptions(rows, { country: ['콜롬비아'], flower: ['장미'] }).prodNameOptions.length === 2);

  console.log('\n=== pruneDimensionFilters ===');
  const { pruneDimensionFilters, pruneFieldFilters } = await import('../lib/pivotFilterOptions.js');
  const nlRows = [
    { country: '네덜란드', flower: '튤립', prodName: 'A' },
    { country: '네덜란드', flower: '스키미아', prodName: 'B' },
    { country: '네덜란드', flower: '아가판서스', prodName: 'C' },
  ];
  const stale = pruneDimensionFilters({
    country: ['네덜란드'],
    flower: ['스키미아', '아가판서스', '안시리움'],
  }, nlRows);
  assert('stale flower pruned', stale.flower?.join(',') === '스키미아,아가판서스');
  const ff = pruneFieldFilters({ custName: ['없는업체', '콜롬비아상사'] }, rows, [{ custName: '콜롬비아상사' }]);
  assert('invalid cust removed', ff.custName?.join(',') === '콜롬비아상사');

  console.log('\n=== buildWeekPivotDimensionOptions ===');
  const wrows = [
    { ProdKey: 1, CounName: '콜롬비아', FlowerName: '장미' },
    { ProdKey: 1, CounName: '콜롬비아', FlowerName: '장미' },
    { ProdKey: 2, CounName: '콜롬비아', FlowerName: '수국' },
  ];
  const wd = buildWeekPivotDimensionOptions(wrows, '');
  assert('품목 distinct 국가', wd.countries.length === 1);
  assert('전체 꽃 2개', wd.flowers.length === 2);
  const wd2 = buildWeekPivotDimensionOptions(wrows, '콜롬비아');
  assert('콜롬비아 꽃만', wd2.flowers.length === 2);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
