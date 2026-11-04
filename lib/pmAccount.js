// lib/pmAccount.js
// 로그인 계정(JWT { userId, userName }) → PM 사무실 직원 키(한글 이름) 매핑.
// 순서: config/pm-account-map.json(userId→직원, 수동 보정) → UserName 이 직원 이름과 일치 → 별칭(NAME_ALIASES 역방향).
// 매핑 안 되면 null(화면은 "계정 연결 필요"). 관리자는 누구 몫이든 대리 가능.
import fs from 'fs';
import path from 'path';
import { NAME_ALIASES } from './pmStaff';
import { isOrbitReportViewer } from './orbitReportAccess';
import { PM_ROSTER } from './pmRoster';

export { PM_ROSTER };

const STAFF = new Set(Object.values(PM_ROSTER).flat());
const norm = (s) => String(s || '').replace(/\s+/g, '').trim();

export function readAccountMap(file = path.join(process.cwd(), 'config', 'pm-account-map.json')) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j.byUserId === 'object' ? j.byUserId : {}; } catch { return {}; }
}

export function staffOfUser(user, { map = readAccountMap() } = {}) {
  if (!user) return null;
  const id = String(user.userId ?? user.UserID ?? '').trim().toLowerCase();
  for (const [k, v] of Object.entries(map || {})) if (k.toLowerCase() === id && STAFF.has(v)) return v;
  const nm = norm(user.userName ?? user.UserName);
  if (!nm) return null;
  if (STAFF.has(nm)) return nm;
  for (const [staff, aliases] of Object.entries(NAME_ALIASES)) if (STAFF.has(staff) && aliases.some((a) => norm(a) === nm)) return staff;
  return null;
}

// 본인 몫이거나 관리자면 허용.
export function canActFor(user, targetName, opts) {
  if (!user) return false;
  if (isOrbitReportViewer(user)) return true;
  const me = staffOfUser(user, opts);
  return !!me && me === String(targetName || '').trim();
}
