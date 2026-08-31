import { withAuth } from '../../../lib/auth.js';
import { withActionLog } from '../../../lib/withActionLog.js';
import { isAdminUser } from '../../../lib/userAccess.js';
import { rollbackShipmentImportBatch } from '../../../lib/shipmentImportRollback.js';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, code: 'SHIPMENT_IMPORT_ROLLBACK_FORBIDDEN', error: '업로드 전체 되돌리기는 관리자만 실행할 수 있습니다.' });
  }
  const auditKey = Number(req.body?.auditKey);
  if (!Number.isInteger(auditKey) || auditKey <= 0) return res.status(400).json({ success: false, error: '되돌릴 업로드 이력을 선택하세요.' });
  try {
    const result = await rollbackShipmentImportBatch({
      auditKey,
      actor: req.user?.userId || 'system',
      reason: String(req.body?.reason || '').trim(),
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, error: error.message, conflicts: error.conflicts || [] });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_IMPORT_ROLLBACK',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm',
  riskLevel: 'HIGH',
}));
