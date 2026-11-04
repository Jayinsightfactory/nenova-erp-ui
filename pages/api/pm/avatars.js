// pages/api/pm/avatars.js
// /pm 직원 캐릭터 꾸미기 저장 — 게이트는 /api/pm/office 와 동일(아니면 404).
//   GET            → { avatars } 전 직원 꾸미기
//   GET 응답의 각 직원에 pass(자유이용권)·view(화면용 유효 꾸미기) 포함
//   POST {name, char, items} → data/runtime/pm-avatars.json 에 저장(빈 값이면 삭제). 유료 품목은 산 것만(lib/pmWallet.lockedOf)
// 파일 전용(MSSQL 무관). ERP 테이블을 읽거나 쓰지 않는다.
import { verifyReqUser } from '../../../lib/auth';
import { canActFor } from '../../../lib/pmAccount';
import { readAvatars, saveAvatar } from '../../../lib/pmAvatars';
import { lockedOf, readManifest, readShop } from '../../../lib/pmWallet';
import { effectiveCfg, passOf, readPasses } from '../../../lib/pmFreePass';
import { readGrowState } from '../../../lib/pmGrowStore';
import { stageOf } from '../../../lib/pmGrow';

// 성장 단계로 여는 자리 슬롯(꾸밈 해금): 러그=새싹(2)·책장/선반=꽃봉오리(3). 포인트 규칙은 lib/pmGrow 그대로.
export const SLOT_UNLOCK_STAGE = { rug: 2, shelf: 3 };

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  res.setHeader('Cache-Control', 'private, no-store');
  const now = Date.now();
  const passes = readPasses();
  if (req.method === 'GET') {
    // 화면용 view = 이용권 만료 시 산 적 없는 유료 품목만 뺀 모습(저장 데이터는 그대로). pass = 남은 일수 배지용
    const manifest = readManifest(); const shop = readShop(); const all = readAvatars();
    const out = {};
    for (const [n, a] of Object.entries(all)) {
      const pass = passOf(n, passes, now);
      out[n] = { ...a, pass, view: effectiveCfg(a, pass, manifest ? lockedOf(n, a, manifest, shop) : []) };
    }
    return res.status(200).json({ success: true, avatars: out, passDefault: passOf('', { default: passes.default, people: {} }, now) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const b = req.body || {};
  // 직원=본인 캐릭터만, 다른 직원 꾸미기=관리자만
  if (!canActFor(user, String(b.name || '').trim())) return res.status(403).json({ success: false, error: '본인 캐릭터만 꾸밀 수 있습니다' });
  // 장착은 무료 또는 토큰으로 산 것만(서버 검증)
  const nm = String(b.name || '').trim();
  const pass = passOf(nm, passes, now);
  const locked = pass.active ? [] : lockedOf(nm, b, readManifest(), readShop());
  if (locked.length) return res.status(409).json({ success: false, error: `아직 사지 않은 품목: ${locked.join(', ')}`, locked });
  const stage = stageOf(readGrowState()?.people?.[nm]?.points || 0).stage;
  const shut = Object.entries(SLOT_UNLOCK_STAGE).filter(([sl, st]) => b.items?.[sl] && stage < st && !pass.active).map(([sl, st]) => `${sl}(${st}단계)`);
  if (shut.length) return res.status(409).json({ success: false, error: `아직 열리지 않은 자리: ${shut.join(', ')}` });
  const r = saveAvatar(b.name, b, user.userId || user.UserID || '');
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, avatar: r.avatar });
}
