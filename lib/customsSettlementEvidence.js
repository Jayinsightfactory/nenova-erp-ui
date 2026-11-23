import fs from 'node:fs/promises';
import path from 'node:path';
import { currentErpReadContext, erpContextCache } from './erpReadContext.js';
import store from './customsSettlementStore.cjs';
import policy from './customsSettlementPlan.cjs';
import costPolicy from './customsSettlementCostPolicy.cjs';
import phase03 from './customsPhase03.cjs';
import vietnamGross from './customsVietnamGross.cjs';

export async function loadSettlementEvidence(year, major) {
  const scope = policy.scopeOf(year, major), key = `customs-settlement:${scope.year}:${scope.major}`;
  const context = currentErpReadContext();
  const cache = erpContextCache('customs-settlement:evidence', new Map());
  if (!cache.has(key)) cache.set(key, (async () => {
    if (context && Object.prototype.hasOwnProperty.call(context.externalEvidence, key)) return store.validateLedger(context.externalEvidence[key], scope.year, scope.major);
    if (context && !context.allowExternalEvidenceReads) return { version: 1, ...scope, revision: 0, values: {}, documents: [], history: [], diagnostic: 'SETTLEMENT_EXTERNAL_EVIDENCE_NOT_SUPPLIED' };
    return store.readLedger(store.ROOT, scope.year, scope.major);
  })().catch(error=>{error.code=String(error.code||'').startsWith('SETTLEMENT')?error.code:'SETTLEMENT_EVIDENCE_FAILED';if(context)context.failures.push(error);throw error;}));
  return cache.get(key);
}
export function settlementCountryRow(original, ledger, category, scope = {}) {
  let row = original;
  const touched=new Set();
  for (const phase of ['01', '02']) {
    const source = ledger.values?.[`country|${category}|${phase}`];
    const values = costPolicy.missingCountryValues(original,source,phase);
    if (!Object.keys(values).length) continue;
    row = { ...(row || {}) };
    const cleared=new Set();
    for (const [field, amount] of Object.entries(values)) {
      const stem = field.match(/^(Customs[12]|SunYul[12])_[123]$/)?.[1];
      if(stem)touched.add(stem);
      if (stem&&!cleared.has(stem)){for (const part of [1,2,3]) delete row[`${stem}_${part}`];cleared.add(stem);}
      row[field] = amount;
    }
    if (Object.keys(values).some(f => f.startsWith('SunYul'))) row.SettlementSunYulGrossPhases = [...new Set([...(row.SettlementSunYulGrossPhases || []), Number(phase)])];
  }
  const extra = phase03.phase03Rows(ledger, category);
  phase03.assertLegacyCovered(extra, original);
  if (extra.length) row = { ...(row || {}), Phase03: extra, Phase03Total: phase03.phase03Totals(extra).total };
  if (!row || row === original) return category === '베트남' ? vietnamGross.projectVietnamGross(original, ledger, scope) : original;
  for (const stem of touched) {
    const parts = [1, 2, 3].map(i => `${stem}_${i}`);
    if (parts.some(f => row[f] != null)) row[stem] = parts.reduce((n, f) => n + Number(row[f] ?? 0), 0);
  }
  return category === '베트남' ? vietnamGross.projectVietnamGross(row, ledger, scope) : row;
}
export function settlementColombiaRow(original, ledger, orderWeek) {
  const values = settlementColombiaValues(original,ledger,orderWeek);
  if (!Object.keys(values).length) return original;
  return { ...(original || {}), ...values };
}
export function settlementCountryValues(original,ledger,category){
  return Object.assign({},...['01','02'].map(phase=>costPolicy.missingCountryValues(original,ledger.values?.[`country|${category}|${phase}`],phase)));
}
export function settlementColombiaValues(original,ledger,orderWeek){
  return costPolicy.missingColombiaValues(original,ledger.values?.[`colombia|${orderWeek}`]);
}
const COLOMBIA_REPORT_CATEGORIES = [
  '콜롬비아 카네이션',
  '콜롬비아 장미',
  '콜롬비아 수국',
  '콜롬비아 루스커스',
  '콜롬비아 알스트로',
];
function reportCategoriesForTargetKey(targetKey) {
  const [kind, name] = String(targetKey || '').split('|');
  if (kind === 'country' && name) return [name];
  if (kind === 'colombia') return COLOMBIA_REPORT_CATEGORIES;
  return [];
}
/**
 * 단일 연도·대차수 선율 정산서 파일 원장(ledger)에서 카테고리별·통화별 적용환율(과세환율)을 집계한다.
 * - DB 쓰기 0건, 다른 연도/차수 문서는 포함되지 않는다(ledger 자체 스코프 검증 선행).
 * - 동일 카테고리·통화에 복수 정산서가 있으면 외화결제금액(foreignAmount) 가중평균(소수 4자리)으로 합산한다.
 */
