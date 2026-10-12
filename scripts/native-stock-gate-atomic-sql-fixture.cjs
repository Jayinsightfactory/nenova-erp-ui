// Explicit isolated orchestration fixture. No application DB/env modules.
// stdin: {fixtureOnly:true,server:'127.0.0.1',port:14339,database:'NenovaNativeStockAtomicFixture',user,password}
const fs=require('node:fs'),assert=require('node:assert/strict'),sql=require('mssql');
const {patch,business}=require('./native-stock-gate-atomic.cjs');
async function main(){
 const input=JSON.parse(fs.readFileSync(0,'utf8'));
 if(input.fixtureOnly!==true||input.server!=='127.0.0.1'||input.port!==14339||input.database!=='NenovaNativeStockAtomicFixture')throw Error('Dedicated loopback fixture only');
 const config={server:input.server,port:input.port,database:input.database,user:input.user,password:input.password,options:{encrypt:false,trustServerCertificate:true},pool:{max:1,min:0},requestTimeout:15000};
 const control=await new sql.ConnectionPool(config).connect(),worker=await new sql.ConnectionPool(config).connect();
 try{
  assert.equal((await control.request().query('SELECT DB_NAME() name')).recordset[0].name,input.database);
  await control.request().batch(`IF OBJECT_ID('dbo.usp_StockCalculation') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation;
IF OBJECT_ID('dbo.usp_NenovaStockWeekGateEnter') IS NOT NULL DROP PROCEDURE dbo.usp_NenovaStockWeekGateEnter;
IF OBJECT_ID('dbo.usp_NenovaStockWeekGateLeave') IS NOT NULL DROP PROCEDURE dbo.usp_NenovaStockWeekGateLeave;
IF OBJECT_ID('dbo.NativeAtomicSentinel') IS NOT NULL DROP TABLE dbo.NativeAtomicSentinel;
IF OBJECT_ID('dbo.NenovaStockWeekGate') IS NOT NULL DROP TABLE dbo.NenovaStockWeekGate;
CREATE TABLE dbo.NenovaStockWeekGate(GateKey nvarchar(1) PRIMARY KEY,Mode nvarchar(20),LockedAt datetime,Action nvarchar(20),OrderYear nvarchar(20),OrderWeek nvarchar(20),OwnerSessionID int,OwnerToken uniqueidentifier,PendingCalc bit NOT NULL,CalcProdKey int,ProtocolVersion int NOT NULL);
INSERT dbo.NenovaStockWeekGate(GateKey,PendingCalc,ProtocolVersion) VALUES('1',0,2);
CREATE TABLE dbo.NativeAtomicSentinel(Value int);`);
  const defs=JSON.parse(fs.readFileSync('__tests__/fixtures/native-stock-gate-2026-10-12.json','utf8').replace(/^\uFEFF/,''));
  for(const name of ['usp_NenovaStockWeekGateEnter','usp_NenovaStockWeekGateLeave'])await control.request().batch(defs.find(r=>r.name===name).definition);
  const transformed=patch(defs.find(r=>r.name==='usp_StockCalculation').definition).definition;
  // Preserve patched orchestration; replace stock SQL with an explicit sentinel.
  const fixture=transformed.replace(business(transformed),`INSERT dbo.NativeAtomicSentinel VALUES(1);
IF @iUserID=N'error' THROW 51000,'fixture business failure',1;
IF @iUserID=N'wait' WAITFOR DELAY '00:00:08';`);
  await control.request().batch(fixture);
  const run=(user='ok',year='2026',week='41-01')=>`DECLARE @r int,@m nvarchar(max),@rc int;EXEC @rc=dbo.usp_StockCalculation N'${year}',N'${week}',0,N'${user}',@r OUT,@m OUT;SELECT @r result,@rc returnCode,@@TRANCOUNT tc;`;
  const seed=async pending=>control.request().query(`DELETE dbo.NativeAtomicSentinel;UPDATE dbo.NenovaStockWeekGate SET Mode=${pending?"N'WAIT_CALC'":'NULL'},PendingCalc=${pending?1:0},Action=${pending?"N'CALC'":'NULL'},OrderYear=${pending?"N'2026'":'NULL'},OrderWeek=${pending?"N'41-01'":'NULL'},OwnerSessionID=${pending?'@@SPID':'NULL'},OwnerToken=${pending?'NEWID()':'NULL'},LockedAt=${pending?'GETDATE()':'NULL'},CalcProdKey=NULL;`);
  const check=async pending=>{const r=await control.request().query('SELECT Mode,PendingCalc FROM dbo.NenovaStockWeekGate;SELECT COUNT(*) n FROM dbo.NativeAtomicSentinel');assert.equal(r.recordsets[0][0].Mode,pending?'WAIT_CALC':null);assert.equal(r.recordsets[0][0].PendingCalc,!!pending);assert.equal(r.recordsets[1][0].n,0);};
  console.log('CHECK busy gate');
  await seed(false);await control.request().query("UPDATE dbo.NenovaStockWeekGate SET Mode=N'RUN',Action=N'CALC',OrderYear=N'2026',OrderWeek=N'41-01',OwnerSessionID=@@SPID,OwnerToken=NEWID(),LockedAt=GETDATE(),CalcProdKey=0;");
  let busy=await worker.request().query(run());assert.equal(busy.recordset[0].result,-99);assert.equal(busy.recordset[0].tc,0);assert.equal((await control.request().query('SELECT Mode FROM dbo.NenovaStockWeekGate')).recordset[0].Mode,'RUN');
  console.log('CHECK success');
  await seed(false);let r=await worker.request().query(run());assert.equal(r.recordset[0].result,0);assert.equal(r.recordset[0].tc,0);
  console.log('CHECK outer rollback');
  await seed(false);r=await worker.request().query('BEGIN TRANSACTION;'+run()+'ROLLBACK TRANSACTION;');assert.equal(r.recordset[0].tc,1);await check(false);
  console.log('CHECK invalid year');
  await seed(false);r=await worker.request().query(run('ok','2025'));assert.equal(r.recordset[0].result,-1);assert.equal(r.recordset[0].tc,0);await check(false);
  await seed(true);r=await worker.request().query(run('ok','2025'));assert.equal(r.recordset[0].tc,0);await check(true);
  for(const pending of [false,true]){
   console.log(`CHECK business error pending=${pending}`);
   await seed(pending);r=await worker.request().query(run('error'));assert.equal(r.recordset[0].result,-1);await check(pending);
   console.log(`CHECK attention pending=${pending}`);
   await seed(pending);const req=worker.request();const waiting=req.query(run('wait')).catch(e=>e);await new Promise(r=>setTimeout(r,400));req.cancel();await waiting;
   // Attention is NOT proof of rollback: explicitly dispose the live transaction.
   // mssql query uses sp_executesql: disposing an attention-left transaction
   // can report 266 for that wrapper (entry=1, exit=0). Verify actual cleanup.
   try {await worker.request().query('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;');}
   catch(error) {if(error.number!==266)throw error;}
   assert.equal((await worker.request().query('SELECT @@TRANCOUNT tc')).recordset[0].tc,0);
   await check(pending);
  }
  await seed(true);const spid=(await worker.request().query('SELECT @@SPID spid')).recordset[0].spid;
  assert(Number.isInteger(spid)&&spid>0);
  const req=worker.request();const waiting=req.query(run('wait')).catch(e=>e);await new Promise(r=>setTimeout(r,400));
  await control.request().query(`KILL ${spid};`);await waiting;await check(true);
  console.log('Isolated orchestration PASS: success, outer rollback, invalid year, business error, attention+rollback, physical disconnect. Native business SQL not executed.');
 }finally{await worker.close();await control.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
