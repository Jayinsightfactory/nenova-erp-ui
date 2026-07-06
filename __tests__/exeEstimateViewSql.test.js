// nenova.exe FormEstimateView SQL helpers
// 실행: node __tests__/exeEstimateViewSql.test.js

async function main() {
  const {
    EXE_WEEKDAY_CODE_KR,
    buildEstimateOrderYearWeek,
    activeWdKrToExeSqlIn,
    sqlEstimateGetData,
    sqlEstimateGetDetail,
    sqlEstimateGetPrintDetail,
    filterItemsByExeWeekDay,
    mapExeDetailRowToWebItem,
  } = await import('../lib/exeEstimateViewSql.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else {
      fail++;
      console.log(`  ✗ ${label}`);
    }
  };

  console.log('=== EXE_WEEKDAY_CODE_KR ===');
  assert('월=2', EXE_WEEKDAY_CODE_KR.월 === 2);
  assert('일=1', EXE_WEEKDAY_CODE_KR.일 === 1);
  assert('토=7', EXE_WEEKDAY_CODE_KR.토 === 7);

  console.log('\n=== buildEstimateOrderYearWeek ===');
  assert('2026+26 → 202626', buildEstimateOrderYearWeek(2026, '26') === '202626');
  assert('2026+26-01 → 202626', buildEstimateOrderYearWeek(2026, '26-01') === '202626');

  console.log('\n=== activeWdKrToExeSqlIn ===');
  assert('null → 전체', activeWdKrToExeSqlIn(null) === '1,2,3,4,5,6,7');
  assert('7일 → 전체', activeWdKrToExeSqlIn(['월', '화', '수', '목', '금', '토', '일']) === '1,2,3,4,5,6,7');
  assert('월,화 → 2,3', activeWdKrToExeSqlIn(['월', '화']) === '2,3');
  assert('빈 배열 → 0', activeWdKrToExeSqlIn([]) === '0');

  console.log('\n=== sqlEstimateGetData ===');
  const getData = sqlEstimateGetData({ orderYearWeek: '202626', custKey: 42, weekDayIn: '2,3,4,5,6,7,1' });
  assert('sd.isFix=1', getData.includes('sd.isFix = 1'));
  assert('OrderMaster JOIN', getData.includes('JOIN OrderMaster om'));
  assert('EstQuantity > 0', getData.includes('sdd.EstQuantity > 0'));
  assert('custKey param', getData.includes('@custKey'));
  assert('Estimate UNION', getData.includes('FROM Estimate e'));

  console.log('\n=== sqlEstimateGetDetail ===');
  const getDetail = sqlEstimateGetDetail({ orderYearWeek: '202626', custKey: 42 });
  assert('ViewShipment', getDetail.includes('FROM ViewShipment vs'));
  assert('DetailFix=1', getDetail.includes('vs.DetailFix = 1'));
  assert('no WeekDay IN in CTE', !getDetail.match(/WITH list[\s\S]*WeekDay IN/));
  assert('ProductSort', getDetail.includes('ProductSort'));
  assert('UnitQuantity', getDetail.includes('UnitQuantity'));

  console.log('\n=== sqlEstimateGetPrintDetail ===');
  const getPrint = sqlEstimateGetPrintDetail({ orderYearWeek: '202626', custKey: 42, weekDayIn: '2,3' });
  assert('print WeekDay IN', getPrint.includes('pd.WeekDay IN (2,3)'));
  assert('GROUP BY ProdKey', getPrint.includes('GROUP BY vs.ProdKey'));

  console.log('\n=== filterItemsByExeWeekDay ===');
  const sample = [
    { WeekDay: 2, ProdName: 'A', _exeParity: true },
    { WeekDay: 5, ProdName: 'B', _exeParity: true },
  ];
  assert('월만 1건', filterItemsByExeWeekDay(sample, ['월']).length === 1);

  console.log('\n=== mapExeDetailRowToWebItem ===');
  const shipRow = mapExeDetailRowToWebItem({
    Sort: 0,
    ProdName: 'ROSE Red',
    EstQuantity: 10,
    Cost: 100,
    Amount: 1000,
    Vat: 100,
    ShipmentDtm: new Date('2026-06-15'),
    DetailKey: 99,
    ShipmentKey: 1,
    ProdKey: 5,
  });
  assert('정상출고', shipRow.EstimateType === '정상출고');
  assert('SdateKey', shipRow.SdateKey === 99);
  assert('_exeParity', shipRow._exeParity === true);

  const dedRow = mapExeDetailRowToWebItem({
    Sort: 1,
    EstimateTypeRaw: '불량차감',
    ProdName: '[불량차감] ROSE',
    EstQuantity: -2,
    DetailKey: 77,
    EstimateKey: 77,
  });
  assert('차감 타입', dedRow.EstimateType === '불량차감');
  assert('EstimateKey', dedRow.EstimateKey === 77);

  console.log(`\n=== 결과: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
