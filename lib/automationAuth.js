// 자동화 브리지 공통 토큰 인증. MOYI_API_TOKEN 우선, 없으면 AUTOMATION_API_TOKEN 도 허용.
// 토큰은 서버 env 에만 둔다(코드/로그 노출 금지). 타이밍 안전 비교.
import crypto from 'crypto';

export function getAutomationToken(req) {
  const auth = (req.headers.authorization || '').toString();
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  return bearer || (req.headers['x-automation-token'] || req.headers['x-moyi-token'] || '').toString().trim();
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

/** 반환: { ok:true } | { ok:false, status, error } */
export function checkAutomationAuth(req) {
  const tokens = [process.env.MOYI_API_TOKEN, process.env.AUTOMATION_API_TOKEN].filter(Boolean);
  if (!tokens.length) return { ok: false, status: 503, error: 'MOYI_API_TOKEN(또는 AUTOMATION_API_TOKEN) 서버 미설정' };
  const got = getAutomationToken(req);
  if (!got) return { ok: false, status: 401, error: '인증 토큰이 없습니다.' };
  return tokens.some(t => safeEqual(got, t)) ? { ok: true } : { ok: false, status: 401, error: '인증 토큰이 올바르지 않습니다.' };
}
