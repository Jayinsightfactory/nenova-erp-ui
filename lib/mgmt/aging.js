// 채권 aging 순수 로직(DB 의존 없음). 구간 산정은 미결 청구 발생일 기준 FIFO 상계.
export const AGING_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90p'];
export const AGING_LABELS = { d0_30: '0-30일', d31_60: '31-60일', d61_90: '61-90일', d90p: '90일 초과' };

const DAY_MS = 86400000;

function toUtcDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 기준일(asOf) - 발생일. 날짜 해석 불가는 0일(최신 구간)로 취급.
export function daysBetween(asOf, date) {
  const a = toUtcDay(asOf);
  const d = toUtcDay(date);
  if (a == null || d == null) return 0;
  return Math.round((a - d) / DAY_MS);
}

export function bucketOf(days) {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90p';
}

// 입금 총액을 오래된 청구부터 소진. 남은 청구(open)와 초과입금(credit) 반환.
export function applyFifo(charges, totalPaid) {
  const sorted = (charges || [])
    .map((c, i) => ({ date: String(c.date || ''), amount: Number(c.amount) || 0, i }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i));
  let remain = Number(totalPaid) || 0;
  const open = [];
  for (const c of sorted) {
    if (c.amount <= 0) { open.push({ date: c.date, amount: c.amount }); continue; }
    const used = Math.min(remain, c.amount);
    remain -= used;
    const left = c.amount - used;
    if (left > 0) open.push({ date: c.date, amount: left });
  }
  return { open, credit: remain };
}

// 거래처 1곳의 구간 배정. total = 구간합 - credit = 잔액(청구합 - 입금합).
export function agingForCustomer(charges, totalPaid, asOf) {
  const all = charges || [];
  const valid = all.filter((c) => !c.date || String(c.date).slice(0, 10) <= asOf);
  // 기준일 이후 발생 청구는 aging 에서 제외하되, 금액을 따로 보고해 여신한도 화면(전체 잔액)과의 차이를 설명한다.
  const futureExcluded = all.filter((c) => c.date && String(c.date).slice(0, 10) > asOf).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const { open, credit } = applyFifo(valid, totalPaid);
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  let oldestDays = 0;
  for (const o of open) {
    const days = daysBetween(asOf, o.date);
    buckets[bucketOf(days)] += o.amount;
    if (o.amount > 0 && days > oldestDays) oldestDays = days;
  }
  const sum = AGING_BUCKETS.reduce((s, k) => s + buckets[k], 0);
  return { ...buckets, credit, total: sum - credit, outstanding: sum, oldestDays, futureExcluded, totalPaid: Number(totalPaid) || 0 };
}

export function summarizeAging(rows) {
  const t = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0, credit: 0, total: 0, futureExcluded: 0, totalPaid: 0 };
  for (const r of rows || []) for (const k of Object.keys(t)) t[k] += Number(r[k]) || 0;
  return t;
}

// 90+ 우선, 그다음 최고령 일수, 합계 큰 순.
export function sortAgingRows(rows) {
  return [...(rows || [])].sort((a, b) => (b.d90p - a.d90p) || (b.oldestDays - a.oldestDays) || (b.total - a.total));
}
