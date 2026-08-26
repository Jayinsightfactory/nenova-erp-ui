// 견적서 단가 스냅샷/재기준 순수 함수 검증
// 실행: node __tests__/estimateCostSnapshot.test.js

async function main() {
  const { buildCostSnapshot, rebaseCostItemsFromSaved, STALE_COST_MESSAGE } = await import('../lib/estimateCostSnapshot.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  console.log('=== buildCostSnapshot ===');
  const zeroDateCost = buildCostSnapshot({ sdateKey: 1, DateCost: 0, Cost: 11400 });
  assert('DateCost=0은 표시값 11400으로 대체되지 않음', zeroDateCost.expectedOldCost === 0);
  assert('DateCost=0도 sdateKey 유지', zeroDateCost.sdateKey === 1);

  const differing = buildCostSnapshot({ sdateKey: 2, DateCost: 9000, Cost: 11400 });
  assert('DateCost!=Cost일 때 DateCost를 기준값으로 사용', differing.expectedOldCost === 9000);

  const noDate = buildCostSnapshot({ sdateKey: null, Cost: 11400 });
  assert('sdateKey 없으면 Cost 사용', noDate.expectedOldCost === 11400 && noDate.sdateKey === null);

  const missingDateCost = buildCostSnapshot({ sdateKey: 3, DateCost: undefined, Cost: 11400 });
  assert('sdateKey가 있는데 DateCost가 없으면 Cost로 대체하지 않고 null 반환', missingDateCost === null);

  const nanDateCost = buildCostSnapshot({ sdateKey: 4, DateCost: NaN, Cost: 11400 });
  assert('DateCost가 NaN이어도 표시값으로 폴백하지 않음', nanDateCost === null);
  assert('날짜 원단가 null은 0으로 추정하지 않음', buildCostSnapshot({ SdateKey: 4, DateCost: null, Cost: 11400 }) === null);
  assert('날짜 원단가 빈문자열은 0으로 추정하지 않음', buildCostSnapshot({ SdateKey: 4, DateCost: '', Cost: 11400 }) === null);

  console.log('=== rebaseCostItemsFromSaved ===');
  const costItems = [
    { sdateKey: 10, sdetailKey: 100, cost: 12000, expectedOldCost: 11000 },
    { sdateKey: 11, sdetailKey: 101, cost: 13000, expectedOldCost: 11400 },
    { sdateKey: 12, sdetailKey: 102, cost: 9000, expectedOldCost: 8000 },
    { sdateKey: 99, sdetailKey: 999, cost: 5000, expectedOldCost: 4000 },
  ];
  const savedResults = [
    { sdateKey: 10, sdetailKey: 100, dateDeleted: false, dateCostAfter: 11000, detailCostAfter: 11000 },
    { sdateKey: 11, sdetailKey: 101, dateDeleted: true, dateCostAfter: null, detailCostAfter: 11400 },
    { sdetailKey: 102, purged: true },
  ];
  const rebased = rebaseCostItemsFromSaved(costItems, savedResults);
  const bySdateKey = new Map(rebased.items.map((it) => [it.sdateKey, it]));

  assert('같은 sdateKey로 수량저장된 날짜는 살아남아 dateCostAfter를 기준값으로 사용',
    bySdateKey.get(10) && bySdateKey.get(10).expectedOldCost === 11000);
  assert('날짜만 삭제되면 sdateKey를 버리고 detailCostAfter를 기준값으로 사용',
    rebased.items.some((it) => it.sdateKey === undefined && it.sdetailKey === 101 && it.expectedOldCost === 11400));
  assert('상세 purge는 같은 SdetailKey의 costItem을 모두 제거', !rebased.items.some((it) => it.sdetailKey === 102));
  assert('purge된 항목은 skipped로 집계', rebased.skipped === 1);
  assert('이번 배치에서 다루지 않은 날짜는 원래 스냅샷 유지',
    bySdateKey.get(99) && bySdateKey.get(99).expectedOldCost === 4000);
  assert('실패 없으면 ok=true', rebased.ok === true && rebased.failed === 0);

  const missingBaselineSaved = [
    { sdateKey: 10, sdetailKey: 100, dateDeleted: false, dateCostAfter: null, detailCostAfter: null },
  ];
  const missingBaselineRebase = rebaseCostItemsFromSaved(
    [{ sdateKey: 10, sdetailKey: 100, cost: 12000, expectedOldCost: 11000 }],
    missingBaselineSaved,
  );
  assert('기준값이 없으면 추정하지 않고 실패로 집계', missingBaselineRebase.failed === 1 && missingBaselineRebase.ok === false);
  assert('실패한 항목은 결과 목록에서 제외', missingBaselineRebase.items.length === 0);
  assert('실패 메시지 상수가 정의됨', typeof STALE_COST_MESSAGE === 'string' && STALE_COST_MESSAGE.length > 0);
  assert('성공한 수량 응답이 누락되면 기존값으로 저장하지 않음',
    !rebaseCostItemsFromSaved([costItems[0]], [], [10]).ok);
  assert('다른 상세 응답으로 단가 검증값을 바꾸지 않음',
    !rebaseCostItemsFromSaved([costItems[0]], [{ sdateKey: 10, sdetailKey: 999, dateDeleted: false, dateCostAfter: 11000 }]).ok);
  assert('상세 전체 삭제는 형제 날짜 단가도 제외',
    rebaseCostItemsFromSaved([{ sdetailKey: 102, sdateKey: 15, cost: 100 }], [{ sdetailKey: 102, purged: true }]).skipped === 1);
  assert('단가0은 성공 응답에서도 보존',
    rebaseCostItemsFromSaved([costItems[0]], [{ sdateKey: 10, sdetailKey: 100, dateDeleted: false, dateCostAfter: 0 }]).items[0].expectedOldCost === 0);
  assert('새 가격은 성공 응답 검증값과 별도로 보존', rebased.items[0].cost === 12000);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
