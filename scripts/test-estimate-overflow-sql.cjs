#!/usr/bin/env node
/*
 * Isolated SQL integration harness for estimate next-subweek overflow.
 *
 * This deliberately uses the same guarded, disposable SQL Server container,
 * exact native StockCalculation backup, VM-loaded API adapter, and transaction
 * helpers as test-estimate-directional-sql.cjs.  The overflow schema is
 * additive only; the base fixture is never edited.  No production connection,
 * API server, secret output, or unguarded DROP is permitted.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const sql = require('mssql');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const DB_PREFIX = 'NenovaEstimateFixture_';
const BASE_SCHEMA = path.join(ROOT, '__tests__', 'fixtures', 'estimateDirectionalSchema.sql');
const OVERFLOW_SCHEMA = path.join(ROOT, '__tests__', 'fixtures', 'estimateOverflowSchema.sql');
const NATIVE_BACKUP = path.join(ROOT, 'docs', 'migrations', 'backup_usp_StockCalculation_2026-08-23_before_stock_week_gate.sql');
const ADAPTER = path.join(ROOT, 'scripts', 'fixtures', 'estimateDirectionalApiAdapter.cjs');
const YEAR = '2026';
const CUST = 533;
const PROD = 1239;
const SOURCE_WEEK = '36-01';
const NEXT_WEEK = '36-02';
const SOURCE_DETAIL = 360101;
const SOURCE_DATE = 360101;
const SOURCE_DATE_OTHER = 360102;
const NEXT_MASTER = 360201;
const NEXT_DETAIL = 360201;
const NEXT_DATE = 360201;
const PRIOR_MASTER = 250101;

function fail(message) { throw new Error(`[estimate-overflow-sql] ${message}`); }
function assert(condition, message) { if (!condition) fail(message); }
function normalize(text) { return String(text).replace(/\s+/g, ' ').trim(); }
function parseArgs(argv) {
  const args = { keepDb: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    if (argv[i] === '--keep-db') { args.keepDb = true; continue; }
    fail(`unknown argument: ${argv[i]}`);
  }
  return args;
}
function inspectContainer() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved fixture container is not inspectable');
  let info;
  try { info = JSON.parse(result.stdout)[0]; } catch { fail('fixture container inspect response is invalid'); }
  assert(info?.Name === `/${CONTAINER}`, 'container name guard failed');
  assert(info.State?.Running === true, 'fixture container is not running');
  assert(/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || '')), 'fixture image guard failed');
  assert((info.Mounts || []).length === 0 && (info.HostConfig?.Binds || []).length === 0, 'fixture container has a mount');
  const bindings = info.HostConfig?.PortBindings?.['1433/tcp'] || [];
  assert(bindings.some(b => b.HostIp === HOST && String(b.HostPort) === String(PORT)), 'fixture port binding guard failed');
  const env = new Map((info.Config?.Env || []).map(entry => {
    const at = String(entry).indexOf('=');
    return [at < 0 ? String(entry) : entry.slice(0, at), at < 0 ? '' : String(entry).slice(at + 1)];
  }));
  assert(env.get('MSSQL_SA_PASSWORD'), 'fixture SA password is missing');
  return { password: env.get('MSSQL_SA_PASSWORD'), image: info.Config.Image };
}
function assertDbName(name) {
  assert(/^NenovaEstimateFixture_[0-9]{8}_[0-9a-f]{8}$/.test(name), 'generated database name guard failed');
}
function newDbName() {
  const stamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 8);
  const name = `${DB_PREFIX}${stamp}_${crypto.randomBytes(4).toString('hex')}`;
  assertDbName(name);
  return name;
}
function bracket(name) { assertDbName(name); return `[${name.replace(/]/g, ']]')}]`; }
function splitBatches(text) { return text.split(/^\s*GO\s*;?\s*$/gim).map(batch => batch.trim()).filter(Boolean); }
function inferType(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? sql.Int : sql.Float;
  if (typeof value === 'boolean') return sql.Bit;
  return sql.NVarChar;
}
function requestFor(executor, params = {}) {
  const request = new sql.Request(executor);
  for (const [name, spec] of Object.entries(params)) {
    const item = spec && Object.prototype.hasOwnProperty.call(spec, 'value') ? spec : { value: spec };
    request.input(name, item.type || inferType(item.value), item.value);
  }
  return request;
}
function query(executor, statement, params = {}) { return requestFor(executor, params).query(statement); }
async function withTransaction(pool, fn) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  let committed = false;
  try {
    const value = await fn(tx);
    await tx.commit();
    committed = true;
    return value;
  } finally {
    if (!committed) await tx.rollback().catch(() => {});
  }
}
const makeTQ = executor => (statement, params = {}) => query(executor, statement, params);
function validateBackup() {
  assert(fs.existsSync(NATIVE_BACKUP), 'native backup is missing');
  const source = fs.readFileSync(NATIVE_BACKUP, 'utf8');
  for (const marker of ['usp_StockCalculation', '@OrderYear', '@OrderWeek', '@ProdKey', 'StockMaster', 'ProductStock', 'ViewWarehouse', 'ViewShipment', 'StockHistory', 'CodeInfo']) assert(source.includes(marker), `native backup marker missing: ${marker}`);
  return { source, digest: crypto.createHash('sha256').update(source).digest('hex').slice(0, 12) };
}
async function installNative(pool, source) {
  const reference = source.replace(/CREATE\s+PROCEDURE\s+\[dbo\]\.\[usp_StockCalculation\]/i, 'CREATE PROCEDURE dbo.usp_StockCalculation_Reference');
  assert(reference !== source, 'native procedure declaration not found');
  await query(pool, `IF OBJECT_ID(N'dbo.usp_StockCalculation_Reference', N'P') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation_Reference;`);
  for (const batch of splitBatches(reference)) await query(pool, batch);
}
function v(value) { return value == null ? null : value; }

async function resetFixture(pool, options = {}) {
  const partial = options.partial === true;
  const existingNext = options.existingNext === true;
  const sourceOut = partial ? 46 : 50;
  const sourceDateOne = partial ? 36 : 40;
  const sourceDateTwo = 10;
  const targetOut = existingNext ? 5 : 0;
  const targetDateOne = existingNext ? 2 : 0;
  const targetDateTwo = existingNext ? 3 : 0;
  const targetAdjust = 10 - (partial ? 4 : 0) - 30 + targetOut;
  const targetStock = 10;
  await withTransaction(pool, async tx => {
    for (const table of ['OrderHistory','KeyNumbering','PeriodDay','Country','SystemActionLog','Estimate','ShipmentDate','ShipmentDetail','ShipmentMaster','ShipmentFarm','ShipmentHistory','OrderDetail','OrderMaster','WarehouseDetail','WarehouseMaster','StockHistory','ProductStock','StockMaster','FixtureNativeCalcControl','NenovaStockWeekGate','Product','Customer','UserInfo']) {
      await query(tx, `DELETE FROM dbo.[${table}]`);
    }
    await query(tx, `
      INSERT dbo.UserInfo (UserID,UserName) VALUES (N'admin',N'관리자');
      INSERT dbo.Customer (CustKey,CustName,BaseOutDay,Manager,OrderCode) VALUES (@ck,N'Overflow Customer',4,N'관리자',N'FIX'),(N'534',N'Prior Customer',4,N'admin',N'FIX');
      INSERT dbo.Product (ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
        VALUES (@pk,N'Deep Silver 50cm',N'Deep Silver',N'Fixture Country',N'Deep Silver',N'단',N'송이',10,10,100,700,100);
      INSERT dbo.Country (CounName) VALUES (N'Fixture Country');
      INSERT dbo.PeriodDay (OrderYearWeek,WeekDay,BaseYmd) VALUES (N'202636',4,CONVERT(datetime,'2026-09-03T00:00:00'));
      INSERT dbo.StockMaster (StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
        VALUES (2501,N'2025',N'36-01',N'20253601',1,N'admin'),(3601,N'2026',N'36-01',N'20263601',1,N'admin'),(3602,N'2026',N'36-02',N'20263602',1,N'admin');
      INSERT dbo.ProductStock (StockKey,ProdKey,Stock) VALUES (2501,@pk,0),(3601,@pk,@sourceStock),(3602,@pk,@targetStock);
      INSERT dbo.WarehouseMaster (WarehouseKey,OrderYear,OrderWeek,UploadDtm,FileName) VALUES (3601,N'2026',N'36-01',GETDATE(),N'overflow.xlsx'),(3602,N'2026',N'36-02',GETDATE(),N'overflow.xlsx');
      INSERT dbo.WarehouseDetail (WdetailKey,WarehouseKey,ProdKey,FarmKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch)
        VALUES (3601,3601,@pk,NULL,@incoming1,@incoming1,@incoming1*10,@incoming1,@incoming1*10,700,@incoming1*700,100,10),(3602,3602,@pk,NULL,@incoming2,@incoming2,@incoming2*10,@incoming2,@incoming2*10,700,@incoming2*700,100,10);
      IF NOT EXISTS(SELECT 1 FROM dbo.CodeInfo WHERE Category=N'StockType' AND Descr=N'재고조정')
        INSERT dbo.CodeInfo (Category,Descr) VALUES (N'StockType',N'재고조정');
      INSERT dbo.StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
        VALUES (GETDATE(),N'2026',N'36-02',N'fixture',N'재고조정',N'수량',0,@targetAdjust,N'overflow fixture',@pk);
      INSERT dbo.OrderMaster (OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,isDeleted,OrderDtm,OrderCode,Descr,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
        VALUES (360001,N'2026',N'36-01',N'202636',@ck,N'admin',0,GETDATE(),N'FIX',N'current order',N'admin',GETDATE(),N'admin',GETDATE()),
               (250001,N'2025',N'36-01',N'202536',@ck,N'admin',0,GETDATE(),N'FIX',N'prior sentinel',N'admin',GETDATE(),N'admin',GETDATE());
      INSERT dbo.OrderDetail (OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,OrderQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
        VALUES (360001,360001,@ck,@pk,@sourceOut/10,@sourceOut,@sourceOut*10,@sourceOrder, @sourceOrder,@sourceOrder*10,0,N'current order',0,N'admin',GETDATE(),N'admin',GETDATE()),
               (250001,250001,@ck,@pk,0,0,0,99,99,990,0,N'prior sentinel',0,N'admin',GETDATE(),N'admin',GETDATE());
      INSERT dbo.ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
        VALUES (@sourceMaster,N'2026',N'36-01',N'202636',@ck,1,0,1,N'admin'),(@nextMaster,N'2026',N'36-02',N'202636',@ck,1,0,1,N'admin'),(250101,N'2025',N'36-01',N'202536',@ck,1,0,1,N'admin');
      INSERT dbo.ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix,EstDescr)
        VALUES (@sourceDetail,@sourceMaster,@ck,@pk,@sourceOut,@sourceOut*10,@sourceOut/10,@sourceOut,@sourceOut*10,700,@sourceOut*700,0,N'current source',CONVERT(datetime,'2026-09-03T00:00:00'),1,N''),
               (@priorDetail,250101,@ck,@pk,99,990,9.9,99,990,700,69300,0,N'prior sentinel',CONVERT(datetime,'2025-09-03T00:00:00'),1,N'');
      SET IDENTITY_INSERT dbo.ShipmentDate ON;
      INSERT dbo.ShipmentDate (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
        VALUES (@sourceDate,@sourceDetail,CONVERT(datetime,'2026-09-03T00:00:00'),@sourceDateOne,@sourceDateOne*10,700,@sourceDateOne*700,0,N'fixture date'),
               (@sourceDateOther,@sourceDetail,CONVERT(datetime,'2026-09-04T00:00:00'),@sourceDateTwo,@sourceDateTwo*10,700,@sourceDateTwo*700,0,N'fixture date two'),
               (250101,@priorDetail,CONVERT(datetime,'2025-09-03T00:00:00'),99,990,700,69300,0,N'prior sentinel');
      SET IDENTITY_INSERT dbo.ShipmentDate OFF;
      INSERT dbo.Estimate (EstimateKey,ShipmentKey,ProdKey,EstimateType,Unit,SdetailKey,Quantity,Cost,Amount,Vat,isFix,Descr,EstimateDtm)
        VALUES (360001,@sourceMaster,@pk,N'견적',N'송이',@sourceDetail,@sourceOut*10,700,@sourceOut*700,0,1,N'fixture estimate',GETDATE());
      IF @targetOut > 0
      BEGIN
        INSERT dbo.OrderMaster (OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,isDeleted,OrderDtm,OrderCode,Descr,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
          VALUES (360002,N'2026',N'36-02',N'202636',@ck,N'admin',0,GETDATE(),N'FIX',N'existing next order',N'admin',GETDATE(),N'admin',GETDATE());
        INSERT dbo.OrderDetail (OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,OrderQuantity,EstQuantity,NoneOutQuantity,Descr,isDeleted,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
          VALUES (360002,360002,@ck,@pk,@targetOut/10,@targetOut,@targetOut*10,@targetOut,@targetOut,@targetOut*10,0,N'existing next order',0,N'admin',GETDATE(),N'admin',GETDATE());
        INSERT dbo.ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix,EstDescr)
          VALUES (@nextDetail,@nextMaster,@ck,@pk,@targetOut,@targetOut*10,@targetOut/10,@targetOut,@targetOut*10,700,@targetOut*700,0,N'existing next detail',CONVERT(datetime,'2026-09-03T00:00:00'),1,N'');
        SET IDENTITY_INSERT dbo.ShipmentDate ON;
        INSERT dbo.ShipmentDate (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
          VALUES (@nextDate,@nextDetail,CONVERT(datetime,'2026-09-03T00:00:00'),@targetDateOne,@targetDateOne*10,700,@targetDateOne*700,0,N'next default'),
                 (360202,@nextDetail,CONVERT(datetime,'2026-09-04T00:00:00'),@targetDateTwo,@targetDateTwo*10,700,@targetDateTwo*700,0,N'next other date');
        SET IDENTITY_INSERT dbo.ShipmentDate OFF;
      END
      INSERT dbo.FixtureNativeCalcControl (ControlKey,FailNext,FailureMessage) VALUES (1,0,N'forced overflow native failure');
      INSERT dbo.NenovaStockWeekGate (GateKey,Mode) VALUES (N'1',NULL);
    `, {
      ck:{type:sql.Int,value:CUST}, sourceMaster:{type:sql.Int,value:SOURCE_DETAIL}, nextMaster:{type:sql.Int,value:NEXT_MASTER}, sourceDetail:{type:sql.Int,value:SOURCE_DETAIL}, priorDetail:{type:sql.Int,value:250101}, nextDetail:{type:sql.Int,value:NEXT_DETAIL}, sourceDate:{type:sql.Int,value:SOURCE_DATE}, sourceDateOther:{type:sql.Int,value:SOURCE_DATE_OTHER}, nextDate:{type:sql.Int,value:NEXT_DATE}, pk:{type:sql.Int,value:PROD}, sourceOut:{type:sql.Float,value:sourceOut}, sourceOrder:{type:sql.Float,value:60}, sourceDateOne:{type:sql.Float,value:sourceDateOne}, sourceDateTwo:{type:sql.Float,value:sourceDateTwo}, incoming1:{type:sql.Float,value:50}, incoming2:{type:sql.Float,value:30}, sourceStock:{type:sql.Float,value:partial ? 4 : 0}, targetStock:{type:sql.Float,value:targetStock}, targetAdjust:{type:sql.Float,value:targetAdjust}, targetOut:{type:sql.Float,value:targetOut}, targetDateOne:{type:sql.Float,value:targetDateOne}, targetDateTwo:{type:sql.Float,value:targetDateTwo},
    });
  });
}

async function snapshot(pool) {
  const tables = ['OrderMaster','OrderDetail','ShipmentMaster','ShipmentDetail','ShipmentDate','OrderHistory','Estimate','Product','ProductStock','StockHistory','SystemActionLog'];
  const result = {};
  for (const table of tables) {
    result[table] = (await query(pool, `SELECT * FROM dbo.[${table}] ORDER BY 1`)).recordset;
  }
  return result;
}
function assertPriorSentinel(before, after) {
  for (const table of ['OrderMaster','OrderDetail','ShipmentMaster','ShipmentDetail','ShipmentDate']) {
    const prior = row => table === 'OrderMaster'
      ? row.OrderMasterKey === 250001
      : table === 'OrderDetail'
        ? row.OrderMasterKey === 250001 || row.OrderDetailKey === 250001
        : String(row.OrderYear) === '2025' || row.SdetailKey === 250101 || row.SdateKey === 250101;
    const priorBefore = before[table].filter(prior);
    const priorAfter = after[table].filter(prior);
    assert(JSON.stringify(priorAfter) === JSON.stringify(priorBefore), `prior-year sentinel changed in ${table}`);
  }
}
function bodyBase({ partial = false } = {}) {
  const oldOut = partial ? 36 : 40;
  const requestedOut = partial ? 46 : 50;
  return { orderYear:YEAR, custKey:CUST, clientId:'overflow-fixture-client', pageCode:'estimate', editGuard:{leaseToken:'overflow-fixture-lease',clientId:'overflow-fixture-client',expectedDigest:'fixture'}, items:[{sdateKey:SOURCE_DATE,quantity:requestedOut*10,unit:'송이',expectedOldQuantity:oldOut*10,expectedOldCost:700,expectedOldDescr:'fixture date'}] };
}
function assertResponse(response, label, expectedStatus = 200) {
  assert(Number(response?.statusCode) === expectedStatus, `${label}: expected status ${expectedStatus}, got ${response?.statusCode} ${JSON.stringify(response?.body)}`);
  return response.body || {};
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log('Usage: node scripts/test-estimate-overflow-sql.cjs [--keep-db]'); return; }
  const native = validateBackup();
  const container = inspectContainer();
  const dbName = newDbName();
  let master;
  let pool;
  try {
    master = await new sql.ConnectionPool({user:'sa',password:container.password,server:HOST,port:PORT,database:'master',options:{encrypt:false,trustServerCertificate:true},pool:{max:2,min:0}}).connect();
    await query(master, `CREATE DATABASE ${bracket(dbName)}`);
    await query(master, `ALTER DATABASE ${bracket(dbName)} SET COMPATIBILITY_LEVEL = 130`);
    pool = await new sql.ConnectionPool({user:'sa',password:container.password,server:HOST,port:PORT,database:dbName,options:{encrypt:false,trustServerCertificate:true},pool:{max:4,min:0}}).connect();
    for (const file of [BASE_SCHEMA, OVERFLOW_SCHEMA]) for (const batch of splitBatches(fs.readFileSync(file,'utf8'))) await query(pool,batch);
    await installNative(pool,native.source);
    const fixture = {
      pool,
      query:(statement,params)=>query(pool,statement,params),
      transactionContext:fn=>withTransaction(pool,tx=>fn({tx,tQ:makeTQ(tx)})),
      transaction:fn=>withTransaction(pool,fn),
      reset:options=>resetFixture(pool,options),
      snapshot:()=>snapshot(pool),
      setNativeCalcFailure:()=>query(pool,`UPDATE dbo.FixtureNativeCalcControl SET FailNext=1 WHERE ControlKey=1`),
    };
    const nativeCalc = { callInTransaction: async ({tx,orderYear=YEAR,orderWeek=SOURCE_WEEK,prodKey=PROD,userId='admin'}={}) => {
      const r=await query(tx,`DECLARE @r int,@m nvarchar(max); EXEC dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,@ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT; SELECT ISNULL(@r,0) AS result,@m AS message;`,{yr:{type:sql.NVarChar,value:orderYear},wk:{type:sql.NVarChar,value:orderWeek},pk:{type:sql.Int,value:prodKey},uid:{type:sql.NVarChar,value:userId}}); const row=r.recordset?.[0]||{}; if(Number(row.result)!==0) throw new Error(String(row.message||'native fixture calculation failed')); return row;
    }, forceFailure:()=>fixture.setNativeCalcFailure() };
    const audit={write:async(tQ,entry={})=>{const r=await tQ(`SELECT ISNULL(MAX(AuditKey),0)+1 AS nextKey FROM dbo.FixtureAudit`);await tQ(`INSERT dbo.FixtureAudit (AuditKey,ActionName,OwnerToken,Detail) VALUES (@key,@action,@owner,@detail)`,{key:{type:sql.Int,value:Number(r.recordset?.[0]?.nextKey||1)},action:{type:sql.NVarChar,value:String(entry.action||'adapter')},owner:{type:sql.NVarChar,value:entry.ownerToken||null},detail:{type:sql.NVarChar,value:JSON.stringify(entry.detail||{})}});}};
    const lease={contract:{ownerToken:true,enterBeforeTry:true,leaveAfterCommitOrRollback:true,failureHook:true},enter:async(tQ,{action='CALC',year=YEAR,week=SOURCE_WEEK,ownerToken}={})=>{const r=await tQ(`DECLARE @r int,@m nvarchar(200),@newOwner uniqueidentifier; EXEC dbo.usp_NenovaStockWeekGateEnter @Action=@action,@OrderYear=@yr,@OrderWeek=@wk,@oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,@OwnerToken=@newOwner OUTPUT,@CalcProdKey=0; SELECT @r AS result,@m AS message,@newOwner AS ownerToken;`,{action:{type:sql.NVarChar,value:action},yr:{type:sql.NVarChar,value:year},wk:{type:sql.NVarChar,value:week}});return r.recordset?.[0]||{};},leave:async(tQ,{action='CALC',success=false,ownerToken}={})=>{const r=await tQ(`DECLARE @r int,@owner uniqueidentifier=CONVERT(uniqueidentifier,@ownerInput); EXEC dbo.usp_NenovaStockWeekGateLeave @Action=@action,@Success=@success,@ProtocolVersion=2,@OwnerToken=@owner,@oResult=@r OUTPUT; SELECT @r AS result;`,{action:{type:sql.NVarChar,value:action},success:{type:sql.Bit,value:success?1:0},ownerInput:{type:sql.NVarChar,value:ownerToken}});return r.recordset?.[0]||{};}};
    const stubs={withAuth:handler=>handler,gateContract:lease.contract};
    const ctx={sql,pool,database:dbName,fixture,nativeCalc,audit,lease,stubs,invokeApiHandler:(handler,opts)=>new Promise((resolve,reject)=>{let settled=false;let statusCode=200;const finish=body=>{if(!settled){settled=true;resolve({statusCode,body});}};const res={status(code){statusCode=Number(code)||200;return this;},json:finish,send:finish,end:finish,setHeader(){return this;}};Promise.resolve(handler({method:opts.method||'POST',url:opts.url,body:opts.body,user:opts.user||{userId:'admin'},headers:{},query:{}},res)).then(value=>{if(!settled&&value!==undefined)finish(value);}).catch(reject);})};
    const adapterModule=await import(pathToFileURL(ADAPTER).href); const adapter=await (adapterModule.createAdapter||adapterModule.default?.createAdapter)(ctx); assert(adapter?.run,'adapter unavailable');
    const runCase=async({partial=false,existingNext=false,operationId='11111111-1111-4111-8111-111111111111'}={})=>{
      await fixture.reset({partial,existingNext});
      if(partial) await fixture.query(`UPDATE ShipmentDate SET Cost=601 WHERE SdateKey=@dk`,{dk:{type:sql.Int,value:SOURCE_DATE}});
      const previewBody={...bodyBase({partial}),overflowMode:'preview'};
      if(partial) previewBody.items[0].expectedOldCost=601;
      const beforePreview=JSON.stringify(await fixture.snapshot());
      const preview=await adapter.run({operation:'overflow-preview',body:previewBody}); const previewJson=assertResponse(preview,'overflow preview'); assert(previewJson.overflowPreview?.required===true,'preview must require overflow');
      assert(JSON.stringify(await fixture.snapshot())===beforePreview,'preview must not change ERP tables or audit results');
      const applyBody={...previewBody,overflowMode:'apply',overflowOperationId:operationId,overflowConfirmed:true,overflowPlanHash:previewJson.overflowPreview.planHash};
      const before=await fixture.snapshot();
      return {preview:previewJson,applyBody,before,apply:await adapter.run({operation:'overflow-apply',body:applyBody})};
    };

    let run=await runCase(); const after=await fixture.snapshot(); const applied=assertResponse(run.apply,'overflow apply'); assert(applied.overflowApplied===true,'apply must report overflowApplied'); assert(after.ShipmentDetail.some(row=>row.ShipmentKey===NEXT_MASTER&&row.ProdKey===PROD&&Number(row.OutQuantity)===10),'new next detail must be fixed with positive quantity'); assert(after.OrderDetail.some(row=>row.OrderDetailKey!==360001&&row.OrderDetailKey!==250001&&row.ProdKey===PROD&&Number(row.OutQuantity)===10), 'new next positive order must be present');
    assert(after.ShipmentDate.some(row=>row.SdateKey!==SOURCE_DATE&&row.SdetailKey!==SOURCE_DETAIL&&Number(row.ShipmentQuantity)===10),'new default next date must be created');
    assert(after.ShipmentDate.find(row=>row.SdateKey===SOURCE_DATE).ShipmentQuantity===40,'zero-current source date remains unchanged');
    assert(JSON.stringify(after.ShipmentDetail.find(r=>r.SdetailKey===SOURCE_DETAIL))===JSON.stringify(run.before.ShipmentDetail.find(r=>r.SdetailKey===SOURCE_DETAIL)), 'fully moved increase preserves original detail including money and fixed state');
    assert(JSON.stringify(after.ShipmentDate.filter(r=>r.SdetailKey===SOURCE_DETAIL))===JSON.stringify(run.before.ShipmentDate.filter(r=>r.SdetailKey===SOURCE_DETAIL)), 'fully moved increase preserves all original dates including price and money');
    assert(JSON.stringify(after.Estimate)===JSON.stringify(run.before.Estimate),'direct Estimate ledger must be preserved');
    assert(Number(after.Product.find(r=>r.ProdKey===PROD).Stock)===90,'global current stock consumes exactly ten once');
    assert(Number(after.ProductStock.find(r=>r.StockKey===3602&&r.ProdKey===PROD).Stock)===0,'native next-week stock becomes exactly zero');
    assert(after.SystemActionLog.filter(r=>r.ActionType==='ESTIMATE_OVERFLOW_APPLY').length===1,'one atomic result audit must be recorded');
    assertPriorSentinel(run.before,after);
    const replayBefore=JSON.stringify(after); const replay=await adapter.run({operation:'overflow-replay',body:run.applyBody}); const replayJson=assertResponse(replay,'overflow replay'); assert(replayJson.overflowReplayed===true,'same UUID must replay saved result'); assert(JSON.stringify(await fixture.snapshot())===replayBefore,'UUID replay must not write again');

    run=await runCase({partial:true,operationId:'22222222-2222-4222-8222-222222222222'}); const partialAfter=await fixture.snapshot(); assert(partialAfter.ShipmentDetail.some(row=>row.SdetailKey===SOURCE_DETAIL&&Number(row.OutQuantity)===50),'partial source receives only current capacity'); assert(partialAfter.ShipmentDetail.some(row=>row.ShipmentKey===NEXT_MASTER&&Number(row.OutQuantity)===6),'partial source carries only six to next week');
    assert(Number(partialAfter.ShipmentDate.find(r=>r.SdateKey===SOURCE_DATE).Cost)===601,'partial split must preserve the source date-specific price');

    await fixture.reset(); const beforeFail=await fixture.snapshot(); const previewFail=await adapter.run({operation:'overflow-preview',body:{...bodyBase(),overflowMode:'preview'}}); const previewFailBody=assertResponse(previewFail,'failure preview'); const failBody={...bodyBase(),overflowMode:'apply',overflowOperationId:'33333333-3333-4333-8333-333333333333',overflowConfirmed:true,overflowPlanHash:previewFailBody.overflowPreview.planHash}; await fixture.setNativeCalcFailure(); const failed=await adapter.run({operation:'overflow-failed-apply',body:failBody}); assert(Number(failed.statusCode)>=400,'native failure must fail apply'); assert(failed.body?.rolledBack===true,`native failure must report rollback: ${JSON.stringify(failed)}`); assert(JSON.stringify(await fixture.snapshot())===JSON.stringify(beforeFail),'native failure must roll back all rows');

    await fixture.reset({existingNext:true}); const existingPreview=await adapter.run({operation:'existing-next-preview',body:{...bodyBase(),overflowMode:'preview',items:[{sdateKey:SOURCE_DATE,quantity:450,unit:'송이',expectedOldQuantity:400,expectedOldCost:700,expectedOldDescr:'fixture date'}]}}); const existingPreviewBody=assertResponse(existingPreview,'existing target preview'); const existingApply={...bodyBase(),overflowMode:'apply',overflowOperationId:'44444444-4444-4444-8444-444444444444',overflowConfirmed:true,overflowPlanHash:existingPreviewBody.overflowPreview.planHash,items:[{sdateKey:SOURCE_DATE,quantity:450,unit:'송이',expectedOldQuantity:400,expectedOldCost:700,expectedOldDescr:'fixture date'}]}; assertResponse(await adapter.run({operation:'existing-next-apply',body:existingApply}),'existing target apply'); const existingAfter=await fixture.snapshot(); assert(existingAfter.ShipmentDate.some(row=>row.SdateKey===360202&&Number(row.ShipmentQuantity)===3),'other next date must remain unchanged'); assert(existingAfter.OrderDetail.some(row=>row.OrderDetailKey===360002&&Number(row.OutQuantity)===5),'existing next order must remain unchanged');
    console.log(`PASS: overflow SQL fixture (image=${container.image}, nativeBackupSha256=${native.digest})`);
    if (args.keepDb) console.log(`KEEP_DB: ${dbName}`);
    else await query(master, `ALTER DATABASE ${bracket(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${bracket(dbName)}`);
  } catch (error) {
    console.error(error.message);
    if (master) await query(master, `IF DB_ID(N'${dbName.replace(/'/g,"''")}') IS NOT NULL BEGIN ALTER DATABASE ${bracket(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${bracket(dbName)}; END`).catch(() => {});
    process.exitCode=1;
  } finally { await pool?.close().catch(()=>{}); await master?.close().catch(()=>{}); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
