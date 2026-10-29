'use strict';
// Read-only cash-flow comparison. Never allocates a payment to an outstanding invoice.
function compareLedgerWeeks(ledger, receipts, calendar) {
  const unavailable = reason => ({status:'UNAVAILABLE',reason,rows:[]});
  if (!ledger?.periodFrom || !ledger?.periodTo) return unavailable('NO_LEDGER');
  const dates=new Map(),weeks=new Map();
  for (const r of calendar || []) {
    const date=r.dateOnly,key=String(r.orderYearWeek||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}(0[1-9]|[1-4]\d|5[0-3])$/.test(key)||date.slice(0,4)!==key.slice(0,4)||dates.has(date))return unavailable('CALENDAR_INVALID');
    dates.set(date,key);
    if(!weeks.has(key))weeks.set(key,{key,from:date,to:date,sales:0,posted:0,pending:0,held:0});
    const w=weeks.get(key);w.from=date<w.from?date:w.from;w.to=date>w.to?date:w.to;
  }
  for(let t=Date.parse(ledger.periodFrom);t<=Date.parse(ledger.periodTo);t+=86400000)if(!dates.has(new Date(t).toISOString().slice(0,10)))return unavailable('CALENDAR_MISSING');
  const add=(date,field,value)=>{const w=weeks.get(dates.get(date));if(!w||!Number.isFinite(value))return false;w[field]+=value;return true;};
  for(const r of ledger.rows)if(!add(r.date,'sales',r.sales))return unavailable('CALENDAR_MISSING');
  const bankReady=receipts?.status==='VERIFIED'&&receipts.bankReconciled===true;
  if(bankReady){
    for(const r of receipts.bankReceipts||[])if(!add(r.date,'posted',r.amount))return unavailable('CALENDAR_MISSING');
    for(const r of receipts.rows||[])if(!add(r.date,r.deduct?'pending':'held',r.deduct?r.amount:1))return unavailable('CALENDAR_MISSING');
  }
  const rows=[...weeks.values()].filter(w=>w.to>=ledger.periodFrom&&w.from<=ledger.periodTo).sort((a,b)=>a.key.localeCompare(b.key)).map(w=>({
    ...w,partial:w.from<ledger.periodFrom||w.to>ledger.periodTo,
    from:w.from<ledger.periodFrom?ledger.periodFrom:w.from,to:w.to>ledger.periodTo?ledger.periodTo:w.to,
    posted:bankReady?w.posted:null,pending:bankReady?w.pending:null,
    difference:bankReady&&!w.held?w.posted+w.pending-w.sales:null,
  }));
  return {status:'READY',bankReady,rows};
}
module.exports={compareLedgerWeeks};
