import { AsyncLocalStorage } from 'node:async_hooks';

// Opt-in calculation scope; never replaces the process pool or another request's reader.
const contexts = new AsyncLocalStorage();
export const currentErpReadContext = () => contexts.getStore();
export function erpContextCache(name, fallback, factory = () => new Map()) {
  const context = currentErpReadContext();
  if (!context) return fallback;
  if (!context.caches.has(name)) context.caches.set(name, factory());
  return context.caches.get(name);
}
export async function withErpReadContext({ queryFn, externalEvidence = {} }, work) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn is required');
  let tail = Promise.resolve();
  const context = { caches: new Map(), externalEvidence, missingEvidence: new Set(), failures: [],
    query: (statement, params = {}) => {
      const pending = tail.then(() => {
        if(context.closedError)throw context.closedError;
        const sql=String(statement).replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ').trim();
        if(!/^(SELECT|WITH|;)\b/i.test(sql) && !sql.startsWith(';WITH')) throw new Error('Report calculation scope only permits read queries');
        return queryFn(statement, params);
      });
      tail = pending.catch(error => { context.failures.push(error); });
      return pending;
    },
  };
  return contexts.run(context, async () => {
    let value;
    try { value = await work(); } catch(error) { context.closedError=error; throw error; } finally {
      for (;;) { const pending=tail; await pending; await Promise.resolve(); if(pending===tail)break; }
    }
    if (context.failures.length) throw Object.assign(new Error('보고서 원천 조회가 실패했습니다. 전체 변경을 취소합니다.'), {
      code: 'APPROVAL_REPORT_SOURCE_FAILED', cause: context.failures[0],
    });
    if (context.missingEvidence.size) throw Object.assign(new Error('보고서 환율 근거를 먼저 조회해야 합니다.'), {
      code: 'APPROVAL_EXTERNAL_EVIDENCE_REQUIRED', evidenceKeys: [...context.missingEvidence].sort(),
    });
    return value;
  });
}
