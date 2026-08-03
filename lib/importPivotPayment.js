// 수입부 Pivot 농장별 결제일 설정 — 웹 전용 순수 규칙
// 실제 입고/주문/출고 원장은 변경하지 않고 FarmName 단위 설정만 사용한다.

export const PAYMENT_DAYS = Object.freeze([5, 15, 25]);

export function normalizePaymentDay(value) {
  const day = Number(value);
  return PAYMENT_DAYS.includes(day) ? day : null;
}

export function paymentDayLabel(value) {
  const day = normalizePaymentDay(value);
  return day ? `${day}일` : '미설정';
}

export function farmMatchesPaymentDay(farmName, paymentDays = {}, filter = '') {
  if (String(filter || '').toLowerCase() === 'unassigned') {
    return !normalizePaymentDay(paymentDays[String(farmName || '').trim()]);
  }
  const wanted = normalizePaymentDay(filter);
  if (!wanted) return true;
  return normalizePaymentDay(paymentDays[String(farmName || '').trim()]) === wanted;
}

export function summarizePaymentDay(farms = [], paymentDays = {}) {
  const summary = { 5: 0, 15: 0, 25: 0, unassigned: 0 };
  for (const farm of Array.isArray(farms) ? farms : []) {
    const total = Number(farm?.total) || 0;
    const day = normalizePaymentDay(paymentDays[String(farm?.name || '').trim()]);
    if (day) summary[day] += total;
    else summary.unassigned += total;
  }
  return summary;
}
