import { withAuth } from '../../../lib/auth';
import { requireMoyiDriveAdmin, writePermissionAudit } from '../../../lib/moyiDriveAdmin';
import {
  applyExistingMoyiFiles,
  bootstrapMoyiDrive,
  hasCrossWorkspaceInput,
  hasExistingFilesScopeInput,
  loadMoyiDrive,
  pendingDriveModel,
  previewExistingMoyiFiles,
} from '../../../lib/moyiDriveGateway';

function rejectExistingFilesScope(res, actorId, input) {
  if (!hasExistingFilesScopeInput(input)) return false;
  writePermissionAudit({ actorId, action: 'existing-files', outcome: 'denied', reason: 'client-scope-input' });
  res.status(403).json({
    success: false,
    code: 'DRIVE_SCOPE_FIXED_BY_CONNECTION',
    error: '기존 파일 연결 범위는 현재 MOYI 연결 정보로만 정해집니다. 회사·폴더·파일을 직접 지정할 수 없습니다.',
  });
  return true;
}

async function handler(req, res) {
  if (!requireMoyiDriveAdmin(req, res)) {
    writePermissionAudit({ actorId: req.user?.userId, action: req.method, outcome: 'denied', reason: 'admin-only' });
    return;
  }
  if (req.method === 'GET' && req.query?.view === 'existing-files-preview') {
    if (rejectExistingFilesScope(res, req.user?.userId, req.query || {})) return;
    const result = await previewExistingMoyiFiles(req);
    writePermissionAudit({ actorId: req.user?.userId, action: 'existing-files-preview',
      outcome: result.status === 200 ? 'allowed' : 'denied', reason: result.body?.code });
    return res.status(result.status).json(result.body);
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
    if (req.method === 'POST' && body.action === 'bootstrap') {
      const result = await bootstrapMoyiDrive(req);
      writePermissionAudit({ actorId: req.user?.userId, action: 'drive-bootstrap',
        outcome: result.status === 200 ? 'allowed' : 'denied', reason: result.body?.code });
      return res.status(result.status).json(result.body);
    }
    if (req.method === 'POST' && body.action === 'apply-existing-files') {
      if (rejectExistingFilesScope(res, req.user?.userId, body)) return;
      if (body.confirm !== true) {
        writePermissionAudit({ actorId: req.user?.userId, action: 'existing-files-apply', outcome: 'denied', reason: 'confirm-required' });
        return res.status(400).json({ success: false, code: 'EXISTING_FILES_CONFIRM_REQUIRED', error: '기존 파일을 연결하려면 화면에서 내용을 확인한 뒤 다시 실행해 주세요.' });
      }
      const result = await applyExistingMoyiFiles(req);
      writePermissionAudit({ actorId: req.user?.userId, action: 'existing-files-apply',
        outcome: result.status === 200 ? 'allowed' : 'denied', reason: result.body?.code });
      return res.status(result.status).json(result.body);
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
