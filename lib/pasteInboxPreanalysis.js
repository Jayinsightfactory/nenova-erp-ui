'use strict';

const TTL_MS = 15 * 60 * 1000;
const AUTO_LIMIT = 20;
function analysisKey(text, week) {
  if (typeof text !== 'string' || !text.trim() || !/^20\d{2}-(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/.test(week)) throw new Error('분석할 원문과 연도·차수를 확인하세요.');
  return JSON.stringify([week, text]);
}
function usableAnalysis(value, text, week, now = Date.now()) {
  return !!value && value.key === analysisKey(text, week) && now >= value.at && now - value.at < TTL_MS && value.data?.success === true && Array.isArray(value.data.orders);
}

// One page owns one cache. No cross-user/global storage, no ERP writes. Queueing
// and deduplication apply to both automatic preparation and explicit opening.
function createPreanalysisCache({fetcher, persistent = false, now = Date.now, autoLimit = AUTO_LIMIT}) {
  const entries = new Map();
  let tail = Promise.resolve(), automaticCount = 0;
  return {
    async read(text, week, {automatic = false, eligible = () => true, force = false} = {}) {
      const key = analysisKey(text, week);
      const prior = entries.get(key);
      if (prior?.pending) return structuredClone(await prior.pending);
      if (!force && usableAnalysis(prior?.result, text, week, now())) return structuredClone(prior.result);
      const entry = {};
      entries.set(key, entry);
      const pending = tail.catch(() => {}).then(async () => {
        if (!eligible()) {const error=new Error('화면 대기 · 다시 보이면 분석합니다.');error.code='PREANALYSIS_DEFERRED';throw error;}
        const allowAnalyze = !automatic || automaticCount < autoLimit;
        if (!persistent && !allowAnalyze) throw new Error('자동 분석 20건 사용 · 지금 분석을 눌러 계속하세요.');
        const data = await fetcher(text, week, {force, allowAnalyze});
        if (automatic && !data?.analysisStorage?.cacheHit) automaticCount++;
        if (!data?.success || !Array.isArray(data.orders)) throw new Error(typeof data?.error === 'string' ? data.error : '분석 응답을 확인할 수 없습니다.');
        const result = {key, at: now(), data};
        entry.result = structuredClone(result);
        return structuredClone(result);
      });
      entry.pending = pending;
      tail = pending.catch(() => {});
      try { return await pending; }
      finally {
        delete entry.pending;
        if (!entry.result) entries.delete(key);
        for (const [oldKey, old] of entries) {
          if (entries.size <= 100) break;
          if (!old.pending) entries.delete(oldKey);
        }
      }
    },
  };
}

function analysisGroups(data) {
  return (data?.orders || []).map(order => ({
    customer: order.custMatch?.CustName || order.custName || '업체 확인 필요',
    sourceCustomer: order.custName || '',
    customerMatched: Number(order.custMatch?.CustKey) > 0,
    items: (order.items || []).map(item => ({
      product: item.prodName || item.inputName || '품목 확인 필요',
      source: item.inputName || '',
      quantity: item.quantitySource || `${Number(item.qty).toLocaleString('ko-KR', {maximumFractionDigits: 3})} ${item.unit || ''}`,
      action: item.action === '취소' || item.action === 'CANCEL' ? '−' : '+',
      matched: Number(order.custMatch?.CustKey) > 0 && Number(item.prodKey) > 0 && Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 && ['박스','단','송이'].includes(item.unit) && !item.mixedQuantityError && !item.ambiguousCountry && !item.fallbackSuspect,
      reason: item.mixedQuantityError || item.ambiguityReason || '',
    })),
  }));
}

module.exports = {TTL_MS, AUTO_LIMIT, analysisKey, usableAnalysis, createPreanalysisCache, analysisGroups};
