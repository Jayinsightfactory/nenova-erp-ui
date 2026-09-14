// Explicit endpoints: EXE compares full StockMaster.OrderYearWeek, including year.
export function normalizePivotExeRange(input = {}) {
  const endpoint = (year, week, label) => {
    if (Array.isArray(year) || Array.isArray(week)) throw new Error(`${label} 연도·차수 형식을 확인하세요.`);
    const y = String(year ?? '').trim();
    const m = String(week ?? '').trim().match(/^(\d{1,2})-(\d{1,2})([a-zA-Z]?)$/);
    if (!/^\d{4}$/.test(y) || Number(y) < 2020 || Number(y) > 2099 || !m || Number(m[1]) < 1 || Number(m[1]) > 53 || Number(m[2]) < 1 || Number(m[2]) > 99) {
      throw new Error(`${label} 연도와 세부차수가 필요합니다. 예: 2026 / 37-01`);
    }
    const w = `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}${m[3].toUpperCase()}`;
    return { year: y, week: w, key: y + w.replace('-', '') };
  };
  const from = endpoint(input.fromYear, input.fromWeek, '시작');
  const to = endpoint(input.toYear, input.toWeek, '종료');
  if (from.key > to.key) throw new Error('시작 연도·차수가 종료보다 늦습니다. 연도도 함께 확인하세요.');
  if (Number(to.year) - Number(from.year) > 5) throw new Error('한 번에 조회할 수 있는 연도 범위는 5년 차이 이내입니다. 범위를 나누어 조회하세요.');
  return { fromYear: from.year, fromWeek: from.week, toYear: to.year, toWeek: to.week, weekFrom: from.key, weekTo: to.key };
}
