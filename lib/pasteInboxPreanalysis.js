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

// Disk-backed successful analyses remain visible until explicitly replaced.
// Durable successes remain usable without a restoration request.
function usablePreparedAnalysis(value, text, week, now = Date.now()) {
  if (!value || value.key !== analysisKey(text, week) || value.data?.success !== true || !Array.isArray(value.data.orders)
    || !Number.isFinite(now) || !Number.isFinite(value.at) || value.at < 0 || value.at > now) return false;
  const storage = value.data.analysisStorage;
  if (!storage) return usableAnalysis(value, text, week, now);
  return Number.isFinite(storage.savedAt) && storage.savedAt >= 0 && storage.savedAt <= now;
}

// One page owns this memory cache; the optional authenticated fetcher persists
// results across authenticated users. Only new analyses queue; no ERP writes occur here.
function createPreanalysisCache({fetcher, persistent = false, now = Date.now, autoLimit = AUTO_LIMIT}) {
  const entries = new Map();
  let tail = Promise.resolve(), automaticCount = 0;
  return {
    async read(text, week, {automatic = false, eligible = () => true, force = false, lookupOnly = false, onStatus = () => {}} = {}) {
      const key = analysisKey(text, week);
      const prior = entries.get(key);
      if (!force && usableAnalysis(prior?.result, text, week, now())) return structuredClone(prior.result);
      // Refresh shared edits after TTL, but failed/missing restoration cannot
      // erase an already durable match or trigger a fresh model call.
      if (!force && persistent && usablePreparedAnalysis(prior?.result, text, week, now())) {
        try {
          onStatus('restoring');
          const saved = await fetcher(text, week, {lookupOnly: true});
          if (saved?.analysisStorage?.cacheHit && saved.success && Array.isArray(saved.orders)) prior.result = {key, at: now(), data: saved};
        } catch { /* Last saved success remains available during an outage. */ }
        return structuredClone(prior.result);
      }
      // Hydration is read-only and independent of visibility, auto opt-in and
      // unrelated pending model work. A miss never enters the analysis queue.
      if (lookupOnly) {
        if (!persistent) return null;
        onStatus('restoring');
        const saved = await fetcher(text, week, {lookupOnly: true});
        if (saved?.analysisStorage?.cacheMiss) return null;
        if (!saved?.analysisStorage?.cacheHit || !saved.success || !Array.isArray(saved.orders)) throw new Error('저장된 분석 조회 응답을 확인할 수 없습니다.');
        const result = {key, at: now(), data: saved};
        if (prior) prior.result = structuredClone(result);
        else entries.set(key, {result: structuredClone(result)});
        for (const [oldKey, old] of entries) {
          if (entries.size <= 100) break;
          if (!old.pending) entries.delete(oldKey);
        }
        return structuredClone(result);
      }
      if (prior?.pending) {
        prior.listeners.add(onStatus);
        onStatus(prior.status);
        try { return structuredClone(await prior.pending); }
        finally { prior.listeners.delete(onStatus); }
      }
      const entry = {listeners: new Set([onStatus]), ...(prior?.result ? {result: prior.result} : {})};
      const status = value => {entry.status = value; for (const listener of entry.listeners) listener(value);};
      entries.set(key, entry);
      const checkEligible = () => {if (!eligible()) {const error=new Error('화면 대기 · 다시 보이면 분석합니다.');error.code='PREANALYSIS_DEFERRED';throw error;}};
      const accept = data => {
        if (!data?.success || !Array.isArray(data.orders)) throw new Error(typeof data?.error === 'string' ? data.error : '분석 응답을 확인할 수 없습니다.');
        const result = {key, at: now(), data};
        entry.result = structuredClone(result);
        return structuredClone(result);
      };
      const pending = (async () => {
        checkEligible();
        // Saved results must not wait behind unrelated, slow Claude calls.
        if (persistent && !force) {
          status('restoring');
          const saved = await fetcher(text, week, {lookupOnly: true});
          if (saved?.analysisStorage?.cacheHit) return accept(saved);
          if (!saved?.analysisStorage?.cacheMiss) throw new Error('저장된 분석 조회 응답을 확인할 수 없습니다.');
        }
        status('queued');
        const queued = tail.catch(() => {}).then(async () => {
          checkEligible();
          const allowAnalyze = !automatic || automaticCount < autoLimit;
          if (!persistent && !allowAnalyze) throw new Error('자동 분석 20건 사용 · 지금 분석을 눌러 계속하세요.');
          // Reserve before calling: failed Claude attempts also consume budget.
          if (automatic && allowAnalyze) automaticCount++;
          status('analyzing');
          const data = await fetcher(text, week, {force, allowAnalyze});
          if (automatic && allowAnalyze && data?.analysisStorage?.cacheHit) automaticCount--;
          return accept(data);
        });
        tail = queued.catch(() => {});
        return queued;
      })();
      entry.pending = pending;
      try { return await pending; }
      finally {
        delete entry.pending;
        entry.listeners.clear();
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

module.exports = {TTL_MS, AUTO_LIMIT, analysisKey, usableAnalysis, usablePreparedAnalysis, createPreanalysisCache, analysisGroups};
