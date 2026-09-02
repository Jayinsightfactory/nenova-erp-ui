// 붙여넣기 주문등록의 전체 추가/취소를 하나의 SQL 트랜잭션으로 처리한다.
// 실행 순서는 CANCEL 전체 -> ADD 전체이며, 어느 한 건이라도 실패하면
// ShipmentAdjustment/Order/Shipment/Date/Farm/History 변경을 전부 롤백한다.

import { withTransaction } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { withActionLog } from '../../../lib/withActionLog.js';
import {
  normalizeShipmentAdjustmentBatch,
  isShipmentAdjustmentBatchPreflight,
  runShipmentAdjustmentBatchTransaction,
} from '../../../lib/shipmentAdjustmentBatch.js';
import {
  executeShipmentAdjustmentInTransaction,
  loadShipmentAdjustmentCapabilities,
} from './adjust.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'method not allowed' });
  }

  let batch;
  try {
    batch = normalizeShipmentAdjustmentBatch(req.body);
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      success: false,
      code: error?.code,
      error: error.message,
      rolledBack: true,
      committedCount: 0,
    });
  }

  try {
    const capabilities = await loadShipmentAdjustmentCapabilities();
    const preflightOnly = isShipmentAdjustmentBatchPreflight(req.body?.preflightOnly);
    const results = await runShipmentAdjustmentBatchTransaction({
      batch,
      user: req.user,
      capabilities,
      // 사전검증도 실제 저장 코어와 사후 원장 대조를 그대로 실행하되,
      // 성공한 트랜잭션까지 반드시 rollback하여 ERP 원장을 보존한다.
      withTransactionFn: preflightOnly
        ? (callback) => withTransaction(callback, { rollbackOnly: true })
        : withTransaction,
      executeEntryFn: executeShipmentAdjustmentInTransaction,
    });

    return res.status(200).json({
      success: true,
      verified: true,
      atomic: true,
      preflight: preflightOnly,
      rolledBack: preflightOnly,
      orderYear: batch.orderYear,
      orderWeek: batch.orderWeek,
      committedCount: preflightOnly ? 0 : results.length,
      projectedCount: results.length,
      verifiedCount: results.length,
      results,
      message: preflightOnly
        ? `취소 전체 후 추가 전체 ${results.length}건의 저장 가능 여부를 확인했습니다. ERP 원장은 변경하지 않았습니다.`
        : `취소 전체 후 추가 전체 ${results.length}건을 한 번에 저장했습니다.`,
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      atomic: true,
      rolledBack: true,
      committedCount: 0,
      code: error?.code,
      error: error.message,
      verification: error?.verification || null,
      failedEntry: error.failedEntry ? {
        executionIndex: error.failedEntry.executionIndex,
        inputIndex: error.failedEntry.inputIndex,
        type: error.failedEntry.type,
        orderYear: batch.orderYear,
        orderWeek: batch.orderWeek,
        custKey: error.failedEntry.custKey,
        prodKey: error.failedEntry.prodKey,
        custName: error.failedEntry.custName || '',
        inputName: error.failedEntry.inputName || '',
        prodName: error.failedEntry.prodName || '',
        qty: error.failedEntry.qty,
        unit: error.failedEntry.unit || '',
      } : null,
    });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_ADJUST_BATCH',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/ShipmentAdjustment',
  riskLevel: 'HIGH',
}));
