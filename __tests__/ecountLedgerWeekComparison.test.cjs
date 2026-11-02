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

const {ledgerTableGroups}=require('../lib/ecountLedgerTable.cjs');
test('one combined table keeps each voucher once below its week and carries source balance',()=>{
 const rows=[{sequence:1,date:'2026-10-06',sales:5838250,receipt:0,balance:8555250},{sequence:2,date:'2026-10-13',sales:18840800,receipt:0,balance:27396050},{sequence:3,date:'2026-10-20',sales:3900600,receipt:0,balance:31296650},{sequence:4,date:'2026-10-22',sales:0,receipt:24679050,balance:6617600},{sequence:5,date:'2026-10-22',sales:0,receipt:2717000,balance:3900600},{sequence:6,date:'2026-10-27',sales:9044750,receipt:0,balance:12945350}];
 const source={opening:2717000,rows};const original=JSON.stringify(source);
 const weeks={status:'READY',rows:[['202640','2026-09-30','2026-10-06'],['202641','2026-10-07','2026-10-13'],['202642','2026-10-14','2026-10-20'],['202643','2026-10-21','2026-10-27'],['202644','2026-10-28','2026-10-30']].map(([key,from,to])=>({key,from,to,posted:0,pending:0,difference:null}))};
 const result=ledgerTableGroups(source,weeks);
 assert.deepEqual(result.flatMap(g=>g.rows.map(r=>r.sequence)),[1,2,3,4,5,6]);
 assert.equal(result[3].receipt,27396050);assert.equal(result[3].closing,12945350);assert.equal(result[4].closing,12945350);assert.equal(result[4].rows.length,0);
 assert.equal(JSON.stringify(source),original);assert.equal(result[3].week.difference,null);
 for(const bad of [null,{status:'UNAVAILABLE'}, {...weeks,rows:[weeks.rows[0]]},{...weeks,rows:[...weeks.rows,weeks.rows[0]]}]){
  const fallback=ledgerTableGroups(source,bad);assert.equal(fallback.length,1);assert.equal(fallback[0].week,null);assert.deepEqual(fallback[0].rows,rows);
 }
});
test('combined groups retain cross-year identities and actual zero balances',()=>{
 const source={opening:20,rows:[{sequence:1,date:'2025-12-31',sales:0,receipt:20,balance:0},{sequence:2,date:'2026-01-01',sales:5,receipt:0,balance:5}]};
 const result=ledgerTableGroups(source,{status:'READY',rows:[{key:'202601',from:'2026-01-01',to:'2026-01-01'},{key:'202553',from:'2025-12-31',to:'2025-12-31'}]});
 assert.deepEqual(result.map(g=>[g.key,g.closing]),[['202553',0],['202601',5]]);
 assert.equal(ledgerTableGroups({opening:null,rows:[]},null)[0].closing,null);
});
