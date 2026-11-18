import fs from 'node:fs/promises';
import path from 'node:path';
import { currentErpReadContext, erpContextCache } from './erpReadContext.js';
import store from './customsSettlementStore.cjs';
import policy from './customsSettlementPlan.cjs';
import costPolicy from './customsSettlementCostPolicy.cjs';

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
export function settlementCountryRow(original, ledger, category) {
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
  if (!row || row === original) return original;
  for (const stem of touched) {
    const parts = [1, 2, 3].map(i => `${stem}_${i}`);
    if (parts.some(f => row[f] != null)) row[stem] = parts.reduce((n, f) => n + Number(row[f] ?? 0), 0);
  }
  return row;
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
export async function settlementScopeFence(years) {
  const allowed = new Set(years.map(String)), entries = [];
  const context = currentErpReadContext();
  if (context && !context.allowExternalEvidenceReads) return policy.hash(Object.entries(context.externalEvidence).filter(([key]) => key.startsWith('customs-settlement:') && allowed.has(key.split(':')[1])).sort(([a], [b]) => a.localeCompare(b)));
  let names; try { names = await fs.readdir(store.ROOT); } catch (e) { if (e.code === 'ENOENT') return policy.hash([]); throw e; }
  for (const name of names.sort()) if (/^20\d{2}-\d{2}\.json$/.test(name) && allowed.has(name.slice(0, 4))) entries.push([name, policy.hash(await fs.readFile(path.join(store.ROOT, name), 'utf8'))]);
  return policy.hash(entries);
}
