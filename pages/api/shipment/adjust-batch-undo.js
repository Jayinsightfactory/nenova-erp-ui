// 붙여넣기 화면에서 방금 성공한 전체 일괄을 정확히 되돌린다.
// 원래 ADD는 주문+분배를 함께 감소시키고, 원래 CANCEL은 분배만 복원한다.
// 각 행의 현재값이 처리 직후 값과 다르면 전체 트랜잭션을 롤백한다.

import { withTransaction } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { withActionLog } from '../../../lib/withActionLog.js';
import { normalizePasteUndoBatch } from '../../../lib/pasteBatchUndo.js';
import { executeShipmentAdjustmentInTransaction, loadShipmentAdjustmentCapabilities } from './adjust.js';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method not allowed' });
  let batch;
  try {
    batch = normalizePasteUndoBatch(req.body);
    const capabilities = await loadShipmentAdjustmentCapabilities();
    const results = await withTransaction(async (tQ) => {
      const rows = [];
      for (const entry of batch.entries) {
        const result = await executeShipmentAdjustmentInTransaction(tQ, { body: entry.body, user: req.user, capabilities });
        rows.push({ ...result, inputIndex: entry.inputIndex, originalType: entry.originalType });
      }
      return rows;
    });
    return res.status(200).json({ success: true, atomic: true, undoneCount: results.length, results });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({
      success: false, atomic: true, rolledBack: true, undoneCount: 0, code: error.code, error: error.message,
    });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_ADJUST_BATCH_UNDO',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/ShipmentAdjustment',
  riskLevel: 'HIGH',
}));
