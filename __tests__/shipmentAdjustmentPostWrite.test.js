const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const {
    evaluateShipmentAdjustmentPostWrite,
    evaluateOrderRegistrationPostWrite,
  } = await import('../lib/shipmentAdjustmentPostWrite.js');

  const valid = evaluateShipmentAdjustmentPostWrite({
    expectedOrderOut: 12,
    expectedShipmentOut: 10,
    facts: {
      rawOrderCount: 1, rawOrderQty: 12,
      viewOrderCount: 1, viewOrderQty: 12,
      rawShipmentCount: 1, rawShipmentQty: 10,
      shipmentCustomerMismatch: 0,
      viewShipmentCount: 1, viewShipmentQty: 10,
      shipmentDateCount: 2, shipmentDateQty: 10,
    },
  });
  assert.equal(valid.verified, true, 'raw 원장·EXE 뷰·출고일 합계가 모두 맞아야 검증 완료다.');

  const hiddenFromExe = evaluateShipmentAdjustmentPostWrite({
    expectedOrderOut: 12,
    expectedShipmentOut: 10,
    facts: {
      rawOrderCount: 1, rawOrderQty: 12,
      viewOrderCount: 0, viewOrderQty: 0,
      rawShipmentCount: 1, rawShipmentQty: 10,
      shipmentCustomerMismatch: 0,
      viewShipmentCount: 1, viewShipmentQty: 10,
      shipmentDateCount: 1, shipmentDateQty: 10,
    },
  });
  assert.equal(hiddenFromExe.verified, false);
  assert.ok(hiddenFromExe.mismatches.some(row => row.key === 'view-order-count'));

  const dateMismatch = evaluateShipmentAdjustmentPostWrite({
    expectedOrderOut: 12,
    expectedShipmentOut: 10,
    facts: {
      rawOrderCount: 1, rawOrderQty: 12,
      viewOrderCount: 1, viewOrderQty: 12,
      rawShipmentCount: 1, rawShipmentQty: 10,
      shipmentCustomerMismatch: 0,
      viewShipmentCount: 1, viewShipmentQty: 10,
      shipmentDateCount: 1, shipmentDateQty: 9,
    },
  });
  assert.equal(dateMismatch.verified, false);
  assert.ok(dateMismatch.mismatches.some(row => row.key === 'shipment-date-qty'));

  const cancelled = evaluateShipmentAdjustmentPostWrite({
    expectedOrderOut: 5,
    expectedShipmentOut: 0,
    facts: {
      rawOrderCount: 1, rawOrderQty: 5,
      viewOrderCount: 1, viewOrderQty: 5,
      rawShipmentCount: 0, rawShipmentQty: 0,
      shipmentCustomerMismatch: 0,
      viewShipmentCount: 0, viewShipmentQty: 0,
      shipmentDateCount: 0, shipmentDateQty: 0,
    },
  });
  assert.equal(cancelled.verified, true, '분배 취소는 주문을 보존하고 분배·출고일만 0이어야 한다.');

  const duplicate = evaluateOrderRegistrationPostWrite({
    expectedOrderOut: 4,
    facts: { rawOrderCount: 2, rawOrderQty: 8, viewOrderCount: 2, viewOrderQty: 8 },
  });
  assert.equal(duplicate.verified, false, '같은 연도·차수·업체·품목 주문 중복행은 성공 처리하면 안 된다.');

  const zeroOrder = evaluateOrderRegistrationPostWrite({
    expectedOrderOut: 0,
    facts: { rawOrderCount: 0, rawOrderQty: 0, viewOrderCount: 0, viewOrderQty: 0 },
  });
  assert.equal(zeroOrder.verified, true);

  const adjustSource = fs.readFileSync('pages/api/shipment/adjust.js', 'utf8');
  const orderSource = fs.readFileSync('pages/api/orders/index.js', 'utf8');
  const pasteSource = fs.readFileSync('pages/orders/paste.js', 'utf8');
  const batchSource = fs.readFileSync('lib/shipmentAdjustmentBatch.js', 'utf8');
  assert.match(adjustSource, /ViewOrder[\s\S]*ViewShipment[\s\S]*ShipmentDate/);
  assert.doesNotMatch(adjustSource, /\bAS\s+RowCount\b|\.RowCount\b/,
    'MSSQL 예약어 ROWCOUNT를 저장 후 검증 SQL 별칭으로 사용하면 안 된다.');
  assert.doesNotMatch(orderSource, /\bAS\s+RowCount\b|\.RowCount\b/,
    '주문 저장 후 검증 SQL도 MSSQL 예약어 ROWCOUNT 별칭을 사용하면 안 된다.');
  assert.match(adjustSource, /AS RecordCount/);
  assert.match(orderSource, /AS RecordCount/);
  assert.match(adjustSource, /postWriteVerification = await verifyShipmentAdjustmentPostWrite/);
  assert.match(orderSource, /postWriteVerification = await verifyCreatedOrdersInTransaction/);
  assert.match(orderSource, /success: true,[\s\S]*verified: true/);
  assert.match(batchSource, /attemptResults\.some\(\(result\) => result\?\.verified !== true\)/);

  const perCustomerStart = pasteSource.indexOf('const handleBulkDistribute = async');
  const perCustomerEnd = pasteSource.indexOf('const handleAllMixedDistribute = async');
  const perCustomerSource = pasteSource.slice(perCustomerStart, perCustomerEnd);
  assert.match(perCustomerSource, /fetch\('\/api\/shipment\/adjust-batch'/,
    '업체별 일괄 처리도 단일 트랜잭션 API를 사용해야 한다.');
  assert.doesNotMatch(perCustomerSource, /fetch\('\/api\/shipment\/adjust'/,
    '업체별 품목을 한 건씩 저장해 부분 성공을 만들면 안 된다.');
  assert.match(pasteSource, /result\.success !== true \|\| result\.verified !== true/);
  assert.match(pasteSource, /j\.success !== true \|\| j\.verified !== true/);
  assert.match(pasteSource, /missingResults\.length > 0/);
  assert.match(pasteSource, /d\.success && d\.verified === true/);

  console.log('shipment/order post-write verification tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
