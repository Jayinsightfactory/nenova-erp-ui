function parseFullWeek(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2}-\d{2})$/);
  return match ? { orderYear: match[1], orderWeek: match[2] } : null;
}

function parseShortWeek(value) {
  const match = String(value || '').trim().match(/^(\d{2}-\d{2})$/);
  return match ? match[1] : '';
}

export function resolveFixStatusOrderYear(orderYear, ...weekValues) {
  const explicitYear = String(orderYear || '').trim();
  if (explicitYear && !/^\d{4}$/.test(explicitYear)) {
    throw new Error('선택 연도 형식이 올바르지 않습니다.');
  }
  const embeddedYears = weekValues.map(parseFullWeek).filter(Boolean).map(row => row.orderYear);
  const resolvedYear = explicitYear || embeddedYears[0] || '';
  if (!resolvedYear) {
    throw new Error('확정현황 요청에 화면의 선택 연도가 포함되지 않았습니다. 화면을 새로고침한 뒤 다시 조회해 주세요.');
  }
  if (embeddedYears.some(year => year !== resolvedYear)) {
    throw new Error('화면의 선택 연도와 조회 차수의 연도가 서로 다릅니다.');
  }
  return resolvedYear;
}

export function buildFixStatusQuery({ orderYear, fromWeek, toWeek }) {
  const resolvedYear = resolveFixStatusOrderYear(orderYear, fromWeek, toWeek || fromWeek);
  return new URLSearchParams({
    orderYear: resolvedYear,
    fromWeek: String(fromWeek || ''),
    toWeek: String(toWeek || fromWeek || ''),
  }).toString();
}

export function findFixStatusWeek(rows, { orderYear, orderWeek }) {
  const resolvedYear = resolveFixStatusOrderYear(orderYear, orderWeek);
  const full = parseFullWeek(orderWeek);
  const short = full?.orderWeek || parseShortWeek(orderWeek);
  if (!short) return null;
  return (rows || []).find(row => (
    String(row?.OrderYear || '') === resolvedYear
    && String(row?.OrderWeek || '') === short
  )) || null;
}
