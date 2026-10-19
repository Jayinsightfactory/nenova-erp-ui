// Only the existing isolated Docker fixture; never reads application environment files.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto'),sql=require('mssql');
const CONTAINER='nenova-estimate-sql-test-20260826';
const info=JSON.parse(execFileSync('docker',['inspect',CONTAINER],{encoding:'utf8',windowsHide:true}))[0];
assert.equal(info.Name,`/${CONTAINER}`);assert.equal(info.State.Running,true);assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022/);
assert.equal(info.Mounts.length,0);assert.ok(info.HostConfig.PortBindings['1433/tcp'].some(p=>p.HostIp==='127.0.0.1'&&p.HostPort==='14339'));
const password=info.Config.Env.find(v=>v.startsWith('MSSQL_SA_PASSWORD=')).slice('MSSQL_SA_PASSWORD='.length);
const database=`NenovaProductFixture_${randomBytes(8).toString('hex')}`;
assert.match(database,/^NenovaProductFixture_[a-f0-9]{16}$/);
const config={server:'127.0.0.1',port:14339,user:'sa',password,options:{encrypt:false,trustServerCertificate:true},database:'master'};
(async()=>{
  const master=await new sql.ConnectionPool(config).connect();let pool;
  try{
    await master.request().query(`CREATE DATABASE [${database}]`);
    pool=await new sql.ConnectionPool({...config,database}).connect();
    await pool.request().query(`CREATE TABLE Product (ProdKey int PRIMARY KEY,ProdName nvarchar(100),BunchOf1Box float,SteamOf1Bunch float,SteamOf1Box float,BoxWeight decimal(10,3),BoxCBM decimal(10,3),TariffRate decimal(10,4),Stock float,Cost float,OutUnit nvarchar(10),EstUnit nvarchar(10),CounName nvarchar(30),FlowerName nvarchar(30),isDeleted bit,LastUpdateID nvarchar(50),LastUpdateDtm datetime);
      CREATE TABLE SystemActionLog (Actor nvarchar(100),ActionType nvarchar(50),Method nvarchar(10),Endpoint nvarchar(300),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(1000),RiskLevel nvarchar(20));
      CREATE TABLE ProtectedLedger (OrderYear int,OrderWeek nvarchar(10),CustKey int,ProdKey int,OrderQty float,ShipmentQty float,WarehouseQty float,Stock float,Estimate float,WebProfitReport float);
      INSERT ProtectedLedger VALUES(2025,'42-01',1,1,10,10,20,10,100,100),(2026,'42-01',1,1,10,10,20,10,100,100);
      INSERT Product (ProdKey,ProdName,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,Cost,OutUnit,EstUnit,CounName,FlowerName,isDeleted) VALUES(1,'test 1',10,5,77,0.0000001,100,N'박스',N'단','NL','rose',0),(2,'test 2',10,5,50,20,100,N'박스',N'단','NL','rose',0);`);
    await pool.request().query(`CREATE TRIGGER ProductTinyStock ON Product AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF TRIGGER_NESTLEVEL()>1 OR NOT UPDATE(Stock) RETURN; UPDATE p SET Stock=0 FROM Product p JOIN inserted i ON i.ProdKey=p.ProdKey WHERE ABS(i.Stock)<0.000001; END`);
    const {saveProductBulk}=await import('../lib/productBulkSave.js');const {productSnapshot}=await import('../lib/productBulkEdit.js');
    const start=(await pool.request().query('SELECT * FROM Product ORDER BY ProdKey')).recordset;
    const sentinel=JSON.stringify((await pool.request().query('SELECT * FROM ProtectedLedger')).recordset);
    async function attempt(mode){
      const tx=new sql.Transaction(pool);await tx.begin();
      const before=JSON.stringify((await pool.request().query('SELECT * FROM Product ORDER BY ProdKey')).recordset);
      const q=async(text,params={})=>{if(mode==='audit'&&text.startsWith('INSERT INTO SystemActionLog'))throw Error('fixture audit failure');const r=new sql.Request(tx);Object.entries(params).forEach(([k,v])=>r.input(k,v.type,v.value));return r.query(text);};
      try{
        const changes=start.map(r=>({prodKey:r.ProdKey,expected:productSnapshot(r),values:{BoxWeight:0.125,BoxCBM:0.007,TariffRate:0}}));
        if(mode==='stale')changes[1].expected.SteamOf1Bunch=999;
        await saveProductBulk(q,sql,changes,'fixture');
        assert.equal(mode,'ok');await tx.commit();
      }catch(e){await tx.rollback();if(mode==='ok')throw e;assert.equal(JSON.stringify((await pool.request().query('SELECT * FROM Product ORDER BY ProdKey')).recordset),before);}
      assert.equal(JSON.stringify((await pool.request().query('SELECT * FROM ProtectedLedger')).recordset),sentinel);
    }
    await attempt('stale');await attempt('audit');await attempt('ok');
    let rows=(await pool.request().query('SELECT * FROM Product ORDER BY ProdKey')).recordset;
    assert.equal(rows[0].BoxWeight,0.125);assert.equal(rows[0].BoxCBM,0.007);assert.equal(rows[0].TariffRate,0);assert.equal(rows[0].SteamOf1Box,77);assert.equal(rows[0].Stock,0.0000001);
    const tx=new sql.Transaction(pool);await tx.begin();const q=async(text,params={})=>{const r=new sql.Request(tx);Object.entries(params).forEach(([k,v])=>r.input(k,v.type,v.value));return r.query(text);};
    await saveProductBulk(q,sql,[{prodKey:1,expected:productSnapshot(rows[0]),values:{BunchOf1Box:12.5}}],'fixture');await tx.commit();
    rows=(await pool.request().query('SELECT * FROM Product ORDER BY ProdKey')).recordset;assert.equal(rows[0].SteamOf1Box,62.5);assert.equal(rows[1].SteamOf1Box,50);
    const logs=(await pool.request().query('SELECT Payload FROM SystemActionLog')).recordset;assert.equal(logs.length,2);assert.equal(JSON.parse(logs[1].Payload).changes[0].after.SteamOf1Box,62.5);
    const {appendProductInputHistory}=await import('../lib/productInputHistory.js');
    const {previewInvoiceWithAudit}=await import('../lib/invoiceValidationAudit.js');
    const withTx=async fn=>{const t=new sql.Transaction(pool);await t.begin();const query=async(s,p={})=>{const r=new sql.Request(t);Object.entries(p).forEach(([k,v])=>r.input(k,v.type,v.value));return r.query(s);};try{const out=await fn(query);await t.commit();return out;}catch(e){await t.rollback();throw e;}};
    await withTx(q=>appendProductInputHistory(q,sql,'fixture',rows[0],{...rows[0],BoxCBM:0}));
    const inputLog=(await pool.request().query("SELECT Payload FROM SystemActionLog WHERE ActionType='PRODUCT_INPUT_EDIT'")).recordset[0];assert.equal(JSON.parse(inputLog.Payload).changes[0].after.BoxCBM,0);
    await pool.request().query(`CREATE TABLE WebInvoiceDocument(DocumentId uniqueidentifier PRIMARY KEY); CREATE TABLE WebInvoiceHistory(DocumentId uniqueidentifier,Revision int,OperationId uniqueidentifier,Action nvarchar(60),BeforeJson nvarchar(max),AfterJson nvarchar(max),Reason nvarchar(max),Actor nvarchar(200),CreatedAt datetime2); INSERT WebInvoiceDocument VALUES('11111111-1111-4111-8111-111111111111');`);
    const audit=await previewInvoiceWithAudit({withTransactionFn:withTx,types:sql,documentId:'11111111-1111-4111-8111-111111111111',revision:1,actor:'fixture',previewFn:async()=>({canCommit:false,issues:[{code:'PRODUCT_REQUIRED',message:'품목 지정 필요',lineNo:2}]})});assert.equal(audit.validationLogSaved,true);
    const event=JSON.parse((await pool.request().query('SELECT AfterJson FROM WebInvoiceHistory')).recordset[0].AfterJson);assert.equal(event.issues[0].lineNo,2);
    assert.equal(JSON.stringify((await pool.request().query('SELECT * FROM ProtectedLedger')).recordset),sentinel);
    console.log('Isolated MSSQL: product input history and invoice issue history persist/readback PASS');
    console.log('Isolated MSSQL: persisted/readback decimal/zero/derived, stale/audit rollback, native trigger Stock preservation, cross-year sentinel PASS');
  }finally{if(pool)await pool.close();await master.request().query(`DROP DATABASE [${database}]`);await master.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
