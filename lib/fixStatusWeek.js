// 붙여넣기 주문등록의 선택 차수를 확정현황 API가 받는 명시 연도 형식으로 고정한다.
import { resolveOrderWeekQuery } from './orderUtils.js';

export function toFullFixStatusWeek(selectedWeek) {
  const { week, year } = resolveOrderWeekQuery(selectedWeek);
  return week && year ? `${year}-${week}` : '';
}

export function matchesFullFixStatusWeek(row, fullWeek) {
  return `${row?.OrderYear || ''}-${row?.OrderWeek || ''}` === fullWeek;
}
