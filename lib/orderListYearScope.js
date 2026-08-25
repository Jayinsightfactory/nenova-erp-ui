import { validateOrderWeek } from './orderUtils.js';

function inputError(message, code = 'ORDER_LIST_YEAR_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function dateYear(value) {
  const match = String(value || '').trim().match(/^(\d{4})-\d{2}-\d{2}$/);
  return match ? match[1] : '';
}

/**
 * 주문관리의 짧은 차수(NN-NN)를 어느 연도로 조회할지 결정한다.
 * 우선순위: 차수에 포함된 연도 -> 명시 year -> 같은 연도의 조회기간 -> 현재 연도.
 * 조회기간이 연도를 가로지르면 짧은 차수만으로는 모호하므로 전체 차수를 요구한다.
 */
export function resolveOrderListYearScope({
  week,
  explicitYear = '',
  startDate = '',
  endDate = '',
  fallbackYear = new Date().getFullYear().toString(),
} = {}) {
  const parsed = validateOrderWeek(String(week || ''));
  const requestedYear = String(explicitYear || '').trim();
  if (requestedYear && !/^\d{4}$/.test(requestedYear)) {
    throw inputError(`조회 연도는 4자리여야 합니다 (받음: '${requestedYear}').`);
  }
  if (parsed.year && requestedYear && parsed.year !== requestedYear) {
    throw inputError(
      `차수의 연도(${parsed.year})와 조회 연도(${requestedYear})가 다릅니다.`,
      'ORDER_LIST_YEAR_MISMATCH',
    );
  }
  if (parsed.year) return { orderYear: parsed.year, orderWeek: parsed.week, source: 'FULL_WEEK' };
  if (requestedYear) return { orderYear: requestedYear, orderWeek: parsed.week, source: 'EXPLICIT_YEAR' };

  const startYear = dateYear(startDate);
  const endYear = dateYear(endDate);
  if (startYear && endYear && startYear !== endYear) {
    throw inputError(
      '조회기간이 두 연도에 걸쳐 있습니다. 차수를 YYYY-NN-NN 형식으로 입력하세요.',
      'ORDER_LIST_YEAR_AMBIGUOUS',
    );
  }
  const rangeYear = startYear || endYear;
  const fallback = String(fallbackYear || '').trim();
  if (rangeYear) return { orderYear: rangeYear, orderWeek: parsed.week, source: 'DATE_RANGE' };
  if (!/^\d{4}$/.test(fallback)) {
    throw inputError('조회 연도를 확인할 수 없습니다.', 'ORDER_LIST_YEAR_REQUIRED');
  }
  return { orderYear: fallback, orderWeek: parsed.week, source: 'CURRENT_YEAR' };
}

