import {validLedgerWeek} from './kakaoStockLedger.js';

export function stockSourceWeek(text, selectedWeek) {
  if (!validLedgerWeek(selectedWeek)) return null;
  const found=[...String(text).matchAll(/(?:^|\s)(?:(20\d{2})-)?(\d{1,2})\s*-\s*(\d{1,2})(?=\s|$|[.,:차])/g)]
    .map(m=>`${m[1]||selectedWeek.slice(0,4)}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
  const unique=[...new Set(found)];
  if (!unique.length) return selectedWeek;
  return unique.length===1 && validLedgerWeek(unique[0]) ? unique[0] : null;
}
export function stockInboxRows(rows, search='') {
  const term=search.trim().toLocaleLowerCase();
  return [...rows].filter(r=>!term||`${r.message||''} ${r.sender||''}`.toLocaleLowerCase().includes(term))
    .sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||String(a.identity).localeCompare(String(b.identity)));
}
export function mergeStockInbox(previous, incoming) {
  const merged=new Map(previous.map(r=>[r.identity,r]));
  incoming.forEach(r=>merged.set(r.identity,r));
  return stockInboxRows([...merged.values()]);
}
