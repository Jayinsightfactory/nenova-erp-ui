// pages/api/finance/barobill.js — 바로빌 API 연동 상태·조회 (읽기 전용, ERP 테이블 미접촉)
// GET ?action=status            → 설정 여부(키는 마스킹)·환경·연결(Ping)·인증키 유효·회원사 여부·선불 잔액
// GET ?action=accounts          → 등록 계좌 목록(번호 마스킹)
// GET ?action=cards             → 등록 카드 목록(번호 마스킹)
// GET ?action=bank-log&accountNo=&from=&to=&page=   → 계좌 거래내역
// GET ?action=card-log&cardNo=&from=&to=&page=      → 카드 사용내역
// GET ?action=tax-sales&from=&to=&page=             → 매출 세금계산서 목록(발행분)
// GET ?action=tax-purchase&month=YYYY-MM&page=      → 홈택스 매입 세금계산서(월)
// GET ?action=corp-state&corpNum=                   → 사업자 휴폐업 상태
// 인증: 관리자 JWT(isAdminUser) 또는 자동화 토큰(lib/automationAuth). 쓰기(발급·등록)는 이 라우트에 없음.
// 보안: 인증키·계좌/카드 전체번호는 응답·로그에 싣지 않는다(마스킹). DB 쓰기 없음(규칙1).

import { verifyReqUser } from '../../../lib/auth';
import { isAdminUser } from '../../../lib/userAccess';
import { checkAutomationAuth } from '../../../lib/automationAuth';
import { createBarobillClient, loadBarobillConfig, BarobillError } from '../../../lib/barobillApi';

function authorize(req, res) {
  const auto = checkAutomationAuth(req);
  if (auto.ok) return { actor: 'automation' };
  const user = verifyReqUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
    return null;
  }
  if (user.accountActive === false || !isAdminUser(user)) {
    res.status(403).json({ success: false, code: 'BAROBILL_ADMIN_ONLY', error: '바로빌 조회는 관리자만 가능합니다.' });
    return null;
  }
  return { actor: user.userId };
}

function maskKey(k) {
  const s = String(k || '');
  return s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const auth = authorize(req, res);
  if (!auth) return undefined;
  const q = req.query || {};
  const action = String(q.action || 'status');
  try {
    const cfg = loadBarobillConfig();
    if (action === 'status') {
      const out = { success: true, mode: cfg.mode, host: cfg.host, configured: cfg.configured, missing: cfg.missing, certKey: maskKey(cfg.certKey), corpNum: cfg.corpNum, allowWrite: cfg.allowWrite };
      if (!cfg.configured) return res.status(200).json(out);
      const client = createBarobillClient();
      const [ping, cert, member, balance] = await Promise.all([
        client.ping().then(() => true).catch(() => false),
        client.checkCert().catch((e) => `오류 ${e.code ?? ''}`),
        client.checkCorpIsMember().catch((e) => `오류 ${e.code ?? ''}`),
        client.balance().catch(() => null),
      ]);
      return res.status(200).json({ ...out, ping, certValid: cert === 1, certResult: cert, corpIsMember: member === 1, memberResult: member, balance });
    }
    if (!cfg.configured) return res.status(503).json({ success: false, error: `바로빌 미설정: ${cfg.missing.join(', ')} (서버 .env.local)` });
    const client = createBarobillClient();
    const page = Number(q.page) || 1;
    const from = q.from || firstOfMonth();
    const to = q.to || today();
    let data;
    switch (action) {
      case 'accounts': data = await client.bankAccounts(); break;
      case 'cards': data = await client.cards(); break;
      case 'bank-log':
        if (!q.accountNo) return res.status(400).json({ success: false, error: 'accountNo 필요(전체 번호, 응답은 마스킹)' });
        data = await client.bankLog({ accountNo: q.accountNo, from, to, page }); break;
      case 'card-log':
        if (!q.cardNo) return res.status(400).json({ success: false, error: 'cardNo 필요(전체 번호, 응답은 마스킹)' });
        data = await client.cardLog({ cardNo: q.cardNo, from, to, page }); break;
      case 'tax-sales': data = await client.taxSalesList({ from, to, page }); break;
      case 'tax-purchase':
        if (!q.month) return res.status(400).json({ success: false, error: 'month=YYYY-MM 필요' });
        data = await client.taxPurchaseMonthly({ month: q.month, page }); break;
      case 'corp-state':
        if (!q.corpNum) return res.status(400).json({ success: false, error: 'corpNum 필요' });
        data = await client.corpState(q.corpNum); break;
      default: return res.status(400).json({ success: false, error: `알 수 없는 action: ${action}` });
    }
    return res.status(200).json({ success: true, mode: cfg.mode, action, from, to, data });
  } catch (err) {
    console.error('[barobill]', action, err?.name, err?.code || '', err?.message);
    const status = err instanceof BarobillError ? 502 : 500;
    return res.status(status).json({ success: false, error: err.message, code: err?.code });
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() { return `${today().slice(0, 7)}-01`; }
