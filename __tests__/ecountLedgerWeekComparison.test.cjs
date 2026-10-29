const {test}=require('node:test'),assert=require('node:assert/strict');
const {compareLedgerWeeks}=require('../lib/ecountLedgerWeekComparison.cjs');
const calendar=[{dateOnly:'2025-12-31',orderYearWeek:'202553'},{dateOnly:'2026-01-01',orderYearWeek:'202601'}];
const ledger={periodFrom:'2025-12-31',periodTo:'2026-01-01',opening:900,rows:[{date:'2025-12-31',sales:100},{date:'2026-01-01',sales:100}]};
const receipts={status:'VERIFIED',bankReconciled:true,bankReceipts:[{date:'2025-12-31',amount:80},{date:'2026-01-01',amount:90}],rows:[{date:'2026-01-01',amount:30,deduct:true}]};
test('bank-date inflow minus dated sales keeps years separate and excludes opening balance',()=>{
 const result=compareLedgerWeeks(ledger,receipts,calendar);
 assert.deepEqual(result.rows.map(w=>[w.key,w.difference]),[['202553',-20],['202601',20]]);
 assert.deepEqual(compareLedgerWeeks(ledger,receipts,calendar),result);
});
test('pending becoming reflected contributes once with unchanged flow',()=>{
 const posted={...receipts,rows:[],bankReceipts:[...receipts.bankReceipts,{date:'2026-01-01',amount:30}]};
 assert.equal(compareLedgerWeeks(ledger,posted,calendar).rows[1].difference,20);
});
test('unverified bank and held receipts never invent a signed difference',()=>{
 assert.equal(compareLedgerWeeks(ledger,{...receipts,bankReconciled:false},calendar).rows[0].difference,null);
 const held={...receipts,rows:[{date:'2026-01-01',amount:30,deduct:false}]};
 assert.equal(compareLedgerWeeks(ledger,held,calendar).rows[1].difference,null);
});
test('missing duplicate or wrong-year calendar fails closed, partial scope labelled',()=>{
 for(const rows of [calendar.slice(1),[...calendar,calendar[0]],[{...calendar[0],orderYearWeek:'202653'},calendar[1]]])assert.equal(compareLedgerWeeks(ledger,receipts,rows).status,'UNAVAILABLE');
 const full=[{dateOnly:'2025-12-30',orderYearWeek:'202553'},...calendar];
 assert.equal(compareLedgerWeeks(ledger,receipts,full).rows[0].partial,true);
});
