import { withAuth } from '../../../lib/auth';
import { requireMoyiDriveAdmin, writePermissionAudit } from '../../../lib/moyiDriveAdmin';

const VIEW_MODEL = {
  connectionReady: false,
  connectionReason: 'MOYI Core의 회사·파일 권한 저장 계약을 이 서버에서 확인하지 못했습니다.',
  company: { id: 'nenova-preview', name: 'Nenova (설계 미리보기)' },
  files: [
    { id: 'sample-1', name: '2026_29차_매출이익.xlsx', type: 'Excel', owner: '수입부', changedAt: '2026-08-07', state: '연결 대기' },
    { id: 'sample-2', name: '거래처 요청서.pdf', type: 'PDF', owner: '영업부', changedAt: '2026-08-06', state: '연결 대기' },
  ],
  permissions: [
    { subject: '회사 관리자', view: true, preview: true, download: true, upload: true, edit: true, remove: true, share: true },
    { subject: '일반 직원', view: true, preview: true, download: false, upload: true, edit: false, remove: false, share: false },
  ],
  versions: [
    { id: 'v3', label: '제목 변경 · 내용 동일', by: 'nenovaSS3', at: '2026-08-07 14:20' },
    { id: 'v2', label: '영업 시트 B12:D18 변경', by: '담당자', at: '2026-08-06 09:15' },
  ],
  downloads: [
    { at: '2026-08-07 10:10', user: '직원 예시', file: '거래처 요청서.pdf', result: '다운로드 차단' },
    { at: '2026-08-06 16:02', user: '관리자 예시', file: '매출이익.xlsx', result: '완료' },
  ],
  identities: [
    { nenovaUserId: 'sample-user', moyiUser: '연결 후보', department: '부서 확인 필요', state: '승인 기다림' },
  ],
  automations: [
    { name: '대화에서 파일 분류', company: 'Nenova', owner: '담당자 확인 필요', state: '미리보기' },
    { name: '전산 보고 전송', company: 'Nenova', owner: '관리자 승인 필요', state: '잠시 멈춤' },
  ],
};

async function handler(req, res) {
  if (!requireMoyiDriveAdmin(req, res)) {
    writePermissionAudit({ actorId: req.user?.userId, action: req.method, outcome: 'denied', reason: 'admin-only' });
    return;
  }
  if (req.method === 'GET') return res.status(200).json({ success: true, ...VIEW_MODEL });
  if (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE') {
    const body = req.body || {};
    writePermissionAudit({
      actorId: req.user?.userId,
      action: `permission-${req.method.toLowerCase()}`,
      outcome: 'blocked',
      reason: 'moyi-core-contract-pending',
      targetType: body.targetType,
      targetId: body.targetId,
    });
    return res.status(503).json({
      success: false,
      code: 'MOYI_CORE_CONNECTION_PENDING',
      error: 'MOYI 권한 저장 연결을 확인한 뒤 사용할 수 있습니다. 현재는 실제 권한을 변경하지 않았습니다.',
    });
  }
  res.setHeader('Allow', 'GET, PUT, POST, DELETE');
  return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
}

export default withAuth(handler);
