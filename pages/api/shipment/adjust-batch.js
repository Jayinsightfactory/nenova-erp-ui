// 붙여넣기 주문등록의 전체 추가/취소를 하나의 SQL 트랜잭션으로 처리한다.
// 실행 순서는 CANCEL 전체 -> ADD 전체이며, 어느 한 건이라도 실패하면
// ShipmentAdjustment/Order/Shipment/Date/Farm/History 변경을 전부 롤백한다.

import { withTransaction } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { withActionLog } from '../../../lib/withActionLog.js';
import {
  normalizeShipmentAdjustmentBatch,
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
    const results = await runShipmentAdjustmentBatchTransaction({
      batch,
      user: req.user,
      capabilities,
      withTransactionFn: withTransaction,
      executeEntryFn: executeShipmentAdjustmentInTransaction,
    });

    return res.status(200).json({
      success: true,
      atomic: true,
      rolledBack: false,
      orderYear: batch.orderYear,
      orderWeek: batch.orderWeek,
      committedCount: results.length,
      results,
      message: `취소 전체 후 추가 전체 ${results.length}건을 한 번에 저장했습니다.`,
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      atomic: true,
      rolledBack: true,
      committedCount: 0,
      code: error?.code,
      error: error.message,
      failedEntry: error.failedEntry ? {
        executionIndex: error.failedEntry.executionIndex,
        inputIndex: error.failedEntry.inputIndex,
        type: error.failedEntry.type,
        orderYear: batch.orderYear,
        orderWeek: batch.orderWeek,
        custKey: error.failedEntry.custKey,
        prodKey: error.failedEntry.prodKey,
      } : null,
    });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_ADJUST_BATCH',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/ShipmentAdjustment',
  riskLevel: 'HIGH',
}));
