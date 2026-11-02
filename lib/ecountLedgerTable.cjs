'use strict';
// Presentation only: every voucher appears once; bank deposits remain week-level evidence.
function ledgerTableGroups(ledger,comparison){
 const rows=ledger?.rows||[];
 const fallback=()=>[{key:'vouchers',week:null,rows,closing:rows.length?rows[rows.length-1].balance:ledger?.opening??null}];
 if(comparison?.status!=='READY'||!comparison.rows?.length)return fallback();
 const weeks=[...comparison.rows].sort((a,b)=>a.from.localeCompare(b.from));
 for(let i=0;i<weeks.length;i++)if(!/^\d{6}$/.test(weeks[i].key)||!/^\d{4}-\d{2}-\d{2}$/.test(weeks[i].to)||!/^\d{4}-\d{2}-\d{2}$/.test(weeks[i].from)||weeks[i].from>weeks[i].to||(i&&weeks[i-1].to>=weeks[i].from))return fallback();
 if(rows.some(r=>weeks.filter(w=>r.date>=w.from&&r.date<=w.to).length!==1))return fallback();
 let closing=ledger?.opening??null;
 return weeks.map(w=>{const vouchers=rows.filter(r=>r.date>=w.from&&r.date<=w.to);if(vouchers.length)closing=vouchers[vouchers.length-1].balance;return {key:w.key,week:w,rows:vouchers,receipt:vouchers.reduce((sum,r)=>sum+r.receipt,0),closing};});
}
module.exports={ledgerTableGroups};
