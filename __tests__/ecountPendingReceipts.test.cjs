const test=require('node:test');
const assert=require('node:assert/strict');
const {codeHash,calculatePendingReceipts}=require('../lib/ecountPendingReceipts.cjs');
const target=codeHash('1234567890'),other=codeHash('9999999999');
const row=(extra={})=>({id:'a'.repeat(64),pattern:'b'.repeat(64),code:target,date:'2026-01-02',amount:200,status:'PENDING',self:false,postingDate:'2025-12-01',...extra});
const ledger=(extra={})=>({periodFrom:'2025-12-02',periodTo:'2026-01-02',collectedAt:'2026-01-02T02:00:30Z',rows:[],totals:{balance:1000,receipt:0},...extra});
const snap=(at,rows)=>({at,from:'2025-12-01',to:'2026-01-02',complete:true,rows});
const evidence=(rows=[row()],history=[])=>({history:snap('2026-01-02T01:59:00Z',history),before:snap('2026-01-02T02:00:00Z',rows),after:snap('2026-01-02T02:01:00Z',rows)});
test('cross-year snapshot calculates once, repeated reads never accumulate deductions',()=>{
 const e=evidence();for(let i=0;i<3;i++)assert.equal(calculatePendingReceipts(e,ledger(),target).calculatedBalance,800);
 assert.equal(calculatePendingReceipts(e,ledger(),other).pendingAmount,0);
});
test('accounting posting removes pending money while preserving calculated remaining balance',()=>{
 assert.equal(calculatePendingReceipts(evidence(),ledger(),target).calculatedBalance,800);
 const posted=row({status:'REFLECTED',postingDate:'2026-01-02'});
 const next=calculatePendingReceipts(evidence([], [posted]),ledger({totals:{balance:800,receipt:200},rows:[{date:'2026-01-02',receipt:200}]}),target);
 assert.equal(next.pendingAmount,0);assert.equal(next.calculatedBalance,800);
});
test('bank state change or stale/mismatched ledger prevents calculation',()=>{
 for(const mutate of [e=>e.after.rows=[],e=>e.after.at='2026-01-02T03:00:00Z',e=>e.before.at='2026-01-02T02:00:50Z',e=>e.after.complete=false,e=>e.history.at='2025-12-01T02:00:00Z',e=>e.after.to='2025-01-02']){
  const e=evidence();mutate(e);assert.equal(calculatePendingReceipts(e,ledger(),target).status,'UNAVAILABLE');
 }
 assert.equal(calculatePendingReceipts(null,ledger(),target).calculatedBalance,null);
});
test('exact historical pattern maps missing customer code; conflicting codes cannot deduct',()=>{
 const old=row({id:'c'.repeat(64),status:'REFLECTED'});
 const pending=row({code:null});
 assert.equal(calculatePendingReceipts(evidence([pending],[old]),ledger(),target).pendingAmount,200);
 for(const rows of [[old,{...old,id:'d'.repeat(64),code:other}],[{...old,code:null}]]){
  assert.equal(calculatePendingReceipts(evidence([pending],rows),ledger(),target).pendingAmount,0);
 }
 assert.equal(calculatePendingReceipts(evidence([row()],[{...old,code:other}]),ledger(),target).pendingAmount,0);
});
test('duplicate identities, reflected ids, self transfers and possibly posted receipts are held',()=>{
 const cases=[evidence([row(),row()]),evidence([row({self:true})]),evidence([row()],[row({status:'REFLECTED'})])];
 for(const e of cases)assert.equal(calculatePendingReceipts(e,ledger(),target).pendingAmount,0);
 assert.equal(calculatePendingReceipts(evidence(),ledger({rows:[{date:'2026-01-02',receipt:200}]}),target).pendingAmount,0);
 const two=evidence([row(),row({id:'c'.repeat(64)})]);
 assert.equal(calculatePendingReceipts(two,ledger(),target).pendingAmount,400);
});
test('previous-period money cannot be subtracted from a current-month window',()=>{
 assert.equal(calculatePendingReceipts(evidence([row({date:'2025-12-01'})]),ledger(),target).pendingAmount,0);
});
test('bundled receipts and delayed bank statuses require reflected totals to reconcile',()=>{
 const posted=row({status:'REFLECTED',id:'c'.repeat(64),amount:300,postingDate:'2026-01-02'});
 const second=row({status:'REFLECTED',id:'d'.repeat(64),amount:400,postingDate:'2026-01-02'});
 const e=evidence([row()],[posted,second]);
 assert.equal(calculatePendingReceipts(e,ledger({totals:{balance:1000,receipt:700}}),target).pendingAmount,200);
 const delayed=calculatePendingReceipts(e,ledger({totals:{balance:800,receipt:900}}),target);
 assert.equal(delayed.pendingAmount,0);assert.equal(delayed.rows[0].reason,'ACCOUNTING_RECONCILIATION');
});
test('bank adapter hashes private data, preserves two same-time payments with different running balances',async()=>{
 const {sanitizeBankRows}=await import('../scripts/ecount-scraper/pending-receipts.mjs');
 const headers=['','입/출금일자','구분','계좌번호','계좌명','거래처코드','거래처명','금액','입금처(출금처)','비 고','원화잔액','지점명/상대은행','회계전표'];
 const cells=['1','2026/01/02 오전 8:00:00','입금','fixture-account','입금','123-45-67890','fixture-customer','200','fixture-payer','','1000','fixture-bank',''];
 const rows=sanitizeBankRows({headers,rows:[cells,[...cells.slice(0,10),'1200',...cells.slice(11)]]},'PENDING','fixture-secret');
 const footer=Array(13).fill('');footer[7]='400';footer[10]='1200';
 assert.equal(sanitizeBankRows({headers,rows:[cells,footer]},'PENDING','fixture-secret').length,1);
 assert.notEqual(rows[0].id,rows[1].id);assert.equal(rows[0].pattern,rows[1].pattern);assert.equal(rows[0].code,target);
 assert.ok(!JSON.stringify(rows).includes('fixture'));assert.ok(!JSON.stringify(rows).includes('1234567890'));
 assert.throws(()=>sanitizeBankRows({headers,rows:[[...cells.slice(0,12),'2026/01/02-1']]},'PENDING','secret'));
 const outgoing=[...cells];outgoing[2]='출금';assert.throws(()=>sanitizeBankRows({headers,rows:[outgoing]},'PENDING','secret'));
});
test('stored evidence remains scoped and recalculates after sanitization',()=>{
 const {validateBankSnapshot}=require('../lib/ecountPendingReceipts.cjs');
 const e=evidence([row()],[row({id:'c'.repeat(64),status:'REFLECTED',amount:300,postingDate:'2026-01-02'}),row({id:'d'.repeat(64),pattern:'e'.repeat(64),status:'REFLECTED',amount:400,postingDate:'2026-01-02'})]);
 const safe=Object.fromEntries(Object.entries(e).map(([k,v])=>[k,validateBankSnapshot(v)]));
 const base=ledger({totals:{balance:1000,receipt:700}});
 assert.deepEqual(calculatePendingReceipts(safe,base,target),calculatePendingReceipts(e,base,target));
});
test('orchestration brackets ledger collection and never fabricates bank zero after failure',async()=>{
 const {collectLedgerWithBank}=await import('../scripts/ecount-scraper/pending-receipts.mjs');
 const events=[];let count=0;
 const args={page:{},bankPage:{},base:'fixture',customer:{},period:{},history:evidence().history,secret:'fixture',collectLedger:async()=>{events.push('ledger');return ledger();},collectBank:async()=>{events.push('bank');return ++count===1?evidence().before:evidence().after;}};
 const collected=await collectLedgerWithBank(args);assert.deepEqual(events,['bank','ledger','bank']);assert.equal(calculatePendingReceipts(collected.bankEvidence,collected,target).pendingAmount,200);
 const failed=await collectLedgerWithBank({...args,collectBank:async()=>{throw new Error('fixture');}});assert.equal(calculatePendingReceipts(failed.bankEvidence,failed,target).status,'UNAVAILABLE');
});
