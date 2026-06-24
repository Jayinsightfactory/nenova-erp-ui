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
    deriveStockFixStatus,
    deriveExeAlignedStatus,
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
    assert('shipment fixed stock open', pending.status === 'FIXED_PENDING_STOCK' && pending.exeAligned === false);
    assert('has warning', pending.warnings.length > 0);
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

  console.log('\n=== prodKeysNeedingRecalc ===');
  assert('skips done', JSON.stringify(prodKeysNeedingRecalc([1, 2, 3], [2])) === JSON.stringify([1, 3]));
  assert('dedupe', JSON.stringify(prodKeysNeedingRecalc([1, 1, 2], [])) === JSON.stringify([1, 2]));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
