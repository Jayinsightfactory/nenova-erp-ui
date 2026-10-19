import { outputScope } from './profitRangeOutput.mjs';

export function reportScopeFromSearch(search) {
  const params = new URLSearchParams(search);
  if (!params.has('year') && !params.has('week')) return null;
  const single = key => params.getAll(key).length === 1 ? params.get(key) : params.getAll(key);
  return outputScope(single('year'), single('week'));
}

export function validationWindowUrl(year, major) {
  const scope = outputScope(year, major);
  return `/sales/profit-validation?${new URLSearchParams({ year: scope.year, week: scope.major, popup: '1' })}`;
}

export function assertValidationResponse(data, scope) {
  if (!data?.success) throw new Error(data?.error || '점검 자료 조회 실패');
  if (String(data.orderYear) !== scope.year || String(data.major) !== scope.major) {
    throw new Error('요청한 연도·차수와 응답이 다릅니다. 다시 조회하세요.');
  }
  if (!Array.isArray(data.rows)) throw new Error('점검 자료 형식이 올바르지 않습니다.');
  return data;
}

// Only existing read endpoints. No snapshot refresh, report save, or LLM request.
export async function loadValidationWindow({ year, major, fetcher = fetch, signal }) {
  const scope = outputScope(year, major);
  const query = new URLSearchParams({ year: scope.year, week: scope.major });
  const load = async (path) => {
    signal?.throwIfAborted();
    const response = await fetcher(`${path}?${query}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? '로그인 또는 조회 권한을 확인하세요.' : `자료 조회 실패 (HTTP ${response.status})`);
    const data = await response.json();
    signal?.throwIfAborted();
    return assertValidationResponse(data, scope);
  };
  const results = await Promise.allSettled([
    load('/api/sales/profit-report'), load('/api/sales/profit-report-week-check'),
  ]);
  signal?.throwIfAborted();
  const unpack = (result) => result.status === 'fulfilled'
    ? { data: result.value, error: '' } : { data: null, error: result.reason?.message || '조회 실패' };
  return { ...scope, report: unpack(results[0]), checks: unpack(results[1]), queriedAt: new Date().toISOString() };
}

export function reportBasis(report) {
  if (!report) return '보고서 조회 실패 · 판정 불가';
  if (report.confirmed) return `확정 보고서 · R${report.confirmed.revisionNo ?? '?'}. 아래 현재 원장 점검과 기준시점이 다를 수 있습니다.`;
  if (report.snapshot?.state === 'stale' && report.snapshot?.servedFrom === 'snapshot') {
    return '원천 변경 감지 · 이전 계산 저장본입니다. 최신 결과로 판정하지 마세요. 보고서에서 갱신 후 다시 조회하세요.';
  }
  return report.snapshot?.servedFrom === 'snapshot' ? '계산 저장본 참고 · 전체 원장 검증 완료를 뜻하지 않습니다.' : '조회 시 계산값 참고 · 전체 원장 검증 완료를 뜻하지 않습니다.';
}
