// pages/api/pm/avatars.js
// /pm 직원 캐릭터 꾸미기 저장 — 게이트는 /api/pm/office 와 동일(아니면 404).
//   GET            → { avatars } 전 직원 꾸미기
//   POST {name, char, items} → data/runtime/pm-avatars.json 에 저장(빈 값이면 삭제). 유료 품목은 산 것만(lib/pmWallet.lockedOf)
// 파일 전용(MSSQL 무관). ERP 테이블을 읽거나 쓰지 않는다.
import { verifyReqUser } from '../../../lib/auth';
import { canActFor } from '../../../lib/pmAccount';
import { readAvatars, saveAvatar } from '../../../lib/pmAvatars';
import { lockedOf, readManifest, readShop } from '../../../lib/pmWallet';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') return res.status(200).json({ success: true, avatars: readAvatars() });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const b = req.body || {};
  // 직원=본인 캐릭터만, 다른 직원 꾸미기=관리자만
  if (!canActFor(user, String(b.name || '').trim())) return res.status(403).json({ success: false, error: '본인 캐릭터만 꾸밀 수 있습니다' });
  // 장착은 무료 또는 토큰으로 산 것만(서버 검증)
  const locked = lockedOf(String(b.name || '').trim(), b, readManifest(), readShop());
  if (locked.length) return res.status(409).json({ success: false, error: `아직 사지 않은 품목: ${locked.join(', ')}`, locked });
  const r = saveAvatar(b.name, b, user.userId || user.UserID || '');
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, avatar: r.avatar });
}
