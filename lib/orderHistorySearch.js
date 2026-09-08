const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
const scalar = (value, label) => {
  if (Array.isArray(value) || (value != null && typeof value === 'object')) throw invalid(`${label} 검색값을 확인하세요.`);
  return String(value ?? '').trim();
};
export const ORDER_HISTORY_PAGE_SIZE = 500;
export function normalizeOrderHistorySearch(input = {}, fallbackYear = String(new Date().getFullYear())) {
  const raw = scalar(input.week, '차수').replace(/\s+/g, '').replace(/차$/, '');
  const full = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  const short = full ? null : raw.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  if (raw && !full && !short) throw invalid('차수 형식은 36, 36-01 또는 2026-36-01입니다.');
  const year = input.year !== undefined ? scalar(input.year, '연도') : full?.[1] ?? String(fallbackYear);
  if (!/^\d{4}$/.test(year) || Number(year) < 1000) throw invalid('연도는 4자리 숫자로 입력하세요.');
  if (full && full[1] !== year) throw invalid('선택 연도와 차수의 연도가 다릅니다.');
  const major = full ? full[2] : short?.[1];
  const seq = full ? full[3] : short?.[2];
  if ((major !== undefined && !(Number(major) >= 1 && Number(major) <= 99)) || (seq !== undefined && !(Number(seq) >= 1 && Number(seq) <= 99))) throw invalid('차수는 1~99 범위의 숫자여야 합니다.');
  const week = major ? `${major.padStart(2, '0')}${seq ? '-' + seq.padStart(2, '0') : ''}` : '';
  const pageText = input.page === undefined ? '1' : scalar(input.page, '페이지');
  if (!/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 10000) throw invalid('페이지 범위가 올바르지 않습니다.');
  const custName = scalar(input.custName, '거래처');
  const prodName = scalar(input.prodName, '품목');
  if (custName.length > 200 || prodName.length > 200) throw invalid('검색어는 200자 이하로 입력하세요.');
  const custNames = custName ? [] : [...new Set(scalar(input.custNames, '거래처 목록').split('|').map(v=>v.trim()).filter(Boolean))];
  if (custNames.length > 80) throw invalid('거래처 목록은 80개 이하로 조회하세요.');
  return { year, week, majorOnly: !!major && !seq, custName, prodName, custNames, page: Number(pageText) };
}
const escapeLike = value => value.replace(/[~%_\[]/g, char => '~' + char);
export function buildOrderHistoryWhere(scope) {
  const clauses = ['om.OrderYear = @year'];
  const values = { year: scope.year };
  if (scope.week) {
    clauses.push(scope.majorOnly ? 'om.OrderWeek LIKE @week' : 'om.OrderWeek = @week');
    values.week = scope.majorOnly ? `${scope.week}-%` : scope.week;
  }
  for (const [prefix, text, columns] of [['cust', scope.custName, ['c.CustName']], ['prod', scope.prodName, ['p.ProdName', 'p.FlowerName', 'p.CounName']]]) {
    text.split(/\s+/).filter(Boolean).forEach((token, i) => {
      const key = `${prefix}${i}`;
      values[key] = `%${escapeLike(token.toLowerCase())}%`;
      clauses.push(`(${columns.map(col => `LOWER(${col}) LIKE @${key} ESCAPE N'~'`).join(' OR ')})`);
    });
  }
  if (scope.custNames.length) {
    const keys = scope.custNames.map((name, i) => { const key = `name${i}`; values[key] = name; return `@${key}`; });
    clauses.push(`c.CustName IN (${keys.join(',')})`);
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, values };
}
