// lib/chat/costTracker.js — Claude API 호출 비용 추적
//
// 각 호출의 모델/토큰/추정비용을 인메모리로 집계 (24h 롤링).
// pm2 재시작 시 초기화.
//
// 기준 가격 (2026년 공개가, USD per 1M tokens):
//   haiku-4-5 : input $1   / output $5
//   sonnet-4-5: input $3   / output $15

const PRICES = {
  'claude-haiku-4-5':  { input: 1,  output: 5  },
  'claude-sonnet-4-5': { input: 3,  output: 15 },
  'claude-opus-4-5':   { input: 15, output: 75 },
};

const TTL_MS = 24 * 60 * 60 * 1000;
const log = []; // { ts, userId, model, inputTokens, outputTokens, costUSD, purpose }

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  while (log.length > 0 && log[0].ts < cutoff) log.shift();
}, 10 * 60 * 1000);

export function trackLLMCall({ userId, model, inputTokens = 0, outputTokens = 0, purpose = '' }) {
  const p = PRICES[model] || { input: 3, output: 15 };
  const costUSD = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  log.push({
    ts: Date.now(),
    userId: userId || 'anon',
    model,
    inputTokens, outputTokens,
    costUSD,
    purpose,
  });
}

export function getCostStats() {
  if (log.length === 0) {
    return { totalCalls: 0, totalCostUSD: 0, totalCostKRW: 0 };
  }
  const byModel = {};
  const byUser = {};
  const byPurpose = {};
  let totalCostUSD = 0;
  let totalInput = 0, totalOutput = 0;

  for (const e of log) {
    totalCostUSD += e.costUSD;
    totalInput += e.inputTokens;
    totalOutput += e.outputTokens;

    byModel[e.model] = byModel[e.model] || { calls: 0, costUSD: 0, inputTokens: 0, outputTokens: 0 };
    byModel[e.model].calls++;
    byModel[e.model].costUSD += e.costUSD;
    byModel[e.model].inputTokens += e.inputTokens;
    byModel[e.model].outputTokens += e.outputTokens;

    byUser[e.userId] = (byUser[e.userId] || 0) + e.costUSD;
    byPurpose[e.purpose || '(no purpose)'] = (byPurpose[e.purpose || '(no purpose)'] || 0) + e.costUSD;
  }

  // 시간당 평균 (최근 24h 기준)
  const hoursSpan = Math.max(1, (Date.now() - log[0].ts) / 3600_000);
  const costPerHour = totalCostUSD / hoursSpan;

  return {
    totalCalls: log.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
    totalCostKRW: Math.round(totalCostUSD * 1400), // 환율 1400원 가정
    costPerHourUSD: Math.round(costPerHour * 10000) / 10000,
    projectedDailyUSD: Math.round(costPerHour * 24 * 100) / 100,
    projectedMonthlyUSD: Math.round(costPerHour * 24 * 30 * 100) / 100,
    byModel: Object.entries(byModel).map(([m, s]) => ({
      model: m, calls: s.calls,
      inputTokens: s.inputTokens, outputTokens: s.outputTokens,
      costUSD: Math.round(s.costUSD * 10000) / 10000,
    })),
    topUsers: Object.entries(byUser)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([u, c]) => ({ userId: u, costUSD: Math.round(c * 10000) / 10000 })),
    topPurposes: Object.entries(byPurpose)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([p, c]) => ({ purpose: p, costUSD: Math.round(c * 10000) / 10000 })),
    oldestEntry: new Date(log[0].ts).toISOString(),
    newestEntry: new Date(log[log.length - 1].ts).toISOString(),
  };
}
