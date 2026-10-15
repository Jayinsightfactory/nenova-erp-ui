'use strict';
// Dedicated loopback fixture only. The native business body is a sentinel;
// fixture-only metadata adaptation isolates real SQL locking/transaction tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {fork}=require('node:child_process'),sql=require('mssql');
const {inspectFixture}=require('./test-weekday-distribution-sql.cjs');
const core=require('../lib/pendingStockRecovery.cjs');
const {patch,business}=require('./native-stock-gate-atomic.cjs');
function guard(c){assert.equal(c.server,'127.0.0.1');assert.equal(c.port,14339);assert(/^NenovaPendingFixture_[a-f0-9]{8}$/.test(c.database));}
async function run(pool){
 const tx=new sql.Transaction(pool);let rolled=false;tx.on('rollback',()=>{rolled=true;});await tx.begin();
 const raw=async(text,params={})=>{const r=new sql.Request(tx);for(const [k,p]of Object.entries(params))r.input(k,p.type,p.value);return r.query(text);};
 try{
  await raw('SET XACT_ABORT ON; SET LOCK_TIMEOUT 1000;');
  const hash=(await raw("SELECT LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID('dbo.usp_StockCalculation'))),2)) hash")).recordset[0].hash;
  const tQuery=async(text,params)=>{
   // Only this isolated test replaces the native metadata expectation.
   if(params?.expectedCalcSha256)params={...params,expectedCalcSha256:{...params.expectedCalcSha256,value:hash}};
   const result=await raw(text,params);
   if(text.includes('AS CalcSha256'))result.recordsets[2][0].CalcSha256=core.EXPECTED_CALC_SHA256;
   return result;
  };
  const result=await core.recoverPendingStock({tQuery,types:sql,minPendingAgeSeconds:0,onCandidate:()=>{process.send?.({ready:true});return true;}});
  await tx.commit();return result;
 }catch(e){if(!rolled)try{await tx.rollback();}catch{}throw e;}
}
async function main(){
 for(const key of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'])assert(!process.env[key],'Operational environment forbidden');
 const approved=inspectFixture();const database='NenovaPendingFixture_'+crypto.randomBytes(4).toString('hex');
 const config={server:'127.0.0.1',port:14339,database,user:'sa',password:approved.password,options:{encrypt:false,trustServerCertificate:true},requestTimeout:15000,pool:{max:3,min:0}};guard(config);
 const master=await new sql.ConnectionPool({...config,database:'master'}).connect();let pool,created=false;
 try{
  assert.equal((await master.request().input('name',sql.NVarChar,database).query('SELECT DB_ID(@name) id')).recordset[0].id,null);
  await master.request().query(`CREATE DATABASE [${database}]`);created=true;pool=await new sql.ConnectionPool(config).connect();
  await pool.request().batch(`CREATE TABLE dbo.NenovaStockWeekGate(GateKey nvarchar(1) PRIMARY KEY,Mode nvarchar(20),LockedAt datetime,Action nvarchar(20),OrderYear nvarchar(20),OrderWeek nvarchar(20),OwnerSessionID int,OwnerToken uniqueidentifier,PendingCalc bit NOT NULL,CalcProdKey int,ProtocolVersion int NOT NULL);
INSERT dbo.NenovaStockWeekGate(GateKey,PendingCalc,ProtocolVersion) VALUES('1',0,2);
CREATE TABLE dbo.RecoverySentinel(Year nvarchar(20),Week nvarchar(20));CREATE TABLE dbo.RecoveryControl(Mode nvarchar(20));INSERT dbo.RecoveryControl VALUES('ok');`);
  const defs=JSON.parse(fs.readFileSync('__tests__/fixtures/native-stock-gate-2026-10-12.json','utf8').replace(/^\uFEFF/,''));
  for(const name of ['usp_NenovaStockWeekGateEnter','usp_NenovaStockWeekGateLeave'])await pool.request().batch(defs.find(d=>d.name===name).definition);
  await pool.request().batch('CREATE PROCEDURE dbo.usp_NenovaStockWeekGateCapability AS SELECT 2 ProtocolVersion,CONVERT(bit,1) IsReady;');
  const patched=patch(defs.find(d=>d.name==='usp_StockCalculation').definition).definition;
  await pool.request().batch(patched.replace(business(patched),`INSERT dbo.RecoverySentinel VALUES(@OrderYear,@OrderWeek);
IF EXISTS(SELECT 1 FROM RecoveryControl WHERE Mode='error') THROW 51001,'fixture error',1;
IF EXISTS(SELECT 1 FROM RecoveryControl WHERE Mode='slow') WAITFOR DELAY '00:00:02';
IF EXISTS(SELECT 1 FROM RecoveryControl WHERE Mode='wait') WAITFOR DELAY '00:00:10';`));
  const seed=async(mode='WAIT_CALC',year='2026',week='40-02')=>{
   await pool.request().input('mode',sql.NVarChar,mode).input('year',sql.NVarChar,year).input('week',sql.NVarChar,week).query(`DELETE RecoverySentinel;UPDATE RecoveryControl SET Mode='ok';UPDATE NenovaStockWeekGate SET Mode=@mode,Action='FIX',LockedAt=DATEADD(MINUTE,-2,GETDATE()),OrderYear=@year,OrderWeek=@week,OwnerSessionID=99,OwnerToken=NEWID(),PendingCalc=1,CalcProdKey=NULL;`);
   return (await pool.request().query('SELECT * FROM NenovaStockWeekGate')).recordset[0];
  };
  await seed();assert.equal((await run(pool)).status,'recovered');assert.deepEqual((await pool.request().query('SELECT * FROM RecoverySentinel')).recordset,[{Year:'2026',Week:'40-02'}]);assert.equal((await run(pool)).status,'skipped');
  await seed('RUN');assert.equal((await run(pool)).code,'PENDING_STOCK_ACTIVE_RUN');assert.equal((await pool.request().query('SELECT COUNT(*) n FROM RecoverySentinel')).recordset[0].n,0);
  await seed('WAIT_CALC','2025');await assert.rejects(run(pool),{code:'PENDING_STOCK_GATE_INVALID'});
  await seed('WAIT_CALC','2026','41-02');await run(pool);assert.equal((await pool.request().query('SELECT Week FROM RecoverySentinel')).recordset[0].Week,'41-02');
  const before=await seed();await pool.request().query("UPDATE RecoveryControl SET Mode='error'");await assert.rejects(run(pool));assert.deepEqual((await pool.request().query('SELECT * FROM NenovaStockWeekGate')).recordset[0],before);assert.equal((await pool.request().query('SELECT COUNT(*) n FROM RecoverySentinel')).recordset[0].n,0);
  await seed();await pool.request().query("UPDATE RecoveryControl SET Mode='slow'");const first=run(pool);await new Promise(r=>setTimeout(r,200));const second=await run(pool);assert.equal(second.code,'PENDING_STOCK_GATE_LOCKED');assert.equal((await first).status,'recovered');assert.equal((await pool.request().query('SELECT COUNT(*) n FROM RecoverySentinel')).recordset[0].n,1);
  const pending=await seed();await pool.request().query("UPDATE RecoveryControl SET Mode='wait'");
  const child=fork(__filename,['--child'],{windowsHide:true,stdio:['pipe','ignore','inherit','ipc']});child.stdin.end(JSON.stringify(config));
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});await new Promise(r=>setTimeout(r,250));
  const closed=new Promise(r=>child.once('close',r));child.kill('SIGKILL');await closed;
  assert.deepEqual((await pool.request().query('SELECT * FROM NenovaStockWeekGate')).recordset[0],pending);assert.equal((await pool.request().query('SELECT COUNT(*) n FROM RecoverySentinel')).recordset[0].n,0);
  await pool.request().query("UPDATE RecoveryControl SET Mode='ok'");assert.equal((await run(pool)).status,'recovered');
  console.log('Real SQL PASS: WAIT_CALC recovery, IDLE/RUN preservation, cross-year denial, exact pending week, failure rollback, concurrency, process termination rollback then recovery. Native business body is a sentinel.');
 }finally{if(pool)await pool.close();if(created){await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);}await master.close();}
}
if(process.argv.includes('--child')){const config=JSON.parse(fs.readFileSync(0,'utf8'));guard(config);new sql.ConnectionPool(config).connect().then(async p=>{await run(p);await p.close();process.exit(0);}).catch(()=>process.exit(1));}
else main().catch(e=>{console.error(e);process.exitCode=1;});
