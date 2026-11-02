// GET /api/shipment/distribute-import-apply-progress?jobId=... — 적용 실시간 진행상황 (읽기 전용)
import { withAuth } from '../../../lib/auth';
import { getApplyProgress } from '../../../lib/importApplyProgress';
import { recoverImportProgress } from '../../../lib/importProgressRecovery';
import { query, sql } from '../../../lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const jobId = String(req.query.jobId || '').slice(0, 80);
  if (!jobId) return res.status(400).json({ success: false, error: 'jobId 필요' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const progress = await recoverImportProgress(getApplyProgress(jobId, req.user?.userId), req.user?.userId,
      async ({ auditKey, owner, year, week }) => {
        const result = await query(`SELECT AuditStatus FROM dbo.ShipmentImportAudit
          WHERE AuditKey=@audit AND ActorUserId=@owner AND OrderYear=@year AND OrderWeek=@week`, {
          audit: { type: sql.Int, value: auditKey }, owner: { type: sql.NVarChar, value: String(owner) },
          year: { type: sql.NVarChar, value: year }, week: { type: sql.NVarChar, value: week },
        });
        return result.recordset?.[0] || null;
      });
    return res.status(200).json({ success: true, progress });
  } catch {
    return res.status(503).json({ success: false, code: 'IMPORT_PROGRESS_UNAVAILABLE', error: '처리 결과 조회가 일시적으로 지연됩니다. 같은 작업을 다시 조회하세요.' });
  }
});
