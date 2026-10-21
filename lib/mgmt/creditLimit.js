// 여신한도 순수 로직(DB 의존 없음).
export const CREDIT_WARN_PCT = 80;
export const CREDIT_STATUS_LABEL = { none: '한도 미설정', ok: '정상', warn: '80% 경고', over: '초과' };

export function creditPct(limitKRW, balance) {
  const limit = Number(limitKRW);
  if (limitKRW == null || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.round(((Number(balance) || 0) / limit) * 1000) / 10;
}

export function creditStatus(limitKRW, balance) {
  if (limitKRW == null || limitKRW === '' || !Number.isFinite(Number(limitKRW))) return 'none';
  const limit = Number(limitKRW);
  const bal = Number(balance) || 0;
  if (bal > limit) return 'over';
  if (limit > 0 && bal / limit >= CREDIT_WARN_PCT / 100) return 'warn';
  return 'ok';
}

// 이력 행들(추가 전용)에서 거래처별 최신 행. 동률은 HistoryKey 큰 쪽.
export function latestLimitByCust(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const cur = map.get(r.CustKey);
    const t = new Date(r.CreatedAt).getTime() || 0;
    const ct = cur ? (new Date(cur.CreatedAt).getTime() || 0) : -1;
    if (!cur || t > ct || (t === ct && r.HistoryKey > cur.HistoryKey)) map.set(r.CustKey, r);
  }
  return map;
}

export function validateLimitInput(body) {
  const custKey = Number.parseInt(body?.custKey, 10);
  const limit = Number(body?.limitKRW);
  const reason = String(body?.reason || '').trim();
  if (!Number.isInteger(custKey) || custKey <= 0) return { error: 'custKey 필요' };
  if (body?.limitKRW === '' || body?.limitKRW == null || !Number.isFinite(limit) || limit < 0 || limit > 9999999999999999) return { error: 'limitKRW 는 0 이상 숫자' };
  if (!reason) return { error: '변경 사유(reason) 필수' };
  if (reason.length > 400) return { error: 'reason 400자 이내' };
  return { custKey, limitKRW: Math.round(limit), reason };
}

export function signboardOf(descr, custName) {
  return String(descr || '').split('/')[0].trim() || custName || '';
}
