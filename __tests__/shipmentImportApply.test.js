// node __tests__/shipmentImportApply.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    resolveImportOrderSyncPlan,
    resolveImportWriteIntent,
    importProductOverrideKey,
    classifyImportUnmatchedReason,
  } = await import('../lib/shipmentImportQty.js');

  console.log('=== importProductOverrideKey / classify ===');
  assert('품목키', importProductOverrideKey({ sheetName: '2301장미', productLabel: 'Freedom', productFamily: 'rose' }).includes('freedom'));
  assert('업체+품목', classifyImportUnmatchedReason(false, false).matchKind === 'both');
  assert('품목만', classifyImportUnmatchedReason(true, false).matchKind === 'product');
  assert('업체만', classifyImportUnmatchedReason(false, true).matchKind === 'customer');

  console.log('\n=== resolveImportOrderSyncPlan ===');
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 10 });
    assert('주문=엑셀 → skip', p.action === 'skip' && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 8 });
    assert('주문≠엑셀(>0) → sync, 삭제금지', p.action === 'sync' && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 0 });
    assert('0·빈칸·엑셀누락 → 주문보존', p.action === 'skip_keep_order' && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 0, uploadQty: 5 });
    assert('신규 → sync', p.action === 'sync');
  }

  console.log('\n=== resolveImportWriteIntent ===');
  {
    const p = resolveImportWriteIntent({ uploadQty: 0, hasExistingShipment: false });
    assert('재고 요약값이 아닌 uploadQty만 수량 원천', p.source === 'uploadQty' && p.stockQtyIgnored === true);
    assert('0수량·기존분배 없음 → 신규 분배 금지', !p.shouldCreateShipment && !p.shouldDeleteShipment);
  }
  {
    const p = resolveImportWriteIntent({ uploadQty: 5, hasExistingShipment: false });
    assert('양수·기존분배 없음 → 분배 신규', p.shouldCreateShipment && !p.shouldUpdateShipment);
  }
  {
    const p = resolveImportWriteIntent({ uploadQty: 0, hasExistingShipment: true });
    assert('0·빈칸·엑셀누락 + 기존분배 → 주문 생성/수정 없이 분배 삭제', p.shouldDeleteShipment && !p.shouldCreateOrUpdateOrder);
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
