// 경영관리 API 접근 가드. 메뉴는 nenovaSS3 한정이지만 URL 직접 접근을 막기 위해 서버에서 관리자(authority<=1·대표)만 허용한다.
import { isAdminUser } from '../userAccess.js';

export function canUseMgmt(user) {
  return isAdminUser(user || {});
}

// 허용이면 null, 아니면 403 응답을 보내고 true 반환
export function denyIfNotMgmtAdmin(req, res) {
  if (canUseMgmt(req.user)) return false;
  res.status(403).json({ success: false, error: '경영관리 기능은 관리자 계정만 사용할 수 있습니다.' });
  return true;
}
