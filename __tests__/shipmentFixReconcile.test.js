// node __tests__/shipmentFixReconcile.test.js

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
    deriveShipmentDetailStatus,
    deriveExeAlignedStatus,
    sqlRound0,
    shipmentFixWeekRemain,
    isShipmentFixRemainNegative,
    isDoubleCountStaleSnapshot,
    prodKeysNeedingRecalc,
  } = await import('../lib/shipmentFixReconcile.js');

  console.log('=== deriveShipmentDetailStatus ===');
  assert('NO_SHIPMENT', deriveShipmentDetailStatus({ detailCount: 0 }) === 'NO_SHIPMENT');
  assert('FIXED', deriveShipmentDetailStatus({ detailCount: 10, unfixedDetailCount: 0 }) === 'FIXED');
  assert('PARTIAL', deriveShipmentDetailStatus({ detailCount: 10, fixedDetailCount: 3, unfixedDetailCount: 7 }) === 'PARTIAL');

  console.log('\n=== deriveExeAlignedStatus ===');
  {
    const ok = deriveExeAlignedStatus({
      shipmentStatus: 'FIXED',
      stockFixStatus: 'FIXED',
      negativeLiveCount: 0,
      masterDetailMismatchCount: 0,
    });
    assert('fully aligned', ok.exeAligned === true && ok.status === 'FIXED');
  }
  {
    const pending = deriveExeAlignedStatus({
      shipmentStatus: 'FIXED',
      stockFixStatus: 'OPEN',
      negativeLiveCount: 0,
      masterDetailMismatchCount: 0,
    });
    assert('StockMaster marker does not block EXE shipment parity', pending.status === 'FIXED' && pending.exeAligned === true);
    assert('no false stock closing warning', pending.warnings.length === 0);
  }
  {
    const neg = deriveExeAlignedStatus({
      shipmentStatus: 'FIXED',
      stockFixStatus: 'FIXED',
      negativeLiveCount: 3,
      masterDetailMismatchCount: 0,
    });
    assert('negative stock blocks exe', neg.exeAligned === false);
  }

  console.log('\n=== isDoubleCountStaleSnapshot ===');
  assert('문라이트 스냅샷 1.2 / 출고 142.8 / 주간잔량 +3.7 은 stale', isDoubleCountStaleSnapshot({
    productStock: 1.2, unfixedOut: 142.8, weekRemain: 3.7,
  }) === true);
  assert('주간잔량 -5처럼 진짜 부족은 stale 아님', isDoubleCountStaleSnapshot({
    productStock: 0, unfixedOut: 10, weekRemain: -5,
  }) === false);
  assert('기말 스냅샷이 출고를 아직 안 뺀 정상 미확정은 stale 아님', isDoubleCountStaleSnapshot({
    productStock: 84, unfixedOut: 84.27, weekRemain: 1,
  }) === false);

  console.log('\n=== prodKeysNeedingRecalc ===');
  assert('skips done', JSON.stringify(prodKeysNeedingRecalc([1, 2, 3], [2])) === JSON.stringify([1, 3]));
  assert('dedupe', JSON.stringify(prodKeysNeedingRecalc([1, 1, 2], [])) === JSON.stringify([1, 2]));

  console.log('\n=== isShipmentFixRemainNegative (2026-08-20 SP) ===');
  assert('SQL ROUND(-0.33,0)=0 이라 Zurigo 실부족 -0.33 은 통과', isShipmentFixRemainNegative({
    prevStock: 0, warehouseQty: 4, confirmedOut: 0, stockTypeAdj: 0, unfixedOut: 4.33,
  }) === false);
  assert('문라이트 주간잔량 +3.7 은 통과', isShipmentFixRemainNegative({
    prevStock: 1.2, warehouseQty: 145.3, confirmedOut: 0, stockTypeAdj: 0, unfixedOut: 142.8,
  }) === false);
  assert('진짜 부족 -0.6 은 차단', isShipmentFixRemainNegative({
    prevStock: 0, warehouseQty: 1, confirmedOut: 0, stockTypeAdj: 0, unfixedOut: 1.6,
  }) === true);
  assert('교차연도: 2025 33-01 스냅샷을 2026 33-01 이월로 쓰지 않음', shipmentFixWeekRemain({
    prevStock: 0,
    warehouseQty: 4,
    confirmedOut: 0,
    unfixedOut: 4,
  }) === 0);
  assert('sqlRound0 는 음수 0.5를 0이 아니라 -1', sqlRound0(-0.5) === -1);

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
