// 연간 월별 매출이익 보고서 분류 — 기존 주차 원장만 재분류하는 순수 함수.
//
// 한 차수가 목~수 달력 범위를 두 달에 걸치면 어느 한 달에 임의 귀속하지 않는다.
// 해당 주차의 기존 손익은 monthly boundary 목록에 남기고 월별 합계에서는 제외한다.

const MONTH_COUNT = 12;
const NUMERIC_COLUMNS = ['C', 'G', 'H', 'I', 'J', 'L', 'N', 'O', 'P', 'Q', 'S', 'T'];

function asDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

export function ymd(value) {
  const d = asDateOnly(value);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export function monthKeyFromDate(value) {
  const d = asDateOnly(value);
  return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : null;
}

export function classifyProfitWeek(period) {
  const startDate = ymd(period?.startDate);
  const endDate = ymd(period?.endDate);
  const startMonth = monthKeyFromDate(startDate);
  const endMonth = monthKeyFromDate(endDate);
  const hasValidRange = Boolean(startDate && endDate && startDate <= endDate && startMonth && endMonth);
  return {
    startDate,
    endDate,
    startMonth,
    endMonth,
    valid: hasValidRange,
    kind: !hasValidRange ? 'missing_period' : startMonth === endMonth ? 'included' : 'boundary',
  };
}

function emptyTotals() {
  return Object.fromEntries(NUMERIC_COLUMNS.map(key => [key, 0]));
}

function addTotals(target, source) {
  for (const key of NUMERIC_COLUMNS) target[key] += Number(source?.[key] || 0);
  return target;
}

function monthRow(year, month) {
  return {
    year: String(year),
    month,
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    includedWeeks: [],
    boundaryWeeks: [],
    missingWeeks: [],
    totals: emptyTotals(),
    // 주차 합계행의 기존 이익률 분모(C+F)를 내부적으로만 보존한다.
    // 월별 표에는 F를 표시하거나 합산하지 않는다.
    marginDenominator: 0,
    status: 'no_data',
  };
}

/**
 * @param {Array<{major:string, period?:object, totals?:object, rows?:Array, error?:string}>} weeks
 * @param {string|number} year
 * @returns {{year:string, months:Array, boundaryWeeks:Array, missingWeeks:Array, includedWeeks:Array}}
 */
export function buildMonthlyProfitSummary(weeks, year) {
  const orderYear = String(year);
  const months = Array.from({ length: MONTH_COUNT }, (_, i) => monthRow(orderYear, i + 1));
  const boundaryWeeks = [];
  const missingWeeks = [];
  const includedWeeks = [];

  for (const week of weeks || []) {
    const classification = classifyProfitWeek(week?.period);
    const item = {
      major: String(week?.major || '').padStart(2, '0'),
      period: classification,
      totals: week?.totals || emptyTotals(),
      error: week?.error || null,
    };
    if (week?.error || classification.kind === 'missing_period') {
      missingWeeks.push(item);
      continue;
    }
    if (classification.kind === 'boundary') {
      boundaryWeeks.push(item);
      // 참고용 차수 목록은 해당 차수가 걸친 두 달에 모두 표시하되,
      // 금액은 월별 합계에 넣지 않는다. 사용자가 어느 달과 연결됐는지 바로 확인할 수 있다.
      for (const monthKey of new Set([classification.startMonth, classification.endMonth])) {
        const month = months.find(m => m.monthKey === monthKey);
        if (month) month.boundaryWeeks.push(item);
      }
      continue;
    }

    const month = months.find(m => m.monthKey === classification.startMonth);
    if (!month) {
      missingWeeks.push(item);
      continue;
    }
    month.includedWeeks.push(item);
    addTotals(month.totals, item.totals);
    month.marginDenominator += Number(item.totals?.C || 0) + Number(item.totals?.F || 0);
    includedWeeks.push(item);
  }

  for (const month of months) {
    month.includedWeeks.sort((a, b) => a.major.localeCompare(b.major));
    month.boundaryWeeks.sort((a, b) => a.major.localeCompare(b.major));
    month.status = month.includedWeeks.length > 0
      ? (month.boundaryWeeks.length > 0 ? 'included_with_boundary' : 'included')
      : month.boundaryWeeks.length > 0 ? 'boundary_only' : 'no_data';
    month.totals.K = month.marginDenominator !== 0 ? month.totals.J / month.marginDenominator : null;
  }

  boundaryWeeks.sort((a, b) => a.major.localeCompare(b.major));
  missingWeeks.sort((a, b) => a.major.localeCompare(b.major));
  includedWeeks.sort((a, b) => a.major.localeCompare(b.major));
  return { year: orderYear, months, boundaryWeeks, missingWeeks, includedWeeks };
}

export const monthlyProfitColumns = NUMERIC_COLUMNS;