const SETTLEMENT_CAT_CURRENCY = {
  네덜란드: ['EUR', 900, 3000],
  중국: ['CNY', 100, 400],
  호주: ['AUD', 500, 2000],
  일본: ['JPY', 5, 2500],
  태국: ['USD', 800, 2500],
  에콰도르: ['USD', 800, 2500],
  베트남: ['USD', 800, 2500],
  미국: ['USD', 800, 2500],
  이스라엘: ['USD', 800, 2500],
  뉴질랜드: ['USD', 800, 2500],
};
export function settlementTaxableRates(ledger) {
  const byCategory = {}, byCurrency = {};
  const docs = Array.isArray(ledger?.documents) ? ledger.documents : [];
  if (!docs.length) return { byCategory, byCurrency };
  const buckets = new Map();
  const curBuckets = new Map();
  const push = (map, key, doc) => {
    const arr = map.get(key) || [];
    arr.push(doc);
    map.set(key, arr);
  };
  for (const doc of docs) {
    const rate = Number(doc?.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    let currency = doc?.currency ? String(doc.currency).toUpperCase() : null;
    const cats = reportCategoriesForTargetKey(doc.targetKey);
    if (!currency && cats.length === 1) {
      const def = SETTLEMENT_CAT_CURRENCY[cats[0]];
      if (def && rate >= def[1] && rate <= def[2]) currency = def[0];
    } else if (!currency && String(doc?.targetKey || '').startsWith('colombia|') && rate >= 800 && rate <= 2500) {
      currency = 'USD';
    }
    if (!currency) continue;
    for (const cat of cats) {
      push(buckets, `${cat}|${currency}`, doc);
    }
    push(curBuckets, currency, doc);
  }
  const summarize = (list, currency) => {
    const weighted = list.every(d => Number.isFinite(Number(d.foreignAmount)) && Number(d.foreignAmount) > 0);
    const totalWeight = weighted ? list.reduce((s, d) => s + Number(d.foreignAmount), 0) : list.length;
    const rate = weighted
      ? list.reduce((s, d) => s + Number(d.exchangeRate) * Number(d.foreignAmount), 0) / totalWeight
      : list.reduce((s, d) => s + Number(d.exchangeRate), 0) / totalWeight;
    return {
      rate: Number(rate.toFixed(4)),
      currency,
      source: 'sunyul_settlement',
      sourceNote: '선율 정산서 자동반영',
      year: ledger?.year || null,
      major: ledger?.major || null,
      documentIds: [...new Set(list.map(d => d.documentId).filter(Boolean))],
      awbs: [...new Set(list.map(d => d.matchedAwb || d.awb).filter(Boolean))],
    };
  };
  for (const [k, list] of buckets.entries()) {
    const [cat, currency] = k.split('|');
    if (!byCategory[cat]) byCategory[cat] = summarize(list, currency);
  }
  for (const [currency, list] of curBuckets.entries()) {
    byCurrency[currency] = summarize(list, currency);
  }
  return { byCategory, byCurrency };
}
export function pickSettlementTaxableRate(settlementRates, category, curCode) {
  if (!settlementRates || !curCode) return null;
  const catEntry = settlementRates.byCategory?.[category];
  if (catEntry && catEntry.currency === curCode && Number(catEntry.rate) > 0) return catEntry;
  const curEntry = settlementRates.byCurrency?.[curCode];
  if (curEntry && curEntry.currency === curCode && Number(curEntry.rate) > 0) return curEntry;
  return null;
}
export async function settlementScopeFence(years) {
  const allowed = new Set(years.map(String)), entries = [];
  const context = currentErpReadContext();
  if (context && !context.allowExternalEvidenceReads) return policy.hash(Object.entries(context.externalEvidence).filter(([key]) => key.startsWith('customs-settlement:') && allowed.has(key.split(':')[1])).sort(([a], [b]) => a.localeCompare(b)));
  let names; try { names = await fs.readdir(store.ROOT); } catch (e) { if (e.code === 'ENOENT') return policy.hash([]); throw e; }
  for (const name of names.sort()) if (/^20\d{2}-\d{2}\.json$/.test(name) && allowed.has(name.slice(0, 4))) entries.push([name, policy.hash(await fs.readFile(path.join(store.ROOT, name), 'utf8'))]);
  return policy.hash(entries);
}
