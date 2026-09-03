// node __tests__/shipmentImportApply.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    resolveImportOrderSyncPlan,
    resolveImportWriteIntent,
    evaluateImportFinalStateStale,
    importProductOverrideKey,
    classifyImportUnmatchedReason,
    isShipmentImportVerificationSuccessful,
  } = await import('../lib/shipmentImportQty.js');

  console.log('=== importProductOverrideKey / classify ===');
  assert('품목키', importProductOverrideKey({ sheetName: '2301장미', productLabel: 'Freedom', productFamily: 'rose' }).includes('freedom'));
  assert('업체+품목', classifyImportUnmatchedReason(false, false).matchKind === 'both');
  assert('품목만', classifyImportUnmatchedReason(true, false).matchKind === 'product');
  assert('업체만', classifyImportUnmatchedReason(false, true).matchKind === 'customer');

  console.log('\n=== resolveImportOrderSyncPlan ===');
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 10, hasExistingOrder: true });
    assert('기존 주문=엑셀 → 주문보존', p.action === 'skip_keep_order' && p.preservesExistingOrder);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 8, hasExistingOrder: true });
    assert('기존 주문≠엑셀이어도 주문보존', p.action === 'skip_keep_order' && p.preservesExistingOrder && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 0, hasExistingOrder: true });
    assert('0·빈칸·엑셀누락 → 주문보존', p.action === 'skip_keep_order' && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 0, uploadQty: 5, hasExistingOrder: false });
    assert('주문 없음 + 양수 분배 → 주문 신규', p.action === 'create');
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 0, uploadQty: 0, hasExistingOrder: false });
    assert('주문 없음 + 0 분배 → 주문 생성 안 함', p.action === 'skip_no_order');
  }

  console.log('\n=== resolveImportWriteIntent ===');
  {
    const p = resolveImportWriteIntent({ uploadQty: 0, hasExistingShipment: false });
    assert('재고 요약값이 아닌 uploadQty만 수량 원천', p.source === 'uploadQty' && p.stockQtyIgnored === true);
    assert('0수량·기존분배 없음 → 신규 분배 금지', !p.shouldCreateShipment && !p.shouldDeleteShipment);
  }

  console.log('\n=== evaluateImportFinalStateStale ===');
  {
    const p = evaluateImportFinalStateStale({
      previewOrderQty: 4, currentOrderQty: 8, intendedOrderQty: 8,
      previewShipmentQty: 4, currentShipmentQty: 4, intendedShipmentQty: 8,
    });
    assert('주문 4→8이 목표 8에 이미 도달하면 허용', !p.orderBlocked && p.orderAlreadyAtTarget);
    assert('분배는 기존 4에서 목표 8로 적용 가능', !p.shipmentBlocked && !p.shipmentAlreadyAtTarget);
  }
  {
    const p = evaluateImportFinalStateStale({
      previewOrderQty: 4, currentOrderQty: 8, intendedOrderQty: 8,
      previewShipmentQty: 4, currentShipmentQty: 8, intendedShipmentQty: 8,
    });
    assert('주문·분배 모두 목표값이면 전체 멱등 no-op 후보', !p.orderBlocked && !p.shipmentBlocked && p.orderAlreadyAtTarget && p.shipmentAlreadyAtTarget);
  }
  {
    const p = evaluateImportFinalStateStale({
      previewOrderQty: 4, currentOrderQty: 6, intendedOrderQty: 8, preserveOrder: true,
      previewShipmentQty: 4, currentShipmentQty: 4, intendedShipmentQty: 8,
    });
    assert('기존 주문이 제3값 6으로 바뀌어도 주문보존·분배 적용', !p.orderBlocked);
  }
  {
    const p = evaluateImportFinalStateStale({
      previewOrderQty: 4, currentOrderQty: 4, intendedOrderQty: 8,
      previewShipmentQty: 4, currentShipmentQty: 6, intendedShipmentQty: 8,
    });
    assert('분배가 목표가 아닌 제3값 6이면 전체 차단', p.shipmentBlocked);
  }
  {
    const p = evaluateImportFinalStateStale({
      previewOrderQty: 4, currentOrderQty: 8, intendedOrderQty: 0, preserveOrder: true,
      previewShipmentQty: 4, currentShipmentQty: 0, intendedShipmentQty: 0,
    });
    assert('0·빈칸·누락은 변경된 주문을 보존하고 이미 0인 분배를 허용', !p.orderBlocked && !p.shipmentBlocked && p.shipmentAlreadyAtTarget);
  }
  {
    const p = evaluateImportFinalStateStale({
      previewOrderQty: 4, currentOrderQty: 8, intendedOrderQty: 0, preserveOrder: true,
      previewShipmentQty: 4, currentShipmentQty: 2, intendedShipmentQty: 0,
    });
    assert('주문 보존 행도 분배가 제3값이면 전체 차단', !p.orderBlocked && p.shipmentBlocked);
  }
  {
    const p = resolveImportWriteIntent({ uploadQty: 5, hasExistingShipment: false });
    assert('양수·기존분배 없음 → 분배 신규', p.shouldCreateShipment && !p.shouldUpdateShipment);
  }
  {
    const p = resolveImportWriteIntent({ uploadQty: 8, hasExistingShipment: true, hasExistingOrder: true });
    assert('기존 주문 있음 → 분배만 변경하고 주문은 보존', p.shouldUpdateShipment && !p.shouldCreateOrUpdateOrder);
  }
  {
    const p = resolveImportWriteIntent({ uploadQty: 0, hasExistingShipment: true });
    assert('0·빈칸·엑셀누락 + 기존분배 → 주문 생성/수정 없이 분배 삭제', p.shouldDeleteShipment && !p.shouldCreateOrUpdateOrder);
  }

  console.log('\n=== post-commit verification success ===');
  assert('전건 일치만 성공', isShipmentImportVerificationSuccessful({ mismatchCount: 0 }));
  assert('불일치는 성공 아님', !isShipmentImportVerificationSuccessful({ mismatchCount: 1 }));
  assert('재조회 오류도 성공 아님', !isShipmentImportVerificationSuccessful({ mismatchCount: 0, error: 'timeout' }));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
