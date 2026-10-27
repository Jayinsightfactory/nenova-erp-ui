import { parseMarginScope } from './profitCustomerMargin.mjs';

function explicitScope(year, week) {
  if (Array.isArray(year) || Array.isArray(week)) throw new Error('연도와 차수는 하나씩 선택하세요.');
  return parseMarginScope(String(year ?? ''), String(week ?? ''));
}

export const isKnown = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
export function displayNumber(value, digits = 0) {
  return isKnown(value) ? Number(value).toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '미확정';
}
export function displayPercent(value) {
  return isKnown(value) ? `${displayNumber(Number(value) * 100, 2)}%` : '미확정';
}
export function displayPoints(value) {
  return isKnown(value) ? `${Number(value) > 0 ? '+' : ''}${displayNumber(value, 2)}%p` : '비교 불가';
}
export function differencePoints(current, previous) {
  return isKnown(current) && isKnown(previous) ? (Number(current) - Number(previous)) * 100 : null;
}
export function salesPhysicalAverageCost(metrics) {
  return isKnown(metrics?.costAmount) && isKnown(metrics?.physicalQuantity) && Number(metrics.physicalQuantity) > 0
    ? Number(metrics.costAmount) / Number(metrics.physicalQuantity) : null;
}
export function coverageText(metrics) {
  const c = metrics?.coverage;
  if (!c) return '원가 확인 범위 미확정';
  const unknown = Array.isArray(c.unknownProducts) ? c.unknownProducts.length : c.unknownProducts;
  return `원가 확인 매출 ${displayNumber(c.knownSales)} / ${displayNumber(c.totalSales)}원 · 미확정 ${displayNumber(unknown)}품목`;
}
const warningLabels = {
  MIXED_UNITS: '기준단위가 달라 하나의 평균단가·수량으로 비교할 수 없습니다.',
  NON_POSITIVE_OR_INVALID_SALE_EXCLUDED: '반품·음수·수량 0 등은 양수 판매대상의 구성 분해와 분리해 남은 차이에서 확인합니다.',
  NEW_OR_EXITED_PAIRS_OUTSIDE_COMMON_COHORT: '신규·이탈 업체/품목은 공통대상 밖입니다. 없는 과거 단가를 0원으로 채우지 않았습니다.',
  COMMON_COHORT_COST_INCOMPLETE: '공통 판매대상 중 원가 미확정 품목이 있어 확인된 부분만 이익 변화를 분해했습니다.',
  NO_COMMON_POSITIVE_SALES: '두 차수에 공통으로 판매된 양수 품목·업체가 없어 구성·단가 비교가 불가능합니다.',
  REPORTED_INPUT_INCOMPLETE: '기존 보고서의 계산 입력이 부족해 수익률 차이 검산이 미확정입니다.',
  REPORTED_PROFIT_BRIDGE_RESIDUAL: '기존 보고서 이익 차이와 항목별 금액 기여의 합이 일치하지 않습니다. 미설명 차이를 확인하세요.',
  REPORTED_RATE_BRIDGE_RESIDUAL: '기존 보고서 수익률 차이와 항목별 %p 기여가 일치하지 않습니다. 단순 합산으로 완료 판정하지 마세요.',
};
export function warningText(warning) {
  const text = typeof warning === 'string' ? warning : warning?.message ?? warning?.reason ?? warning?.label ?? warning?.code ?? '확인 필요';
  return warningLabels[text] ?? text;
}
export function marginGroupLabel(group) {
  const category = String(group.category ?? '').trim();
  const country = String(group.country ?? '').trim();
  const flower = String(group.flower ?? '').trim();
  let title = category || [country, flower].filter(Boolean).join(' · ') || '미분류';
  if (category && country && category.includes(country) && flower && !category.includes(flower)) title += ` · ${flower}`;
  const kinds = Array.isArray(group.kinds) ? group.kinds : [];
  if (!kinds.includes('N')) {
    if (kinds.includes('L') && kinds.includes('O')) title += ' · 차감·운임/기타매출';
    else if (kinds.includes('L')) title += ' · 차감';
    else if (kinds.includes('O')) title += ' · 운임/기타매출';
  }
  const raw = [country, flower].filter(Boolean);
  return { title, sourceLabel: raw.some(value => !title.includes(value)) ? `원품목 분류: ${raw.join(' · ')}` : '' };
}
export function filterMarginGroups(groups, search) {
  const needle = String(search ?? '').trim().toLocaleLowerCase('ko-KR');
  if (!needle) return groups;
  return groups.filter(g => [g.category, g.country, g.flower, g.unit,
    ...(g.customers ?? []).map(c => c.custName), ...(g.products ?? []).map(p => p.productName)]
    .some(value => String(value ?? '').toLocaleLowerCase('ko-KR').includes(needle)));
}
export function attachGroupCostBasis(products = [], groupProducts = []) {
  const keyOf = p => JSON.stringify([String(p.prodKey), String(p.unit)]);
  const byKey = new Map();
  for (const p of groupProducts) {
    if (p.prodKey == null || !p.unit) continue;
    const key = keyOf(p);
    byKey.set(key, byKey.has(key) ? null : p); // Ambiguous evidence is not an automatic match.
  }
  return products.map(p => {
    const matched = p.prodKey == null || !p.unit ? null : byKey.get(keyOf(p));
    return { ...p, costBasis: matched?.costBasis ?? null, previousCostBasis: matched?.previousCostBasis ?? null };
  });
}
export function marginQuery(input) {
  const scope = explicitScope(input.year, input.week);
  const params = new URLSearchParams({ year: scope.year, week: scope.major });
  const hasPrevious = input.compareYear !== undefined && input.compareYear !== '' || input.compareWeek !== undefined && input.compareWeek !== '';
  if (hasPrevious) {
    const previous = explicitScope(input.compareYear, input.compareWeek);
    if (Number(previous.year + previous.major) >= Number(scope.year + scope.major)) throw new Error('비교 차수는 조회 차수보다 이전이어야 합니다.');
    params.set('compareYear', previous.year); params.set('compareWeek', previous.major);
  }
  return params;
}
export function customerMarginUrl(year, major) {
  const query = marginQuery({ year, week: major });
  query.set('popup', '1');
  return `/sales/profit-customer-margin?${query}`;
}
export async function loadCustomerMargin(input, { fetcher = fetch, signal } = {}) {
  const query = marginQuery(input);
  const response = await fetcher(`/api/sales/profit-customer-margin?${query}`, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
  });
  signal?.throwIfAborted();
  if (!response.ok) throw new Error([401, 403].includes(response.status)
    ? '로그인 또는 매출자료 조회 권한을 확인하세요.' : `업체비중 조회 실패 (HTTP ${response.status}). 다시 조회하세요.`);
  const data = await response.json();
  signal?.throwIfAborted();
  if (!data?.ok) throw new Error(data?.error || data?.message || '업체비중 자료 조회에 실패했습니다.');
  const same = (period, year, week) => String(period?.year) === String(year) && Number(period?.major) === Number(week);
  if (!same(data.current, query.get('year'), query.get('week')) ||
      query.has('compareWeek') && !same(data.previous, query.get('compareYear'), query.get('compareWeek'))) {
    throw new Error('요청한 연도·차수와 응답이 다릅니다. 다시 조회하세요.');
  }
  const previous = explicitScope(data.previous?.year, data.previous?.major);
  if (Number(previous.year + previous.major) >= Number(query.get('year') + query.get('week'))) throw new Error('비교 차수 응답이 조회 차수보다 이전이 아닙니다.');
  if (!Array.isArray(data.groups) || !Array.isArray(data.reported) || data.metadata?.readOnly !== true) {
    throw new Error('분석 자료 형식 또는 읽기 전용 범위를 확인할 수 없습니다.');
  }
  return data;
}

// Only move among the current table's row buttons, never hijack input caret keys.
export function navigateMarginRows(event) {
  if (!event.currentTarget.matches?.('button[data-margin-row], summary[data-margin-row]')) return;
  const buttons = [...(event.currentTarget.closest('tbody')?.querySelectorAll(':scope > tr > th button[data-margin-row], :scope > tr > th > details > summary[data-margin-row]') ?? [])];
  const at = buttons.indexOf(event.currentTarget);
  const next = event.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1)
    : event.key === 'ArrowUp' ? Math.max(at - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
  if (at >= 0 && next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
}

export function closeMarginDetails(event) {
  if (event.key !== 'Escape') return;
  const details = event.target.closest?.('details[open]');
  if (!details) return;
  event.stopPropagation(); event.preventDefault(); details.open = false;
  details.querySelector('summary')?.focus();
}
