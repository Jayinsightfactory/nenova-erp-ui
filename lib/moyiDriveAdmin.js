export const MOYI_DRIVE_ADMIN_USER_IDS = Object.freeze(['nenovaSS3']);

export function isMoyiDriveAdmin(userId) {
  return MOYI_DRIVE_ADMIN_USER_IDS.includes(String(userId || ''));
}

export function requireMoyiDriveAdmin(req, res) {
  if (req.user?.accountActive === false || req.user?.isDeleted === true) {
    res.status(403).json({
      success: false,
      code: 'MOYI_DRIVE_ACCOUNT_INACTIVE',
      error: '사용 중지된 계정은 Drive 관리 화면을 사용할 수 없습니다.',
    });
    return false;
  }
  if (isMoyiDriveAdmin(req.user?.userId)) return true;
  res.status(403).json({
    success: false,
    code: 'MOYI_DRIVE_ADMIN_ONLY',
    error: '이 화면은 지정된 Drive 관리자만 사용할 수 있습니다.',
  });
  return false;
}

export function writePermissionAudit({ actorId, action, outcome, reason, targetType, targetId }) {
  console.info('[moyi-drive-permission-audit]', JSON.stringify({
    occurredAt: new Date().toISOString(),
    actorId: String(actorId || 'unknown'),
    action: String(action || 'unknown'),
    outcome: String(outcome || 'unknown'),
    reason: String(reason || ''),
    targetType: String(targetType || ''),
    targetId: String(targetId || ''),
  }));
}
