// lib/orbitReportAccess.js
// 직원 업무 심화 리포트(/admin/orbit-report) 열람 허용 계정.
// 요청: nenovaSS3 이 계정만. 민감(직원 관측데이터)이라 명시 화이트리스트로 좁게 유지한다.
// (lib/moyiDriveAdmin.js 의 MOYI_DRIVE_ADMIN_USER_IDS 패턴과 동일)
export const ORBIT_REPORT_USER_IDS = Object.freeze(['nenovaSS3']);

const NORMALIZED = new Set(ORBIT_REPORT_USER_IDS.map((id) => id.toLowerCase()));

// user = JWT payload({ userId }) 또는 DB row({ UserID }). 대소문자 무시 비교.
export function isOrbitReportViewer(user) {
  if (!user) return false;
  const id = String(user.userId ?? user.UserID ?? '').trim().toLowerCase();
  return id !== '' && NORMALIZED.has(id);
}
