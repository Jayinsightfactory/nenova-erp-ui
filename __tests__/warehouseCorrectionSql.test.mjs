import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import sql from 'mssql';
import {prepareWarehouseCorrection,commitWarehouseCorrection} from '../lib/warehouseCorrection.js';

test('isolated SQL: real native gate + CALC, replacement/rollback/idempotency/cross-year/protected ledgers',
  {skip:process.env.WAREHOUSE_CORRECTION_SQL!=='1'?'Run with WAREHOUSE_CORRECTION_SQL=1 on approved loopback fixture':false,timeout:120000},async()=>{
  // Never load .env or accept server/database/credential overrides.
  const container='nenova-estimate-sql-test-20260826';
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
  assert.equal(info.Name,`/${container}`);assert.equal(info.State.Running,true);assert.equal(info.Mounts.length,0);
  assert.match(info.Config.Image,/^mcr\.microsoft\.com\/mssql\/server:2022/);
  assert.deepEqual(info.HostConfig.PortBindings,{'1433/tcp':[{HostIp:'127.0.0.1',HostPort:'14339'}]});
  const password=info.Config.Env.find(s=>s.startsWith('MSSQL_SA_PASSWORD=')).slice('MSSQL_SA_PASSWORD='.length);
  const config={server:'127.0.0.1',port:14339,user:'sa',password,options:{encrypt:false,trustServerCertificate:true},requestTimeout:15000,pool:{min:0,max:4}};
  const name=`NenovaInvoiceFixture_correction_${randomBytes(8).toString('hex')}`;
  assert.match(name,/^NenovaInvoiceFixture_correction_[a-f0-9]{16}$/);
  const master=await new sql.ConnectionPool({...config,database:'master'}).connect();let pool,created=false;
  const qFor=executor=>async(statement,params={})=>{const r=new sql.Request(executor);for(const [key,p] of Object.entries(params))r.input(key,p.type,p.value);return r.query(statement);};
  try{
    assert.equal((await master.request().input('name',sql.NVarChar,name).query('SELECT DB_ID(@name) id')).recordset[0].id,null);
    await master.request().query(`CREATE DATABASE [${name}] COLLATE Korean_Wansung_CI_AS; ALTER DATABASE [${name}] SET COMPATIBILITY_LEVEL=130;`);created=true;
    pool=await new sql.ConnectionPool({...config,database:name}).connect();const q=qFor(pool);
    const batches=source=>source.split(/^\s*GO\s*;?\s*$/gim).filter(s=>s.trim());
    for(const batch of batches(fs.readFileSync(new URL('./fixtures/invoiceReceiptSchema.sql',import.meta.url),'utf8')))await pool.request().batch(batch);
    for(const batch of batches(fs.readFileSync(new URL('./fixtures/warehouseCorrectionNative.sql',import.meta.url),'utf8')))await pool.request().batch(batch);
    await q(`CREATE TABLE dbo.SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),SessionId nvarchar(200),ActionType nvarchar(50),Method nvarchar(10),Endpoint nvarchar(300),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(1000),RiskLevel nvarchar(20));
      CREATE TABLE dbo.FreightCost(FreightKey int IDENTITY PRIMARY KEY,WarehouseKey int,isDeleted bit);
      CREATE TABLE dbo.WebInvoiceOperation(WarehouseKey int,Status nvarchar(20));
      CREATE TABLE dbo.WebInvoiceCostRevision(WarehouseKey int);
      CREATE TABLE dbo.FreightCostDetail(WarehouseDetailKey int);
      CREATE TABLE dbo.WebArrivalCostLine(OrderYear nvarchar(4),OrderWeek nvarchar(20),IsCurrent bit,ProdKey int);
      CREATE TABLE dbo.WeekProdCost(OrderYear nvarchar(4),OrderWeek nvarchar(20),ProdKey int);
      CREATE TABLE dbo.WebProfitReportConfirm(OrderYear nvarchar(4),MajorWeek nvarchar(4),IsActive bit);
      CREATE TABLE dbo.ShipmentFarm(SfarmKey int IDENTITY,SdetailKey int,FarmKey int,ShipmentQuantity float);
      CREATE TABLE dbo.ShipmentDate(SdetailKey int,ShipmentQuantity float);
      CREATE TABLE dbo.Estimate(EstimateKey int,Amount float);
      CREATE TABLE dbo.WebProfitReport(OrderYear nvarchar(4),MajorWeek nvarchar(4),Value float);
      INSERT dbo.Farm(FarmKey,FarmName) VALUES(1,N'Farm A'),(2,N'Farm B');
      INSERT dbo.Product(ProdKey,ProdName,CountryFlower,OutUnit,EstUnit,Stock) VALUES(1,N'Flower A',N'TEST',N'단',N'송이',110),(2,N'Flower B',N'TEST',N'단',N'송이',100);
      INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek) VALUES(1,N'2025',N'44-01',N'20254401'),(2,N'2026',N'44-01',N'20264401'),(3,N'2027',N'01-01',N'20270101');
      INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(1,1,100),(1,2,100),(2,1,110),(2,2,100),(3,1,110),(3,2,100);
      INSERT dbo.CodeInfo(Category,Descr) VALUES(N'StockType',N'재고조정');
      INSERT dbo.WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,InputDate,isDeleted)
        VALUES(90,N'2026',N'44-01',N'Farm A',N'I-1',N'A-1','20261101',0),(89,N'2025',N'44-01',N'Farm A',N'OLD',N'OLD','20251101',0);
      INSERT dbo.WarehouseDetail(WarehouseKey,ProdKey,OrderCode,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch)
        VALUES(90,1,N'C',1,10,100,10,100,1,100,100,10),(89,1,N'OLD',1,99,990,99,990,1,990,990,10);
      INSERT dbo.Customer(CustKey,CustName) VALUES(1,N'fixture');
      INSERT dbo.ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey) VALUES(1,N'2026',N'44-01',N'202644',1);
      INSERT dbo.ShipmentDetail(SdetailKey,ShipmentKey,ProdKey,OutQuantity,Amount,Vat) VALUES(1,1,1,1,50,5);
      INSERT dbo.ShipmentDate VALUES(1,1); INSERT dbo.Estimate VALUES(1,500); INSERT dbo.WebProfitReport VALUES(N'2026',N'44',1000);`);
    const withTransactionFn=async fn=>{const tx=new sql.Transaction(pool);await tx.begin();try{const value=await fn(qFor(tx));await tx.commit();return value;}catch(e){await tx.rollback().catch(()=>{});throw e;}};
    const input={warehouseKey:90,orderYear:'2026',orderWeek:'44-01',mode:'REPLACE',farmName:'Farm A',fileName:'fixed.xlsx',fileMeta:{},items:[{prodName:'Flower B',orderCode:'C',boxQty:1,bunchQty:10,steamQty:100,steamOf1Box:100,steamOf1Bunch:10,unitPrice:1,totalPrice:100}]};
    const preview=i=>prepareWarehouseCorrection({queryFn:q,types:sql,input:i});
    const approve=async i=>({...i,baselineDigest:(await preview(i)).baselineDigest,operationId:randomUUID(),reason:'fixture correction',confirmed:true});
    const commit=i=>commitWarehouseCorrection({withTransactionFn,types:sql,input:i,actor:'fixture'});
    const snapshot=async()=>JSON.stringify((await q(`SELECT * FROM dbo.OrderMaster;SELECT * FROM dbo.OrderDetail;SELECT * FROM dbo.ShipmentMaster;SELECT * FROM dbo.ShipmentDetail;SELECT * FROM dbo.ShipmentDate;SELECT * FROM dbo.ShipmentFarm;SELECT * FROM dbo.Estimate;SELECT * FROM dbo.WebProfitReport;SELECT * FROM dbo.WarehouseMaster WHERE WarehouseKey=89;SELECT * FROM dbo.WarehouseDetail WHERE WarehouseKey=89;SELECT * FROM dbo.ProductStock WHERE StockKey=1;`)).recordsets);
    const protectedBefore=await snapshot();
    const approved=await approve(input);const results=await Promise.all([commit(approved),commit(approved)]);assert.equal(results.filter(r=>r.replayed).length,1);
    assert.deepEqual((await q('SELECT Stock FROM dbo.Product ORDER BY ProdKey')).recordset.map(r=>r.Stock),[100,110]);
    assert.deepEqual((await q('SELECT Stock FROM dbo.ProductStock WHERE StockKey=3 ORDER BY ProdKey')).recordset.map(r=>r.Stock),[100,110]);
    assert.equal((await q('SELECT COUNT(*) n FROM dbo.SystemActionLog')).recordset[0].n,1);
    assert.equal(await snapshot(),protectedBefore);
    const farm={warehouseKey:90,orderYear:'2026',orderWeek:'44-01',mode:'FARM',farmName:'Farm B'};
    const detailsBefore=JSON.stringify((await q('SELECT * FROM dbo.WarehouseDetail WHERE WarehouseKey=90')).recordset);
    await commit(await approve(farm));assert.equal(JSON.stringify((await q('SELECT * FROM dbo.WarehouseDetail WHERE WarehouseKey=90')).recordset),detailsBefore);
    const back={...input,farmName:'Farm B',items:[{...input.items[0],prodName:'Flower A'}]};
    const all=async()=>JSON.stringify((await q('SELECT * FROM dbo.WarehouseMaster;SELECT * FROM dbo.WarehouseDetail;SELECT * FROM dbo.Product;SELECT * FROM dbo.ProductStock;SELECT * FROM dbo.StockHistory;SELECT * FROM dbo.SystemActionLog;SELECT * FROM dbo.NenovaStockWeekGate;')).recordsets);
    await q('UPDATE dbo.FixtureNativeCalcControl SET FailNext=1');const beforeFail=await all();await assert.rejects(()=>approve(back).then(commit));assert.equal(await all(),beforeFail);await q('UPDATE dbo.FixtureNativeCalcControl SET FailNext=0');
    // Future negative: manual adjustment only in this isolated fixture; prior-year remains untouched.
    await q(`INSERT dbo.StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeType,BeforeValue,AfterValue,ProdKey) VALUES(GETDATE(),N'2027',N'01-01',N'재고조정',0,-105,2)`);
    const beforeNegative=await all();await assert.rejects(()=>approve(back).then(commit),{code:'CORRECTION_NEGATIVE_STOCK'});assert.equal(await all(),beforeNegative);
    await q(`DELETE dbo.StockHistory WHERE OrderYear=N'2027'`);
    const stale=await approve(back);await q(`UPDATE dbo.WarehouseMaster SET InvoiceNo=N'changed' WHERE WarehouseKey=90`);await assert.rejects(()=>commit(stale),{code:'CORRECTION_STALE'});
    await q(`INSERT dbo.FreightCost(WarehouseKey,isDeleted) VALUES(90,0)`);assert.equal((await preview(back)).canCommit,false);
    await q(`DELETE dbo.FreightCost; UPDATE dbo.ShipmentDetail SET isFix=1 WHERE SdetailKey=1`);assert.equal((await preview(back)).canCommit,false);
    console.log('SQL PASS: A→B and future cascade, concurrent replay, farm preserves detail keys, native failure rollback, future-negative rollback, stale/linked/fixed blocked; protected ledgers and prior-year unchanged. Capability fixture is a stub; native gate/CALC are captured real definitions.');
  }finally{
    if(pool)await pool.close();
    if(created){assert.match(name,/^NenovaInvoiceFixture_correction_[a-f0-9]{16}$/);await master.request().query(`DROP DATABASE [${name}]`);}
    await master.close();
  }
});
