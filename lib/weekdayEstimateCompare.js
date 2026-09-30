const WEEKDAY_UNIT_ALIASES = Object.freeze({
  '박스': ['박스', 'BOX'],
  '단': ['단', 'BUNCH'],
  '송이': ['송이', 'STEAM', 'STEM', 'STEMS', 'ST', 'EA', '개', '대'],
});

export function normalizeWeekdayUnit(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return Object.entries(WEEKDAY_UNIT_ALIASES).find(([, aliases]) => aliases.includes(text))?.[0] ?? null;
}

// Only fixed application aliases become SQL literals. Unknown units remain NULL, not inferred SteamQuantity.
export const WEEKDAY_ORDER_OUT_QUANTITY_SQL = `CASE ${Object.entries(WEEKDAY_UNIT_ALIASES).map(([unit, aliases]) =>
  `WHEN UPPER(LTRIM(RTRIM(p.OutUnit))) IN (${aliases.map(alias => `N'${alias}'`).join(',')}) THEN ISNULL(od.${unit === '박스' ? 'BoxQuantity' : unit === '단' ? 'BunchQuantity' : 'SteamQuantity'},0)`
).join(' ')} ELSE NULL END`;

export function normalizeWeekdayCompareRequest(body = {}) {
  const yearText = String(body.year ?? '').trim();
  const year = Number(yearText);
  const custKey = Number(body.custKey);
  const weeks = [...new Set((Array.isArray(body.orderWeeks) ? body.orderWeeks : []).map((value) => String(value ?? '').trim()))];
  const prodKeys = [...new Set((Array.isArray(body.prodKeys) ? body.prodKeys : []).map(Number))];
  if (!/^\d{4}$/.test(yearText) || !Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('연도는 4자리 숫자로 지정하세요.');
  if (!Number.isInteger(custKey) || custKey <= 0) throw new Error('실제 거래처를 선택하세요.');
  if (!weeks.length || weeks.length > 20 || weeks.some((week) => !/^\d{2}-\d{2}$/.test(week))) {
    throw new Error('세부차수는 NN-NN 형식으로 최대 20개까지 선택하세요.');
  }
  if (!prodKeys.length || prodKeys.length > 500 || prodKeys.some((key) => !Number.isInteger(key) || key <= 0)) {
    throw new Error('연결된 품목을 1~500개 선택하세요.');
  }
  return { year, custKey, weeks, prodKeys };
}

export function matchesWeekdayCompareIdentity(row, scope) {
  return Number(row?.OrderYear) === Number(scope.year)
    && scope.weeks.includes(String(row?.OrderWeek || ''))
    && Number(row?.CustKey) === Number(scope.custKey)
    && scope.prodKeys.includes(Number(row?.ProdKey));
}

export function filterWeekdayCompareRows(rows, scope) {
  return (rows || []).filter((row) => matchesWeekdayCompareIdentity(row, scope));
}
