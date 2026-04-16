// lib/apiLogger.js — API 호출 빈도 추적 (인메모리, 24시간 롤링)
//
// 목적:
//   직원들이 어떤 API(=어떤 데이터)를 가장 자주 조회하는지 집계.
//   이 데이터를 챗봇 LLM 프롬프트에 주입하면 "이 사람이 뭘 물어볼지" 예측 가능.
//
// 비용: 0 (외부 DB 사용 안 함, 인메모리 Map)
// pm2 재시작 시 초기화 — 그래도 OK (추세만 있으면 충분)

const ROLLING_HOURS = 24;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10분

// { endpoint: string, userId: string, ts: number }[]
const log = [];

export function trackApiCall(userId, url) {
  if (!url || url.startsWith('/_next/') || url.startsWith('/api/auth/')) return; // noise 제외
  const endpoint = url.split('?')[0]; // query string 제거
  log.push({ endpoint, userId: userId || 'anon', ts: Date.now() });
}

// 오래된 엔트리 정리
setInterval(() => {
  const cutoff = Date.now() - ROLLING_HOURS * 3600 * 1000;
  while (log.length > 0 && log[0].ts < cutoff) log.shift();
}, CLEANUP_INTERVAL_MS);

// ── 전체 사용자 TOP N 엔드포인트
export function getTopEndpoints(n = 20) {
  const counts = {};
  for (const e of log) {
    counts[e.endpoint] = (counts[e.endpoint] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([endpoint, count]) => ({ endpoint, count }));
}

// ── 특정 사용자 TOP N
export function getUserTopEndpoints(userId, n = 10) {
  const counts = {};
  for (const e of log) {
    if (e.userId !== userId) continue;
    counts[e.endpoint] = (counts[e.endpoint] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([endpoint, count]) => ({ endpoint, count }));
}

// ── 시간대별 활동 분포 (0~23시)
export function getHourlyDistribution() {
  const hours = Array(24).fill(0);
  for (const e of log) {
    hours[new Date(e.ts).getHours()]++;
  }
  return hours;
}

// ── 통계 요약
export function getStats() {
  return {
    totalCalls: log.length,
    uniqueUsers: new Set(log.map(e => e.userId)).size,
    uniqueEndpoints: new Set(log.map(e => e.endpoint)).size,
    oldestEntry: log[0]?.ts ? new Date(log[0].ts).toISOString() : null,
    newestEntry: log[log.length - 1]?.ts ? new Date(log[log.length - 1].ts).toISOString() : null,
  };
}

// ── 챗봇 프롬프트용 요약 텍스트
export function getUsagePrompt(userId) {
  const global = getTopEndpoints(15);
  const user = userId ? getUserTopEndpoints(userId, 10) : [];

  if (global.length === 0) return '';

  const endpointLabel = (ep) => {
    // /api/orders → 주문관리, /api/shipment → 출고 등 한국어 매핑
    if (ep.includes('/orders')) return '주문관리';
    if (ep.includes('/shipment')) return '출고';
    if (ep.includes('/estimate')) return '견적서';
    if (ep.includes('/stock')) return '재고';
    if (ep.includes('/products')) return '품목';
    if (ep.includes('/customers')) return '거래처';
    if (ep.includes('/sales')) return '매출';
    if (ep.includes('/finance')) return '재무';
    if (ep.includes('/purchase')) return '구매';
    if (ep.includes('/stats')) return '통계';
    if (ep.includes('/m/chat')) return '챗봇';
    return ep.replace('/api/', '');
  };

  const lines = [];
  lines.push('## 직원들이 가장 자주 보는 데이터 (최근 24시간 API 호출 기준)');
  lines.push('전체: ' + global.map(e => `${endpointLabel(e.endpoint)}(${e.count})`).join(', '));
  if (user.length > 0) {
    lines.push('이 사용자: ' + user.map(e => `${endpointLabel(e.endpoint)}(${e.count})`).join(', '));
  }
  lines.push('→ 위 빈도 높은 데이터에 대한 질문이 올 확률이 높다. 우선적으로 정확한 답변을 준비.');
  return lines.join('\n');
}
