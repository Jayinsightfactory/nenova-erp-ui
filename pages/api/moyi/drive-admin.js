import { withAuth } from '../../../lib/auth';
import { requireMoyiDriveAdmin, writePermissionAudit } from '../../../lib/moyiDriveAdmin';
import { hasCrossWorkspaceInput, loadMoyiDrive, pendingDriveModel } from '../../../lib/moyiDriveGateway';

async function handler(req, res) {
  if (!requireMoyiDriveAdmin(req, res)) {
    writePermissionAudit({ actorId: req.user?.userId, action: req.method, outcome: 'denied', reason: 'admin-only' });
    return;
  }
  if (req.method === 'GET') {
    const result = await loadMoyiDrive(req);
    return res.status(result.status).json(result.body);
  }
  if (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE') {
    const body = req.body || {};
    if (hasCrossWorkspaceInput(body)) {
      writePermissionAudit({ actorId: req.user?.userId, action: req.method, outcome: 'denied', reason: 'cross-workspace-input' });
      return res.status(403).json({ success: false, code: 'DRIVE_SCOPE_FIXED_BY_CONNECTION', error: '회사와 작업공간은 연결 정보로 정해집니다. 다른 회사 범위를 지정할 수 없습니다.' });
    }
    writePermissionAudit({
      actorId: req.user?.userId,
      action: `permission-${req.method.toLowerCase()}`,
      outcome: 'blocked',
      reason: 'moyi-drive-write-contract-not-deployed',
      targetType: body.targetType,
      targetId: body.targetId,
    });
    return res.status(503).json({ ...pendingDriveModel('MOYI backend에 ACL 조회·안전한 관리 저장 계약이 아직 배포되지 않았습니다.'), error: '권한 저장 연결이 준비되지 않아 실제 권한을 변경하지 않았습니다.' });
  }
  res.setHeader('Allow', 'GET, PUT, POST, DELETE');
  return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
}

export default withAuth(handler);
