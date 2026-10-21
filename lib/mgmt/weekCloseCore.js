// 차수 마감 체크리스트 순수 함수(DB 무관). 테스트: __tests__/mgmtWeekClose.test.js
export const WEEK_CLOSE_ITEMS = [
  { code: 'UNQUOTED', label: '견적 미등록(출고확정 후 Estimate 없음)', auto: true },
  { code: 'NEGATIVE_STOCK', label: '잔량 마이너스 품목', auto: true },
  { code: 'EMPTY_SDETAIL', label: '빈 출고상세(OutQuantity=0)', auto: true },
  { code: 'UNPAID', label: '미입금 거래처', auto: true },
  { code: 'UNREMITTED', label: '농장 송금 미완료', auto: true },
  { code: 'VERIFY_WEEK', label: '불변식 검증(verify:week)', auto: false },
];
export const WEEK_CLOSE_STATUSES = ['open', 'done', 'skipped'];
export const ITEM_CODES = WEEK_CLOSE_ITEMS.map((i) => i.code);

// '42-1' / '42-01' / '42' → { major, sub, variants }. 잘못된 형식이면 null.
export function parseWeek(input) {
  const m = /^\s*(\d{1,2})(?:-(\d{1,2}))?\s*$/.exec(String(input ?? ''));
  if (!m) return null;
  const major = m[1].padStart(2, '0');
  if (m[2] == null) return { major, sub: null, variants: null };
  const n = String(Number(m[2]));
  return { major, sub: n, variants: [`${major}-${n}`, `${major}-${n.padStart(2, '0')}`] };
}

export function validateWeekInput(orderYear, orderWeek) {
  if (!/^\d{4}$/.test(String(orderYear ?? ''))) return { ok: false, error: 'orderYear 는 4자리 연도' };
  const w = parseWeek(orderWeek);
  if (!w) return { ok: false, error: "orderWeek 형식 오류(예 '42-1')" };
  return { ok: true, year: String(orderYear), week: w };
}

// WebFarmRemit.Weeks("38-01,38-02") 가 해당 차수를 포함하는지
export function weeksInclude(weeksText, week) {
  const w = typeof week === 'string' ? parseWeek(week) : week;
  if (!w) return false;
  return String(weeksText || '').split(/[,\s/]+/).filter(Boolean).some((tok) => {
    const t = parseWeek(tok);
    if (!t || t.major !== w.major) return false;
    return w.sub == null || t.sub == null || t.sub === w.sub;
  });
}

export function normalizeStatus(s) {
  return WEEK_CLOSE_STATUSES.includes(s) ? s : null;
}

// 추가 전용 행들 → 항목별 최신 상태(CheckKey 큰 것이 최신)
export function latestChecks(rows = []) {
  const map = new Map();
  for (const r of rows) {
    if (!ITEM_CODES.includes(r.ItemCode)) continue;
    const cur = map.get(r.ItemCode);
    if (!cur || Number(r.CheckKey) > Number(cur.CheckKey)) map.set(r.ItemCode, r);
  }
  return map;
}

// 항목 + 자동 건수 + 상태 병합. counts[code] 가 null/없음이면 '미연결'(0 아님).
export function buildChecklist(counts = {}, latest = new Map()) {
  return WEEK_CLOSE_ITEMS.map((it) => {
    const row = latest.get(it.code);
    const count = Object.prototype.hasOwnProperty.call(counts, it.code) ? counts[it.code] : null;
    return {
      code: it.code, label: it.label, auto: it.auto,
      count, connected: count !== null || !it.auto,
      status: row ? row.Status : 'open',
      note: row ? row.Note || '' : '',
      checkedAt: row ? row.CreatedAt : null,
    };
  });
}

// 전부 done(또는 사유 메모가 있는 skipped)이어야 마감 가능.
export function isCloseable(items = []) {
  if (!items.length) return false;
  return items.every((i) => i.status === 'done' || (i.status === 'skipped' && String(i.note || '').trim() !== ''));
}

export function validateCheckInput({ itemCode, status, note }) {
  if (!ITEM_CODES.includes(itemCode)) return { ok: false, error: 'itemCode 오류' };
  const st = normalizeStatus(status);
  if (!st) return { ok: false, error: 'status 는 open|done|skipped' };
  const n = String(note ?? '').trim().slice(0, 400);
  if (st === 'skipped' && !n) return { ok: false, error: '건너뜀은 메모(사유) 필수' };
  return { ok: true, itemCode, status: st, note: n };
}
