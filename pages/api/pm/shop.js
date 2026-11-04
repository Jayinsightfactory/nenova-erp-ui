// pages/api/pm/shop.js — /pm 토큰 지갑·상점. 게이트는 /api/pm/office 와 동일(아니면 404).
//   GET            → { balances: {직원: 잔액}, themes: 팀 해금 상태, team }
//   GET ?name=     → 그 직원 지갑(적립·잔액·적립 내역·구매 내역·보유)
//   POST {name,id} → 구매(잔액 검증 후 기록). 지금은 로그인↔직원 매핑이 없어 관리자(사장님) 대리 구매만 — by 에 기록.
// 적립은 lib/pmGrow(서버 계산) 그대로, 가격은 서버 manifest. 파일 전용(MSSQL 무관).
import { verifyReqUser } from '../../../lib/auth';
import { canActFor } from '../../../lib/pmAccount';
import { readGrowState } from '../../../lib/pmGrowStore';
import { buy, readManifest, readShop, teamEarned, themeUnlocks, walletOf } from '../../../lib/pmWallet';
import { withFx } from '../../../lib/pmFxShop';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  res.setHeader('Cache-Control', 'private, no-store');
  const grow = readGrowState();
  const manifest = withFx(readManifest());
  if (req.method === 'GET') {
    const shop = readShop();
    const name = String(req.query.name || '').trim().slice(0, 40);
    if (name) return res.status(200).json({ success: true, wallet: walletOf(name, grow, shop) });
    const balances = {};
    for (const n of Object.keys(grow?.people || {})) balances[n] = walletOf(n, grow, shop).balance;
    return res.status(200).json({ success: true, balances, team: teamEarned(grow), themes: themeUnlocks(manifest, grow) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  // 직원=본인 지갑으로 본인 몫만, 다른 직원 대리구매=관리자만
  if (!canActFor(user, String(req.body?.name || '').trim())) return res.status(403).json({ success: false, error: '본인 캐릭터만 구매할 수 있습니다' });
  const r = buy({ ...(req.body || {}), by: user.userId || user.UserID || '' }, { growState: grow, manifest });
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, duplicate: !!r.duplicate, wallet: r.wallet });
}
