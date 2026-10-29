// Shared by web, monthly and XLSX. No DB or date-dependent calculation on stored reads.
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from './profitReportCalc.js';

export const PROFIT_CACHE_POLICY_VERSION = 1;
export const profitScopeMatches=(scope,year,major)=>String(scope?.year)===String(year)&&Number(scope?.major)===Number(major);
const CALC_KEYS = ['C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','AC','AJ'];
const validCalc = (value, total=false) => value && CALC_KEYS.filter(key=>!total || key!=='R').every(key => Object.hasOwn(value,key)
  && (value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key]))));
export const hasStoredRowCalculation = row => Boolean(row?.calc && (row.confirmed || row.calculationFrozen === true));
export function isMaterializedProfitPayload(payload) {
  return payload?.cachePolicyVersion === PROFIT_CACHE_POLICY_VERSION && Array.isArray(payload.rows)
    && payload.rows.length > 0 && payload.rows.every(row => row.calculationFrozen === true && validCalc(row.calc))
    && validCalc(payload.totals,true);
}
export function materializeProfitPayload(payload) {
  const rows = (payload.rows || []).map(row => ({...row, calc: computeProfitRow(row), calculationFrozen: true}));
  const totals = computeProfitTotals(rows);
  for (const row of rows) row.calc = {...row.calc, D: calcRevenueRatio(row.calc,totals), U: calcPurchaseRatio(row.calc,totals)};
  const result = {...payload, rows, totals, cachePolicyVersion: PROFIT_CACHE_POLICY_VERSION};
  if (!isMaterializedProfitPayload(result)) throw new Error('계산 결과 저장 형식이 완전하지 않습니다.');
  return result;
}
export function profitDisplayCalculation(payload, edits = {}) {
  if(payload?.templateDuty && Object.keys(edits || {}).length===0) return {rows:payload.rows || [],totals:payload.effectiveViewTotals};
  if (payload?.confirmed) return {rows:payload.rows || [], totals:payload.confirmedTotals || {}};
  if(payload?.cachePolicyVersion===PROFIT_CACHE_POLICY_VERSION && !isMaterializedProfitPayload(payload)) throw new Error('저장된 계산본 형식이 불완전합니다. 다시 생성하세요.');
  if (isMaterializedProfitPayload(payload) && Object.keys(edits || {}).length === 0) return {rows:payload.rows,totals:payload.totals};
  const rows = (payload?.rows || []).map(row => ({...row,calculationFrozen:false,calc:computeProfitRow(row,edits)}));
  return {rows,totals:computeProfitTotals(rows)};
}
