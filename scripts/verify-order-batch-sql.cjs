'use strict';
// Executes the actual createOrder SQL in a strictly disposable loopback database.
// No environment DB fallback, production endpoint, credential output or cleanup.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),{AsyncLocalStorage}=require('node:async_hooks');
const sql=require('mssql'),{loadCreateOrder,call}=require('../__tests__/myCustomerOrderApi.test.js');
const args=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split('='))),root=process.cwd(),baselineRevision='92b99940';
const state=JSON.parse(fs.readFileSync(args['db-state']||path.join(root,'work/mixed-load/db-state.json'),'utf8'));
if(state.host!=='127.0.0.1'||Number(state.port)!==14339||state.database!=='NenovaUploadSynthetic'||!/^nenova-upload-synthetic-\d+$/.test(state.name))throw Error('Disposable loopback fixture required');
const output=path.resolve(args.output||path.join(root,'.verify/order-batch-sql.json')),context=new AsyncLocalStorage(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={schemaVersion:1,engine:'SQL Server 2022 disposable loopback',productionData:false,baselineRevision,items:54,queryMetric:'Application Request.query round trips; transaction begin/commit/rollback control packets excluded',viewEvidence:'docs/WEB_VS_ERP_CONFLICTS.md section 7.4 native ViewOrder',measurements:[],checks:{},limitations:['Synthetic schema; production table statistics, network RTT and full production schema are not reproduced.','Authorization, telemetry sink and edit-presence sidecar seams are inert; quantity normalization, write policy, post-write evaluation, API SQL and transaction retry/rollback helper are real.']};
let pool;
const plainSource=relative=>fs.readFileSync(path.join(root,relative),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*/gm,'').replace(/export\s+(?=(?:async\s+)?(?:function|const))/g,'');
const unit=new Function(plainSource('lib/orderUtils.js')+'\nreturn {normalizeOrderUnit,requireOrderYear};')();
const qty=new Function(plainSource('lib/shipmentAvailability.js')+'\nreturn {normalizeShipmentQty};')();
const post=new Function('normalizeShipmentQty',plainSource('lib/shipmentAdjustmentPostWrite.js')+'\nreturn {evaluateOrderRegistrationPostWrite,orderRegistrationPostWriteMismatchError};')(qty.normalizeShipmentQty);
function mark(text){const current=context.getStore();if(current){current.queryRequests++;if(/\b(?:INSERT|UPDATE|DELETE)\b/i.test(text))current.writeRequests++;if(/\bAppLog\b/i.test(text))current.logRequests++;}}
async function delayRequest(){const metric=context.getStore(),delay=metric?.artificialDelayMs||0;if(delay){const started=performance.now();await sleep(delay);metric.observedInjectedWaitMs+=performance.now()-started;}}
async function execute(request,text,params={}){mark(text);await delayRequest();for(const [key,{type,value}] of Object.entries(params))request.input(key,type,value);return request.query(text);}
class MeasuredRequest extends sql.Request{async query(text){mark(text);await delayRequest();return super.query(text);}}
const dbSource=fs.readFileSync(path.join(root,'lib/db.js'),'utf8');
const transactionFunctions=new Function('sql','getPool','telemetry',dbSource.slice(dbSource.indexOf('function sleep('),dbSource.indexOf('export { sql }')).replace(/export\s+/g,'')+'\nreturn {withTransaction};')({...sql,Request:MeasuredRequest},async()=>pool,{measure:(_name,fn)=>fn()});
const db={query:(text,params)=>execute(pool.request(),text,params),withTransaction:async(fn,options)=>{const m=context.getStore();if(m)m.transactionCalls++;return transactionFunctions.withTransaction(fn,options);},stockCalls:[]};
function api(source){return loadCreateOrder(db,{source,dependencies:{sql,...unit,...post,runOrderStockCalculationBatch:async()=>{throw Error('Unexpected stock mutation');}}});}
async function measure(label,handler,body,artificialDelayMs=0){const metric={label,artificialDelayMs,observedInjectedWaitMs:0,queryRequests:0,writeRequests:0,logRequests:0,transactionCalls:0};const started=performance.now();const response=await context.run(metric,()=>call(handler,db,body,{user:{userId:'fixture-order',userName:'Fixture order'}}));metric.elapsedMs=Math.round((performance.now()-started)*100)/100;metric.observedInjectedWaitMs=Math.round(metric.observedInjectedWaitMs*100)/100;metric.status=response.statusCode;report.measurements.push(metric);return response;}
async function raw(text,params={}){const request=pool.request();for(const [key,{type,value}]of Object.entries(params))request.input(key,type,value);return request.query(text);}
async function init(){
 const dbName=(await raw('SELECT DB_NAME() AS n')).recordset[0].n;assert.equal(dbName,'NenovaUploadSynthetic');
 const guard=await raw("SELECT OBJECT_ID('OrderBatchFixtureGuard') AS g,OBJECT_ID('OrderMaster') AS m");
 if(!guard.recordset[0].g){assert.equal(guard.recordset[0].m,null,'Refuse to alter unmarked existing tables');const tx=new sql.Transaction(pool);await tx.begin();try{for(const batch of fs.readFileSync(path.join(root,'scripts/fixtures/order-batch-synthetic.sql'),'utf8').split(/^GO\s*$/m))if(batch.trim())await new sql.Request(tx).query(batch);await tx.commit();}catch(error){await tx.rollback();throw error;}}
 assert.equal((await raw('SELECT Marker FROM OrderBatchFixtureGuard WHERE Id=1')).recordset[0]?.Marker,'nenova-order-batch-synthetic-v1');
 await raw("IF COL_LENGTH('AppLog','LogDtm') IS NULL ALTER TABLE AppLog ADD LogDtm datetime DEFAULT GETDATE()");
}
const products=Array.from({length:54},(_,i)=>({pk:i+1,name:'Fixture '+(i+1),out:['박스','단','송이'][i%3],est:['송이','박스','단'][i%3],country:i===53?'Fixture-edge':'Fixture'}));
const body={source:'order-import-final',custKey:317,year:'2026',week:'32-01',orderMode:'FINAL_SNAPSHOT',items:products.map((p,i)=>({prodKey:p.pk,prodName:p.name,qty:i+1,unit:['박스','단','송이'][i%3],descr:'fixture memo '+i}))};
async function reset({missingCountry=false}={}){
 await raw(`DELETE FROM OrderHistory; DBCC CHECKIDENT ('OrderHistory',RESEED,0) WITH NO_INFOMSGS;
 DELETE FROM AppLog;DELETE FROM OrderDetail;DELETE FROM OrderMaster;DELETE FROM ShipmentDetail;DELETE FROM ShipmentMaster;DELETE FROM KeyNumbering;DELETE FROM Product;DELETE FROM Country;DELETE FROM Customer;
 DELETE FROM ShipmentDate;DELETE FROM ShipmentFarm;DELETE FROM Estimate;DELETE FROM WebProfitReport;DELETE FROM ProductStock;
 IF NOT EXISTS(SELECT 1 FROM UserInfo WHERE UserID=N'fixture-order') INSERT UserInfo(UserID,UserName,Authority,isDeleted) VALUES(N'fixture-order',N'Fixture order',9,0);
 INSERT Customer VALUES(317,N'Fixture customer',N'Fixture area',N'fixture-order',N'F317',N'fixture',0),(318,N'Fixture second customer',N'Fixture area',N'fixture-order',N'F318',N'fixture',0);
 INSERT Country VALUES(N'Fixture',0);${missingCountry?'':"INSERT Country VALUES(N'Fixture-edge',0);"}
 INSERT Product(ProdKey,ProdName,FlowerName,OutUnit,EstUnit,CounName,CountryFlower,Descr,BunchOf1Box,SteamOf1Box,SteamOf1Bunch,isDeleted)
 SELECT pk,name,N'Fixture flower',outUnit,estUnit,country,N'Fixture flower',N'fixture',10,100,10,0 FROM OPENJSON(@products) WITH(pk int,name nvarchar(100),outUnit nvarchar(20) '$.out',estUnit nvarchar(20) '$.est',country nvarchar(100));
 INSERT OrderMaster(OrderMasterKey,OrderDtm,OrderYear,OrderWeek,OrderYearWeek,Manager,CustKey,OrderCode,Descr,isDeleted,CreateID)
 VALUES(1,'20250101',N'2025',N'32-01',N'202532',N'fixture-order',317,N'F317',N'prior-year sentinel',0,N'admin');
 INSERT OrderDetail(OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID)
 VALUES(1,1,1,7,70,700,7,700,0,N'prior-year sentinel',0,N'admin');
 INSERT ShipmentMaster(ShipmentKey,CustKey,OrderYear,OrderWeek,isFix,isDeleted,EstimateName) VALUES(1,317,N'2025',N'32-01',1,0,N'prior-year sentinel');
 INSERT KeyNumbering VALUES(N'OrderMasterKey',1,N''),(N'OrderDetailKey',1,N''),(N'ShipmentMasterKey',1,N'');
 INSERT ShipmentDate VALUES(1,N'preserve');INSERT ShipmentFarm VALUES(1,N'preserve');INSERT Estimate VALUES(1,N'preserve');INSERT WebProfitReport VALUES(1,N'preserve');INSERT ProductStock VALUES(1,N'preserve');`,{products:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(products)}});
}
async function validateLogs(expected){const r=await raw("SELECT COUNT(*) AS n,SUM(CASE WHEN LogDtm IS NULL THEN 1 ELSE 0 END) AS missingTime FROM AppLog WHERE Step=N'OD_INSERT'");assert.equal(r.recordset[0].n,expected,'Every inserted detail retains one OD_INSERT diagnostic');assert.equal(Number(r.recordset[0].missingTime||0),0,'Diagnostic timestamps are populated');}
const round=value=>typeof value==='number'?Math.round(value*1e10)/1e10:value;
async function snapshot(){
 const result=await raw(`SELECT OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,Manager,CustKey,OrderCode,Descr,isDeleted,CreateID FROM OrderMaster ORDER BY OrderMasterKey;
 SELECT OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID FROM OrderDetail ORDER BY OrderDetailKey;
 SELECT OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID FROM OrderHistory ORDER BY OrderDetailKey,OrderHistoryKey;
 SELECT Category,LastKeyNo FROM KeyNumbering ORDER BY Category;
 SELECT ShipmentKey,CustKey,OrderYear,OrderWeek,OrderYearWeek,isFix,isDeleted,EstimateName,WebCreated,CreateID FROM ShipmentMaster ORDER BY ShipmentKey;
 SELECT * FROM ShipmentDetail ORDER BY ShipmentDetailKey;
 SELECT OrderMasterKey,OrderDetailKey,OrderYear,OrderWeek,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity FROM ViewOrder ORDER BY OrderDetailKey;
 SELECT * FROM ShipmentDate;SELECT * FROM ShipmentFarm;SELECT * FROM Estimate;SELECT * FROM WebProfitReport;SELECT * FROM ProductStock;`);
 return result.recordsets.map((rows,index)=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,index===2&&['BeforeValue','AfterValue'].includes(key)?Number(value):round(value)]))));
}
function validateSaved(saved){
 const rows=saved[1].filter(row=>row.OrderMasterKey!==1);assert.equal(rows.length,54);assert.equal(saved[2].length,54);assert.equal(saved[6].filter(row=>row.OrderYear==='2026').length,54);assert.equal(saved[0].length,2);assert.equal(saved[4].length,2);assert.equal(saved[5].length,0);
 for(const [i,row]of rows.entries()){assert.equal(row.OrderDetailKey,i+2);assert.equal(row.ProdKey,i+1);assert.equal(row.OutQuantity,i+1);assert.equal(row.NoneOutQuantity,0);assert.equal(row.CreateID,'admin');const quantities={박스:row.BoxQuantity,단:row.BunchQuantity,송이:row.SteamQuantity};assert.equal(round(quantities[products[i].out]),row.OutQuantity);assert.equal(round(quantities[products[i].est]),row.EstQuantity);}
 assert.equal(saved[0][0].OrderYear,'2025');assert.equal(saved[1][0].OutQuantity,7);for(let i=7;i<saved.length;i++)assert.deepEqual(saved[i],[{Id:1,Sentinel:'preserve'}]);
}
(async()=>{
 pool=await new sql.ConnectionPool({server:state.host,port:Number(state.port),database:state.database,user:state.user,password:state.password,options:{encrypt:false,trustServerCertificate:true},pool:{max:12,min:0,idleTimeoutMillis:10000},connectionTimeout:5000,requestTimeout:30000}).connect();await init();
 const prior=spawnSync('git',['show',baselineRevision+':pages/api/orders/index.js'],{encoding:'utf8',windowsHide:true});assert.equal(prior.status,0,'Baseline source unavailable');const current=fs.readFileSync(path.join(root,'pages/api/orders/index.js'),'utf8');report.currentSourceSha256=crypto.createHash('sha256').update(current).digest('hex');
 let baselineSaved,currentSaved;
 for(const delay of [0,5])for(const [label,source]of [['baseline',prior.stdout],['current',current]]){
  await reset();const handler=api(source),response=await measure(label+'-54-new',handler,body,delay);assert.equal(response.statusCode,201,response.payload?.error);const saved=await snapshot();validateSaved(saved);await validateLogs(54);if(label==='baseline')baselineSaved=saved;else{currentSaved=saved;assert.deepEqual(currentSaved,baselineSaved,'Baseline/current ledger, history, keys, view and sentinels must match');}
  const replay=await measure(label+'-54-replay',handler,body,delay);assert.equal(replay.statusCode,201,replay.payload?.error);assert.deepEqual(await snapshot(),saved,'Same final snapshot must not change quantities/history/keys');assert(replay.payload.results.every(row=>row.status==='UNCHANGED'));await validateLogs(54);
 }
 report.checks.baselineCurrentAllUnitsHistoryKeysViewPriorYearAndDownstreamEqual=true;report.checks.replayPreservesLedgerAndHistory=true;
 // Concurrent identical saves must serialize on the actual SQL locks. The second
 // request sees the first committed snapshot and performs no additive duplicate.
 await reset();const handler=api(current),responses=await Promise.all([measure('current-concurrent-a',handler,body),measure('current-concurrent-b',handler,body)]);assert(responses.every(response=>response.statusCode===201),responses.map(response=>response.payload?.error).join(';'));const concurrent=await snapshot();validateSaved(concurrent);assert.deepEqual(concurrent,currentSaved);report.checks.concurrentSameScopeNoDuplicate=true;await validateLogs(54);
 await reset();const distinct=await Promise.all([measure('current-concurrent-customer-a',api(current),body),measure('current-concurrent-customer-b',api(current),{...body,custKey:318})]);assert(distinct.every(response=>response.statusCode===201),distinct.map(response=>response.payload?.error).join(';'));const other=await snapshot();assert.equal(other[0].length,3);assert.equal(other[1].length,109);assert.equal(new Set(other[1].map(row=>row.OrderDetailKey)).size,109);assert.equal(other[2].length,108);assert.equal(other[6].filter(row=>row.OrderYear==='2026').length,108);assert.equal(other[4].length,3);assert.equal(other[5].length,0);await validateLogs(108);report.checks.concurrentDistinctCustomersUniqueKeysAndNativeRows=true;
 // Remove exactly one Country join target. Raw writes would succeed, but the
 // native ViewOrder loses that product, forcing the real evaluator to rollback.
 for(const [label,source]of [['baseline',prior.stdout],['current',current]]){
  await reset({missingCountry:true});assert.equal((await raw('SELECT COUNT(*) AS n FROM Product p LEFT JOIN Country c ON c.CounName=p.CounName WHERE c.CounName IS NULL')).recordset[0].n,1);const before=await snapshot(),response=await measure(label+'-one-native-view-row-missing',api(source),body);assert.equal(response.statusCode,409,response.payload?.error);assert.equal(response.payload.code,'ORDER_POST_WRITE_MISMATCH');assert.deepEqual(await snapshot(),before,'Native-view mismatch must rollback every ledger/history/key/header change');await validateLogs(54);
 }
 report.checks.singleMissingNativeViewRowRollsBackAll=true;report.checks.insertDiagnosticCountAndTimestampsPreserved=true;report.checks.rollbackRetainsDiagnosticCountAndTimestamps=true;report.checks.stockHelperNeverCalled=true;report.passed=true;fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error('ORDER_BATCH_SYNTHETIC_SQL_FAILED: '+String(error.message));process.exitCode=1;}).finally(async()=>{if(pool)await pool.close();});
