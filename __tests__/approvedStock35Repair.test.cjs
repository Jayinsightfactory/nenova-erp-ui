const {test}=require('node:test'),assert=require('node:assert/strict');
const helper=import('../lib/approvedStock35Repair.mjs');
const scope={year:'2026',startWeek:'35-02',prodKeys:[1062,2322,2601],ownerApproved:true,delta:1};
function fixture(){
 const masters=[['2025','35-02'],['2026','35-01'],['2026','35-02'],['2026','36-01'],['2026','37-01'],['2026','46-01'],['2027','01-01']].map(([OrderYear,OrderWeek],i)=>({StockKey:i+1,OrderYear,OrderWeek,OrderYearWeek:OrderYear+OrderWeek.replace('-','')}));
 const levels={1062:[99,0,-1,0,0,0,0],2322:[99,0,-1,0,1,4,4],2601:[99,0,-1,-1,0,0,0]};
 const row=(pk,w,qty)=>({OrderYear:'2026',OrderWeek:w,ProdKey:pk,OutQuantity:qty});
 return {masters,stocks:Object.entries(levels).flatMap(([k,values])=>values.map((Stock,i)=>({StockKey:i+1,ProdKey:Number(k),Stock}))),
  products:[1062,2322,2601].map(pk=>({ProdKey:pk,ProdName:'fixture',OutUnit:'박스',BunchOf1Box:30,isDeleted:0,Stock:pk===2322?4:0})),
  incoming:[row(2322,'37-01',1),row(2322,'46-01',3),row(2601,'37-01',1)],outgoing:[],
  adjustments:[1062,2322,2601].map((ProdKey,i)=>({StockHistoryKey:i+1,OrderYear:'2026',OrderWeek:'35-02',ProdKey,BeforeValue:1,AfterValue:0,ChangeType:'재고조정',TypeMatches:1,ChangeID:'old',Descr:''}))
   .concat([1062,2322].map((ProdKey,i)=>({StockHistoryKey:i+4,OrderYear:'2026',OrderWeek:'36-01',ProdKey,BeforeValue:0,AfterValue:1,ChangeType:'재고조정',TypeMatches:1,ChangeID:'old',Descr:''}))),
  protected:{orders:'same',amounts:'same',report:'same',otherStock:'same'},procedureHash:'reviewed'};
}
function applyExpected(state,plan,actor='fixture'){
 const after=structuredClone(state);
 for(const r of plan.expected)after.stocks.find(s=>s.StockKey===r.StockKey&&s.ProdKey===r.ProdKey).Stock=r.after;
 after.products.forEach(p=>p.Stock++);
 after.adjustments.push(...scope.prodKeys.map((ProdKey,i)=>({StockHistoryKey:10+i,OrderYear:'2026',OrderWeek:'35-02',ProdKey,BeforeValue:-1,AfterValue:0,ChangeType:'재고조정',TypeMatches:1,ChangeID:actor,Descr:plan.description})));
 return after;
}
test('one +1 only at35 carries exactly1 through46 and2027; prior year unchanged',async()=>{
 const h=await helper,before=fixture(),plan=h.planApprovedStock35Repair(before,scope),after=applyExpected(before,plan);
 assert.equal(plan.expected.length,15);assert(plan.expected.every(r=>r.after-r.before===1));
 const v=h.verifyApprovedStock35Repair(before,after,plan,'fixture');assert.equal(v.addedHistory,3);assert.deepEqual(v.live.map(r=>r.stock),[1,5,1]);
 assert.deepEqual(after.stocks.filter(r=>r.StockKey===1),before.stocks.filter(r=>r.StockKey===1));
});
for(const [label,change]of [['wrong year',s=>s.year='2025'],['wrong week',s=>s.startWeek='36-01'],['wrong product',s=>s.prodKeys=[1062]],['no owner approval',s=>s.ownerApproved=false],['wrong delta',s=>s.delta=2]])test(label,async()=>{
 const h=await helper,s=structuredClone(scope);change(s);assert.throws(()=>h.planApprovedStock35Repair(fixture(),s),/SCOPE/);
});
for(const [label,change,pattern]of [
 ['old stock no longer negative',s=>s.stocks.find(r=>r.StockKey===3).Stock=0,/STOCK_CHANGED/],
 ['unknown unit',s=>s.products[0].OutUnit='단',/PRODUCT/],
 ['wrong conversion',s=>s.products[0].BunchOf1Box=15,/PRODUCT/],
 ['bad baseline cascade',s=>s.stocks.find(r=>r.StockKey===5).Stock=100,/EXACT_PLUS_ONE/],
 ['duplicate apply',s=>s.adjustments[0].Descr='[owner-approved-stock35:2026-11-13:+1:1062,2322,2601]',/ALREADY/]
])test(label,async()=>{const h=await helper,s=fixture();change(s);assert.throws(()=>h.planApprovedStock35Repair(s,scope),pattern);});
for(const [label,change]of [
 ['existing history',s=>s.adjustments[0].AfterValue=3],['other money',s=>s.protected.amounts='changed'],
 ['live stock double',s=>s.products[0].Stock++],['future double',s=>s.stocks.find(r=>r.StockKey===7).Stock++],
 ['wrong operator',s=>s.adjustments.at(-1).ChangeID='spoof']
])test(`readback blocks ${label}`,async()=>{const h=await helper,b=fixture(),p=h.planApprovedStock35Repair(b,scope),a=applyExpected(b,p);change(a);assert.throws(()=>h.verifyApprovedStock35Repair(b,a,p,'fixture'));});
test('busy/stale sources perform no write; native failure propagates to outer rollback',async()=>{
 const h=await helper,b=fixture();let writes=0;
 const idle={ProtocolVersion:2,PendingCalc:0,TransactionCount:1,TransactionState:1,...Object.fromEntries(['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'].map(k=>[k,null]))};
 const query=async text=>{if(text.startsWith('INSERT'))writes++;return {recordset:text.includes('NenovaStockWeekGate')?[idle]:[{Descr:'재고조정'}]};};
 const opts={tQuery:query,types:{NVarChar:'str',Int:'int',Float:'float'},scope,expectedHash:'0'.repeat(64),actor:'fixture',readState:async()=>b,runNative:async()=>{throw Error('native failed');}};
 await assert.rejects(()=>h.executeApprovedStock35Repair(opts),/SOURCE_CHANGED/);assert.equal(writes,0);
 opts.expectedHash=h.stockRepairDigest(b);idle.Mode='BUSY';await assert.rejects(()=>h.executeApprovedStock35Repair(opts),/GATE_BUSY/);assert.equal(writes,0);
 idle.Mode=null;await assert.rejects(()=>h.executeApprovedStock35Repair(opts),/native failed/);assert.equal(writes,3);
});
module.exports={fixture,scope,applyExpected};
