// node __tests__/shipmentImportAudit.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    shipmentImportAuditMode,
    summarizeShipmentImportResult,
    attachShipmentImportVerification,
  } = await import('../lib/shipmentImportAudit.js');
  const {
    extractActionLogAffectedCount,
    buildActionLogResultDesc,
  } = await import('../lib/withActionLog.js');

  console.log('=== shipmentImportAudit ===');
  assert('기본 모드는 주문+분배', shipmentImportAuditMode() === 'ORDER_AND_SHIPMENT');
  assert('shipmentOnly 모드 기록', shipmentImportAuditMode({ shipmentOnly: true }) === 'SHIPMENT_ONLY');

  const rows = [
    { custKey: 1, prodKey: 10, shipmentAction: '분배신규', rowStatus: 'APPLIED' },
    { custKey: 1, prodKey: 11, shipmentAction: '분배수정', rowStatus: 'APPLIED' },
    { custKey: 1, prodKey: 12, shipmentAction: '분배삭제', rowStatus: 'APPLIED' },
    { custKey: 1, prodKey: 13, shipmentAction: '확정차단', rowStatus: 'FIXED_BLOCKED' },
  ];
  const summary = summarizeShipmentImportResult({
    inputRowCount: 4,
    targetRowCount: 4,
    appliedCount: 3,
    skippedFixedCount: 1,
    orderCreatedCount: 1,
    verification: { checked: 3, matched: 2, mismatchCount: 1 },
  }, rows);
  assert('분배 신규/수정/삭제 집계', summary.shipmentCreatedCount === 1 && summary.shipmentUpdatedCount === 1 && summary.shipmentDeletedCount === 1);
  assert('사후검증 집계', summary.verificationChecked === 3 && summary.verificationMismatchCount === 1);

  attachShipmentImportVerification(rows, {
    checked: 3,
    matched: 2,
    mismatchCount: 1,
    mismatches: [{ custKey: 1, prodKey: 11, reason: '실제 수량 불일치' }],
  });
  assert('검증 일치 상태 연결', rows[0].verificationStatus === 'MATCHED');
  assert('검증 불일치 상태 연결', rows[1].verificationStatus === 'MISMATCH');
  assert('확정차단은 검증 제외', rows[3].verificationStatus === 'SKIPPED');

  assert('SystemActionLog에 appliedCount 0도 보존', extractActionLogAffectedCount({ appliedCount: 0, shipmentChangedCount: 9 }, 4) === 0);
  assert('SystemActionLog 결과요약에 감사키 포함', buildActionLogResultDesc({ week: '29-02', auditBatchKey: 7, appliedCount: 3 }).includes('audit=7'));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
