// node __tests__/shipmentImportApply.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const { resolveImportOrderSyncPlan } = await import('../lib/shipmentImportQty.js');

  console.log('=== resolveImportOrderSyncPlan ===');
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

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
