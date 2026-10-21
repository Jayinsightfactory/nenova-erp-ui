const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');
module.exports=(async()=>{
 const {planStockCalculationOrderRepair:plan,executeOrderedHistoricalStockRepair:execute,UNORDERED_CALC_SHA256}=await import('../lib/stockCalculationOrderRepair.mjs');
 const {stockRepairDigest:digest}=await import('../lib/historicalStockRepair.mjs');
 const {ORDERED_STOCK_SP_SHA256,ORDERED_STOCK_SP_CREATE_SHA256,knownStockCalculationPolicy}=await import('../lib/profitIndependentAudit.mjs');
 const {patch,business}=require('../scripts/native-stock-gate-atomic.cjs');
 const originals=JSON.parse(fs.readFileSync('__tests__/fixtures/native-stock-gate-2026-10-12.json','utf8').replace(/^\uFEFF/,''));
 const definition=patch(originals.find(r=>r.name==='usp_StockCalculation').definition).definition;
 const migration=plan(definition),hash=s=>createHash('sha256').update(s).digest('hex');
 assert.equal(migration.beforeHash,UNORDERED_CALC_SHA256);assert.deepEqual(migration.afterHashes,[ORDERED_STOCK_SP_SHA256,ORDERED_STOCK_SP_CREATE_SHA256]);
 assert.equal(migration.alterSql.replace('ALTER PROCEDURE','CREATE PROCEDURE').replace('FROM #CalculationList ORDER BY OrderYear, OrderWeek;','FROM #CalculationList;'),definition);
 assert.equal(business(migration.alterSql).replace('FROM #CalculationList ORDER BY OrderYear, OrderWeek;','FROM #CalculationList;'),business(definition));
 for(const value of [null,'',definition+' ',definition.replace('ROUND','CEILING'),definition+definition,migration.alterSql])assert.throws(()=>plan(value),/DEFINITION_CHANGED/);
 assert(knownStockCalculationPolicy(migration.beforeHash));for(const h of migration.afterHashes)assert(knownStockCalculationPolicy(h));assert(!knownStockCalculationPolicy('0'.repeat(64)));
 const unsorted=['2027/01-01','2026/42-01','2026/35-01','2025/35-01','2026/34-02B','2026/41-03','2026/34-02A','2026/34-02'];
 assert.deepEqual(unsorted.sort(),['2025/35-01','2026/34-02','2026/34-02A','2026/34-02B','2026/35-01','2026/41-03','2026/42-01','2027/01-01']);
 const scope={year:'2026',startWeek:'30-01',offsetWeek:'41-02',prodKeys:[1],cleanupPurposeConfirmed:true};
 const fixture=()=>({masters:[{StockKey:1,OrderYear:'2026',OrderWeek:'29-02',OrderYearWeek:'20262902'},
  {StockKey:2,OrderYear:'2026',OrderWeek:'30-01',OrderYearWeek:'20263001'},
  {StockKey:3,OrderYear:'2026',OrderWeek:'41-02',OrderYearWeek:'20264102'},
  {StockKey:4,OrderYear:'2027',OrderWeek:'01-01',OrderYearWeek:'20270101'}],
  stocks:[0,20,0,0].map((Stock,i)=>({StockKey:i+1,ProdKey:1,Stock})),
  products:[{ProdKey:1,isDeleted:false,OutUnit:'송이',Stock:9}],incoming:[],outgoing:[],
  adjustments:[{StockHistoryKey:1,ProdKey:1,OrderYear:'2026',OrderWeek:'41-02',BeforeValue:20,AfterValue:0,TypeMatches:1,Descr:'cleanup'}],
  protected:{sales:'keep'},procedureHash:hash(definition)});
 const idle={Mode:null,LockedAt:null,Action:null,OrderYear:null,OrderWeek:null,OwnerSessionID:null,OwnerToken:null,CalcProdKey:null,PendingCalc:false,ProtocolVersion:2};
 for(const failure of ['none','stored-create','approval','stale','gate','signed','backup','ddl','metadata','ddl-side-effect','native','readback','property','capability','property-update','no-transaction','lost-transaction']){
  const live=fixture();let working=structuredClone(live),currentDefinition=definition,backed=false,altered=false,committed=false;
  const propertyHash=d=>createHash('sha256').update(d,'utf16le').digest('hex').toUpperCase();
  let valueHex=failure==='property'?'0'.repeat(64):propertyHash(definition);
  const tQuery=async(text,params)=>{
   if(text.startsWith('SELECT @@SPID'))return {recordset:[{SessionID:1,TranCount:failure==='no-transaction'||(altered&&failure==='lost-transaction')?0:1,TxState:1}]};
   if(text.includes('NenovaStockWeekGate WITH'))return {recordset:[{...idle,...(failure==='gate'?{Mode:'BUSY'}:{})}]};
   if(text.includes('sys.sql_modules'))return {recordsets:[[{Definition:currentDefinition}],
    [{object_id:123,uses_ansi_nulls:true,uses_quoted_identifier:false}],
    [{parameter_id:1,name:'@OrderYear'}],[{type:altered&&failure==='metadata'?'XX':'EX'}],[{SignatureCount:failure==='signed'?1:0}],
    [{minor_id:0,name:'NenovaStockGateOwnerV2Hash',ValueHex:valueHex}]]};
   if(text==='EXEC dbo.usp_NenovaStockWeekGateCapability;')return {recordset:[{ProtocolVersion:2,IsReady:failure==='capability'?0:1}]};
   if(text.startsWith('SET ANSI_NULLS')){assert.match(text,/QUOTED_IDENTIFIER OFF/);assert.match(text,/sp_executesql @ddl/);assert.equal(params.ddl.value,migration.alterSql);
    assert(backed);if(failure==='ddl')throw Error('ddl');altered=true;currentDefinition=failure==='stored-create'?params.ddl.value.replace('ALTER PROCEDURE','CREATE PROCEDURE'):params.ddl.value;working.procedureHash=hash(currentDefinition);
    if(failure==='ddl-side-effect')working.products[0].Stock=99;return {};}
   if(text.includes('sp_updateextendedproperty')){if(failure==='property-update')throw Error('property-update');valueHex=propertyHash(currentDefinition);return {};}
   if(text.includes('INSERT INTO StockHistory')){working.adjustments.push({StockHistoryKey:2,ProdKey:1,OrderYear:'2026',OrderWeek:'41-02',ChangeType:'재고조정',BeforeValue:0,AfterValue:20,TypeMatches:1,Descr:params.descr.value});return {};}
   throw Error('Unexpected SQL');
  };
  try{const result=await execute({tQuery,types:{NVarChar:()=> 's',MAX:-1,Float:'f',Int:'i'},scope,expectedHash:failure==='stale'?'0'.repeat(64):digest(live),
    readState:async()=>structuredClone(working),actor:'fixture',orderingFixApproved:failure!=='approval',
    backup:async data=>{assert.equal(data.metadata.definition,definition);if(failure==='backup')throw Error('backup');backed=true},
    runNative:async()=>{if(failure==='native')throw Error('native');working.stocks[1].Stock=0;if(failure==='readback')working.protected.sales='changed';},
   });assert.equal(result.ordering.afterHash,failure==='stored-create'?ORDERED_STOCK_SP_CREATE_SHA256:ORDERED_STOCK_SP_SHA256);assert.equal(result.verification.changedSnapshots,1);committed=true;
  }catch{working=structuredClone(live);currentDefinition=definition;}
  assert.equal(committed,['none','stored-create'].includes(failure),failure);
  if(!committed){assert.deepEqual(working,live);assert.equal(currentDefinition,definition);}
  if(['approval','stale','gate','signed','backup','property','capability','no-transaction'].includes(failure))assert.equal(altered,false);
 }
 const script=fs.readFileSync('scripts/historical-stock-repair.mjs','utf8');
 assert.match(script,/rehearsal\.orderingFixApproved!==orderingFixApproved/);assert.match(script,/ordering.afterHashes.includes\(rehearsal\.ordering\?\.afterHash\)/);
 assert.match(script,/flag:'wx'/);assert.match(script,/tx\.rollback\(\)/);assert.match(script,/Post-commit procedure metadata/);
 console.log('PASS ordered CALC: exact hash/only cursor change, native formulas preserved, metadata/signature/backup, one transaction failure rollback, cross-year/legacy order');
})();
if(require.main===module)module.exports.catch(e=>{console.error(e);process.exitCode=1});
