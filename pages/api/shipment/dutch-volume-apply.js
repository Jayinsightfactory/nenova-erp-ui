import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { applyImportRows } from '../../../lib/shipmentImport';
import { claimDutchPlan, finishDutchPlan, dutchError } from '../../../lib/dutchVolumeDistribution';
import { initApplyProgress, progressStep, finishApplyProgress, hasApplyProgress } from '../../../lib/importApplyProgress';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export async function applyDutchVolume(body, user, deps = {}) {
  const apply = deps.applyImportRows || applyImportRows;
  const claim = deps.claimPlan || claimDutchPlan;
  const token = String(body?.planToken || '');
  const jobId = String(body?.jobId || '').trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(jobId)) throw dutchError('INVALID_JOB_ID', '새 작업 ID가 필요합니다. 기존 작업은 진행 조회로 확인하세요.');
  if (hasApplyProgress(jobId)) throw dutchError('JOB_ID_EXISTS', '이미 사용된 작업 ID입니다. 기존 작업의 진행을 확인하세요.', 409);
  const plan = claim(token, user, jobId);
  if (!initApplyProgress(jobId, plan.rows.length, String(user?.userId || ''))) {
    throw dutchError('JOB_ID_EXISTS', '이미 사용된 작업 ID입니다. 기존 작업의 진행을 확인하세요.', 409);
  }
  try {
    const result = await apply({
      rawWeek: plan.week,
      rawYear: plan.year,
      rows: plan.rows,
      sourceFileName: plan.sourceFileName,
      fullCategoryReplacement: true,
      dutchPlan: plan,
      user,
      ackQtyWarnings: body?.ackQtyWarnings === true,
      shipmentOnly: false,
      onProgress: patch => progressStep(jobId, patch),
    });
    finishDutchPlan(token, result?.success === true ? 'completed' : 'unknown');
    finishApplyProgress(jobId, result?.success === true
      ? { result, log: '네덜란드 물량표 저장 및 검증 완료' }
      : { failed: true, result, log: '저장 후 검증 결과 확인 필요' });
    return result;
  } catch (error) {
    finishDutchPlan(token, 'failed');
    finishApplyProgress(jobId, {
      failed: true,
      error: { code: error.code || '', message: error.message, statusCode: error.statusCode || 500 },
      log: `오류: ${error.message}`,
    });
    throw error;
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    return res.status(200).json(await applyDutchVolume(req.body, req.user));
  } catch (error) {
    return res.status(error.statusCode || (error.code === 'QTY_WARNING' ? 409 : 500)).json({
      success: false, code: error.code || 'DUTCH_APPLY_FAILED', error: error.message,
      ...(error.qtyWarnings ? { qtyWarnings: error.qtyWarnings } : {}),
    });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'DUTCH_VOLUME_KRW_APPLY',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate',
  riskLevel: 'HIGH',
}));
