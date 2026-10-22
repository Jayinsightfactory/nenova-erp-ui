const assert=require('node:assert/strict');
module.exports=(async()=>{
 await require('./stockCalculationOrderRepair.test.cjs');
 const {planHistoricalStockRepair:plan,verifyHistoricalStockRepair:verify,stockRepairDigest:digest,executeHistoricalStockRepair:execute}=await import('../lib/historicalStockRepair.mjs');
 const scope={year:'2026',startWeek:'30-01',offsetWeek:'41-02',prodKeys:[1],cleanupPurposeConfirmed:true};
 const fixture=()=>({masters:[
  {StockKey:1,OrderYear:'2026',OrderWeek:'29-02',OrderYearWeek:'20262902'},
  {StockKey:2,OrderYear:'2026',OrderWeek:'30-01',OrderYearWeek:'20263001'},
  {StockKey:3,OrderYear:'2026',OrderWeek:'31-01',OrderYearWeek:'20263101'},
  {StockKey:4,OrderYear:'2026',OrderWeek:'41-02',OrderYearWeek:'20264102'},
  {StockKey:5,OrderYear:'2027',OrderWeek:'01-01',OrderYearWeek:'20270101'},
 ],stocks:[0,20,25,5,5].map((Stock,i)=>({StockKey:i+1,ProdKey:1,Stock})),
 products:[{ProdKey:1,isDeleted:false,OutUnit:'송이',Stock:9}],
 incoming:[{OrderYear:'2026',OrderWeek:'31-01',ProdKey:1,OutQuantity:5},{OrderYear:'2025',OrderWeek:'30-01',ProdKey:1,OutQuantity:999}],outgoing:[],
 adjustments:[{StockHistoryKey:1,ProdKey:1,OrderYear:'2026',OrderWeek:'41-02',ChangeType:'재고조정',BeforeValue:20,AfterValue:0,TypeMatches:1,Descr:'historical cleanup'}],
 protected:{sales:'unchanged',liveStock:9},procedureHash:'fixture'});
 const b=fixture(),p=plan(b,scope);assert.equal(p.items[0].excess,20);assert.equal(p.expected[0].after,0);assert.equal(p.expected[1].after,5);assert.equal(p.expected.at(-1).after,5);
 for(const mutation of [s=>s.cleanupPurposeConfirmed=false,s=>s.year='2025',s=>s.prodKeys=[1,1],s=>s.offsetWeek=s.startWeek,s=>s.startWeek='2026-30-01'])assert.throws(()=>plan(b,{...structuredClone(scope),...(()=>{let s=structuredClone(scope);mutation(s);return s})()}));
 for(const change of [s=>s.stocks[1].Stock=null,s=>s.adjustments[0].TypeMatches=2,s=>s.adjustments[0].AfterValue=1,s=>s.products[0].isDeleted=true,s=>s.products[0].OutUnit='단',s=>s.stocks.pop(),s=>s.masters.push({...s.masters[2],StockKey:6}),s=>s.incoming[0].OutQuantity=null,
  s=>s.outgoing.push({OrderYear:'2027',OrderWeek:'01-01',ProdKey:1,OutQuantity:6})]){const f=fixture();change(f);assert.throws(()=>plan(f,scope));}
 function afterOf(before,plan){const a=structuredClone(before);for(const row of plan.expected)a.stocks.find(x=>x.StockKey===row.StockKey&&x.ProdKey===row.ProdKey).Stock=row.after;
  a.adjustments.push({StockHistoryKey:2,ProdKey:1,OrderYear:'2026',OrderWeek:'41-02',ChangeType:'재고조정',BeforeValue:0,AfterValue:20,TypeMatches:1,Descr:plan.repairDescription});return a;}
 const a=afterOf(b,p);assert.equal(verify(b,a,p).changedSnapshots,2);
 const nullLegacy=fixture();nullLegacy.masters.push({StockKey:99,OrderYear:null,OrderWeek:'17-01',OrderYearWeek:null});nullLegacy.stocks.push({StockKey:99,ProdKey:1,Stock:987});
 assert.equal(plan(nullLegacy,scope).expected.some(x=>x.StockKey===99),false);
 assert.equal(verify(nullLegacy,afterOf(nullLegacy,plan(nullLegacy,scope)),plan(nullLegacy,scope)).changedSnapshots,2);
 const legacy=fixture();legacy.masters.splice(3,0,{StockKey:6,OrderYear:'2026',OrderWeek:'34-02A',OrderYearWeek:'20263402A'});legacy.stocks.push({StockKey:6,ProdKey:1,Stock:25});
 assert.throws(()=>plan(legacy,scope),/AMBIGUOUS/);
 assert.equal(plan(legacy,{...scope,nativeLegacyPeriods:['2026/34-02A']}).expected.find(x=>x.StockKey===6).after,5);
 legacy.incoming.push({OrderYear:'2026',OrderWeek:'34-02A',ProdKey:1,OutQuantity:1});
 assert.throws(()=>plan(legacy,{...scope,nativeLegacyPeriods:['2026/34-02A']}),/LEGACY_HAS_MOVEMENT/);
 for(const change of [s=>s.products[0].Stock=99,s=>s.protected.sales='changed',s=>s.adjustments[0].Descr='rewritten',s=>s.adjustments[1].AfterValue=21,s=>s.stocks[4].Stock=4,s=>s.stocks[0].Stock=99,s=>s.stocks.push({StockKey:99,ProdKey:1,Stock:0})]){const x=structuredClone(a);change(x);assert.throws(()=>verify(b,x,p));}
 const idle={Mode:null,LockedAt:null,Action:null,OrderYear:null,OrderWeek:null,OwnerSessionID:null,OwnerToken:null,CalcProdKey:null,PendingCalc:false,ProtocolVersion:2};
 for(const failure of ['none','stale','busy','insert','native','readback']){
  let live=fixture(),working=structuredClone(live),read=0,inserted=0,committed=false;
  try{await execute({scope,expectedHash:failure==='stale'?'0'.repeat(64):digest(live),actor:'fixture',types:{NVarChar:'s',Float:'f',Int:'i'},
   tQuery:async text=>{if(text.startsWith('SELECT'))return {recordset:[{...idle,...(failure==='busy'?{Mode:'RUN'}:{})}]};assert.match(text,/INSERT INTO StockHistory/);inserted++;if(failure==='insert')throw Error('insert failure');return {};},
   readState:async()=>{read++;return read===1?structuredClone(working):working;},
   runNative:async()=>{if(failure==='native')throw Error('native failure');working=afterOf(live,plan(live,scope));if(failure==='readback')working.protected.sales='changed';},
  });live=working;committed=true;}catch{working=structuredClone(live)}
  assert.equal(committed,failure==='none');if(!committed)assert.deepEqual(live,fixture());if(['stale','busy'].includes(failure))assert.equal(inserted,0);
 }
 const fs=require('node:fs'),script=fs.readFileSync('scripts/historical-stock-repair.mjs','utf8');
 assert.match(script,/SERIALIZABLE/);assert.match(script,/Matching rehearsal required/);assert.match(script,/rollbackVerified/);assert.match(script,/runOrderStockCalculationBatch/);
 assert.doesNotMatch(script,/UPDATE\s+Product|DELETE\s+FROM|ALTER\s+PROCEDURE/i);
 const earlyScope={year:'2026',startWeek:'04-01',offsetWeek:'04-01',prodKeys:[1],cleanupPurposeConfirmed:true,
  earlyCleanupResetApproved:true,resetWeeks:{1:'08-01'}};
 const earlyFixture=()=>({masters:[['2026','03-02'],['2026','04-01'],['2026','04-02'],['2026','08-01'],['2027','01-01']].map(([OrderYear,OrderWeek],i)=>({StockKey:i+1,OrderYear,OrderWeek,OrderYearWeek:OrderYear+OrderWeek.replace('-','')})),
  stocks:[0,-30,-30,0,0].map((Stock,i)=>({StockKey:i+1,ProdKey:1,Stock})),products:[{ProdKey:1,OutUnit:'단',isDeleted:false,Stock:9}],
  incoming:[],outgoing:[],adjustments:[{StockHistoryKey:1,ProdKey:1,OrderYear:'2026',OrderWeek:'04-01',ChangeType:'재고조정',BeforeValue:0,AfterValue:-30,TypeMatches:1,Descr:'confirmed cleanup'}],protected:{sales:'unchanged'},procedureHash:'fixture'});
 const eb=earlyFixture(),ep=plan(eb,earlyScope);assert.equal(ep.items[0].excess,30);assert.equal(ep.expected.filter(r=>r.after!==r.before).length,2);assert.equal(ep.expected.at(-1).after,0);
 const ea=structuredClone(eb);for(const r of ep.expected)ea.stocks.find(x=>x.StockKey===r.StockKey).Stock=r.after;
 ea.adjustments.push({StockHistoryKey:2,ProdKey:1,OrderYear:'2026',OrderWeek:'04-01',ChangeType:'재고조정',BeforeValue:0,AfterValue:30,TypeMatches:1,Descr:ep.repairDescription});
 assert.equal(verify(eb,ea,ep).addedHistory,1);assert.equal(ea.products[0].Stock,9);
 for(const mutation of [f=>f.stocks[0].Stock=1,f=>f.stocks[2].Stock=-20,f=>f.stocks[3].Stock=1,f=>f.stocks[4].Stock=1,
  f=>f.adjustments[0].BeforeValue=10,f=>f.adjustments[0].AfterValue=-29,f=>f.adjustments.push({...f.adjustments[0],StockHistoryKey:2}),
  f=>f.incoming.push({ProdKey:1,OrderYear:'2026',OrderWeek:'04-02',OutQuantity:1}),
  f=>f.outgoing.push({ProdKey:1,OrderYear:'2026',OrderWeek:'04-01',OutQuantity:0})]){const x=earlyFixture();mutation(x);assert.throws(()=>plan(x,earlyScope));}
 assert.throws(()=>plan(eb,{...earlyScope,cleanupPurposeConfirmed:false}));assert.throws(()=>plan(eb,{...earlyScope,earlyCleanupResetApproved:false}));
 assert.throws(()=>plan(eb,{...earlyScope,resetWeeks:{1:'03-02'}}));assert.throws(()=>plan(eb,{...earlyScope,year:'2025'}));
 const sentinel=earlyFixture();sentinel.incoming.push({ProdKey:1,OrderYear:'2025',OrderWeek:'04-01',OutQuantity:999});assert.equal(plan(sentinel,earlyScope).items[0].excess,30);
 const neutral=earlyFixture();neutral.incoming.push({ProdKey:1,OrderYear:'2026',OrderWeek:'04-02',OutQuantity:10});neutral.outgoing.push({...neutral.incoming[0]});assert.equal(plan(neutral,earlyScope).items[0].excess,30);
 const duplicateRead=structuredClone(ea);duplicateRead.stocks[2]={...duplicateRead.stocks[1]};assert.throws(()=>verify(eb,duplicateRead,ep),/READBACK/);
 assert.match(script,/evidenceJson\(before\)/);assert.match(script,/NENOVA_REPAIR_ACTOR/);
 const {auditStockRange}=await import('../lib/profitIndependentAudit.mjs');
 const s=fixture();s.products[0]={...s.products[0],ProdName:'fixture',Category:'에콰도르',EstUnit:'송이',Stockable:1};s.prices=[];
 const audit=auditStockRange(s,{year:'2026',major:'41'});
 assert.match(audit.weeks[40].entries[0].repairWarning,/중복 반영/);
 console.log('PASS historical stock repair: explicit purpose, exact offset, cross-year isolation/cascade, source hash, protected ledgers, failure rollback, future negative guard, cleanup warning');
})();
if(require.main===module)module.exports.catch(e=>{console.error(e);process.exitCode=1});
