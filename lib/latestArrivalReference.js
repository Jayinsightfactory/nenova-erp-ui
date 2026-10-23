// Display-only projection. Do not import into receipt/settlement/stock writers.
import { query, sql } from './db.js';
import { loadHotelArrivalHistory } from './raumPnlArrivalReference.js';
import { loadArrivalInvoiceRows } from './arrivalInvoiceSource.js';

export function arrivalWeekNumber(value) {
  const m = String(value ?? '').match(/^(\d{1,2})-(\d{1,2})$/);
  return m && +m[1] > 0 && +m[2] > 0 ? +m[1] * 100 + +m[2] : null;
}
export const latestArrivalKey = item => `${Number(item.prodKey ?? item.ProdKey)}|${String(item.unit ?? item.Unit ?? '').trim()}`;

export function selectLatestArrivalReferences(history, year, throughWeek = '') {
  const limit = throughWeek ? arrivalWeekNumber(throughWeek) : Infinity;
  if (limit == null) throw new Error('원가 기준 차수를 확인하세요.');
  const eligible = (history || []).filter(ref => String(ref.orderYear) === String(year)
    && arrivalWeekNumber(ref.week) != null && arrivalWeekNumber(ref.week) <= limit);
  const latest = Math.max(0, ...eligible.map(ref => arrivalWeekNumber(ref.week)));
  // Keep invalid units at the latest week visible; never silently use an old price.
  return eligible.filter(ref => arrivalWeekNumber(ref.week) === latest);
}

export function latestArrivalScalar(refs = []) {
  if (!refs.length || refs.some(ref => ref.cost == null || !Number.isFinite(ref.cost) || ref.conversionError)) return null;
  const units = new Set(refs.map(ref => ref.unit));
  if (units.size !== 1 || !refs[0].unit) return null;
  const chosen = [...refs].sort((a,b) => b.cost - a.cost)[0];
  return { arrivalCost:chosen.cost, displayUnit:chosen.unit, arrivalUnit:chosen.unit,
    arrivalWeek:chosen.week, source:`최신 원가 · ${refs.some(r=>r.sourceKind==='INVOICE')?'승인 인보이스':'현재 엑셀'} · 농장 ${refs.length}건 최고가`,
    isFallback:false, references:refs };
}

export async function loadLatestArrivalReferences({orderYear, items = [], throughWeek = ''}, tQuery = query) {
  const year = String(orderYear ?? '');
  if (!/^\d{4}$/.test(year)) throw new Error('원가 조회 연도를 선택하세요.');
  if (throughWeek && !arrivalWeekNumber(throughWeek)) throw new Error('원가 기준 차수를 확인하세요.');
  const unique = [...new Map(items.filter(item => Number.isSafeInteger(Number(item.prodKey ?? item.ProdKey)) && Number(item.prodKey ?? item.ProdKey)>0)
    .map(item => [latestArrivalKey(item), item])).values()];
  if (!unique.length) return {};
  const invoice = await loadArrivalInvoiceRows({queryFn:tQuery,types:sql,year});
  const result = {};
  for (let start=0; start<unique.length; start+=500) {
    const batch = unique.slice(start,start+500).map((item,index)=>({...item,itemKey:index+1}));
    const history = await loadHotelArrivalHistory({orderYear:year,major:1,items:batch},tQuery,invoice);
    for (const item of batch) result[latestArrivalKey(item)] = selectLatestArrivalReferences(history[item.itemKey],year,throughWeek);
  }
  return result;
}

export async function loadLatestArrivalMap({orderYear, products, throughWeek = ''}, tQuery = query) {
  const items = products.map(p=>({prodKey:p.ProdKey,unit:p.EstUnit || p.OutUnit || ''}));
  const references = await loadLatestArrivalReferences({orderYear,items,throughWeek},tQuery);
  return Object.fromEntries(items.map(item=>[item.prodKey,latestArrivalScalar(references[latestArrivalKey(item)])]).filter(([,value])=>value));
}
