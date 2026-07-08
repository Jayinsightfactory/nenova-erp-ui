// node __tests__/shipmentImportApply.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    resolveImportOrderSyncPlan,
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
    assert('엑셀누락 → skip_keep_order', p.action === 'skip_keep_order' && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 0, uploadQty: 5 });
    assert('신규 → sync', p.action === 'sync');
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 0, cleanupZeroOrder: true });
    assert('잔재정리 ON + 엑셀0 → sync, 삭제허용', p.action === 'sync' && p.allowOrderDelete === true);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 0, uploadQty: 0, cleanupZeroOrder: true });
    assert('잔재정리 ON + 둘다0 → skip', p.action === 'skip' && !p.allowOrderDelete);
  }
  {
    const p = resolveImportOrderSyncPlan({ orderQty: 10, uploadQty: 8, cleanupZeroOrder: true });
    assert('잔재정리 ON + 엑셀>0 → sync, 삭제금지 유지', p.action === 'sync' && !p.allowOrderDelete);
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
