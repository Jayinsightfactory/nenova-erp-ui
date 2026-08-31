import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { applyImportRows } from '../../../lib/shipmentImport';
import { initApplyProgress, progressStep, finishApplyProgress } from '../../../lib/importApplyProgress';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const jobId = String(req.body?.jobId || '').slice(0, 80);
  try {
    if (req.body?.shipmentOnly) {
      const error = new Error('파일 전체를 주문과 무관하게 분배만 바꾸는 모드는 사용할 수 없습니다. 양수는 주문·분배를 함께 맞추고, 0·빈칸·행누락만 주문을 보존한 채 분배 0으로 처리합니다.');
      error.code = 'SHIPMENT_ONLY_NOT_ALLOWED';
      error.statusCode = 400;
      throw error;
    }
    if (jobId) initApplyProgress(jobId, (req.body?.rows || []).length);
    const result = await applyImportRows({
      rawWeek: req.body?.week,
      rawYear: req.body?.year,
      rows: req.body?.rows,
      user: req.user,
      ackQtyWarnings: !!req.body?.ackQtyWarnings,
      shipmentOnly: false,
      onProgress: jobId ? (patch => progressStep(jobId, patch)) : null,
    });
    if (jobId) finishApplyProgress(jobId, { log: '적용 완료' });
    return res.status(200).json(result);
  } catch (e) {
    if (jobId) finishApplyProgress(jobId, { failed: true, log: `오류: ${e.message}` });
    if (e.code === 'QTY_WARNING') {
      return res.status(409).json({
        success: false,
        error: e.message,
        code: e.code,
        qtyWarnings: e.qtyWarnings,
      });
    }
    if (e.statusCode) {
      return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    }
    return res.status(500).json({ success: false, error: e.message, code: e.code });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_IMPORT_APPLY',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate',
  riskLevel: 'HIGH',
}));
