#!/usr/bin/env node
/* Adversarial sidecar for the real weekday-apply core on the approved loopback SQL fixture. */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const SCHEMA = path.join(ROOT, '__tests__', 'fixtures', 'estimateDirectionalSchema.sql');
const MIGRATION = path.join(ROOT, 'docs', 'migrations', '2026-10-01_weekday_distribution_audit.sql');
const NATIVE = path.join(ROOT, 'docs', 'migrations', 'backup_usp_StockCalculation_2026-08-23_before_stock_week_gate.sql');
const DB_RE = /^NenovaEstimateFixture_[0-9]{8}_[0-9a-f]{8}$/;

function fail(message) { throw new Error(`[weekday-adversarial-fixture] ${message}`); }
function batches(text) { return text.split(/^\s*GO\s*;?\s*$/gim).map((part) => part.trim()).filter(Boolean); }
function bracket(name) {
  if (!DB_RE.test(name)) fail('temporary database name guard failed');
  return `[${name}]`;
}
function inspectApprovedContainer() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved isolated SQL container is unavailable');
  const info = JSON.parse(result.stdout)[0];
  if (!info?.State?.Running || info.Name !== `/${CONTAINER}`) fail('container identity/running check failed');
  if (!/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || ''))) fail('SQL Server image check failed');
  if ((info.Mounts || []).length || (info.HostConfig?.Binds || []).length) fail('mounted SQL fixture is forbidden');
  const bindings = info.HostConfig?.PortBindings?.['1433/tcp'] || [];
  if (!bindings.some((row) => row.HostIp === HOST && Number(row.HostPort) === PORT)) fail('loopback port check failed');
  const entry = (info.Config?.Env || []).find((item) => String(item).startsWith('MSSQL_SA_PASSWORD='));
  if (!entry) fail('fixture-only SQL credential is unavailable');
  return entry.slice('MSSQL_SA_PASSWORD='.length);
}
function query(executor, statement, params = {}) {
  const request = new sql.Request(executor);
  request.timeout = 60000;
  for (const [key, value] of Object.entries(params)) request.input(key, value.type, value.value);
  return request.query(statement);
}
const tq = (tx) => (statement, params = {}) => query(tx, statement, params);

async function install(pool) {
  for (const batch of batches(fs.readFileSync(SCHEMA, 'utf8'))) await query(pool, batch);
  await query(pool, `
    ALTER TABLE dbo.Customer ADD Manager nvarchar(20) NULL,OrderCode nvarchar(50) NULL,BaseOutDay int NULL;
    ALTER TABLE dbo.ShipmentDetail ADD EstDescr nvarchar(1000) NULL;
    CREATE TABLE dbo.PeriodDay (PeriodDayKey int NOT NULL PRIMARY KEY,OrderYearWeek nvarchar(20) NOT NULL,BaseYmd datetime NOT NULL,WeekDay int NOT NULL);
    CREATE TABLE dbo.KeyNumbering (Category nvarchar(100) NOT NULL PRIMARY KEY,LastKeyNo int NOT NULL,Descr nvarchar(200) NULL);
  `);
  await query(pool, `CREATE VIEW dbo.ViewOrder AS
    SELECT om.OrderMasterKey,od.OrderDetailKey,om.OrderYear,om.OrderWeek,om.OrderYearWeek+RIGHT(om.OrderWeek,2) OrderYearWeek2,
      om.CustKey,od.ProdKey,od.OutQuantity FROM dbo.OrderMaster om JOIN dbo.OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
     WHERE ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0;`);
  for (const batch of batches(fs.readFileSync(MIGRATION, 'utf8'))) await query(pool, batch);
  const native = fs.readFileSync(NATIVE, 'utf8');
  const reference = native.replace(/CREATE\s+PROCEDURE\s+\[dbo\]\.\[usp_StockCalculation\]/i, 'CREATE PROCEDURE dbo.usp_StockCalculation_Reference');
  if (reference === native) fail('native reference procedure declaration was not found');
  await query(pool, `IF OBJECT_ID(N'dbo.usp_StockCalculation_Reference',N'P') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation_Reference;`);
  for (const batch of batches(reference)) await query(pool, batch);
}

async function seed(pool) {
  await query(pool, `
    INSERT dbo.UserInfo(UserID,UserName) VALUES(N'fixture-user',N'Fixture User');
    INSERT dbo.Customer(CustKey,CustName,Manager,OrderCode,BaseOutDay) VALUES(533,N'Fixture Cust',N'fixture-user',N'F533',4);
    INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
      VALUES(866,N'Fixture Carnation',N'Colombia Carnation',N'Fixture Country',N'Carnation',N'박스',N'단',30,1,30,2500.1234,0);
    INSERT dbo.OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager)
      VALUES(2501,N'2025',N'37-01',N'202537',533,N'fixture-user'),(3701,N'2026',N'37-01',N'202637',533,N'fixture-user'),
            (3702,N'2026',N'37-02',N'202637',533,N'fixture-user'),(3901,N'2026',N'39-01',N'202639',533,N'fixture-user'),
            (2701,N'2027',N'01-01',N'202701',533,N'fixture-user');
    INSERT dbo.OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,OrderQuantity)
      VALUES(2501,2501,533,866,7,210,210,7,7),(3701,3701,533,866,25,750,750,25,25),
            (3702,3702,533,866,5,150,150,5,5),(3901,3901,533,866,0,0,0,0,0),(2701,2701,533,866,5,150,150,5,5);
    INSERT dbo.ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
      VALUES(2501,N'2025',N'37-01',N'202537',533,1,0,1,N'fixture-user'),(6266,N'2026',N'37-01',N'202637',533,1,0,1,N'fixture-user'),
            (6267,N'2026',N'37-02',N'202637',533,1,0,1,N'fixture-user'),(6901,N'2026',N'39-01',N'202639',533,1,0,1,N'fixture-user'),
            (2701,N'2027',N'01-01',N'202701',533,1,0,1,N'fixture-user');
    INSERT dbo.ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
      VALUES(2501,2501,533,866,CONVERT(datetime,'2025-09-11 00:00:00.000',121),7,7,210,210,210,2500.1234,477273,47727,1,N'prior-year sentinel',N''),
            (89892,6266,533,866,CONVERT(datetime,'2026-09-10 00:00:00.000',121),25,25,750,750,750,2500.1234,1704636,170464,1,N'fixture detail',N''),
            (2701,2701,533,866,CONVERT(datetime,'2027-01-07 00:00:00.000',121),5,5,150,150,150,2500.1234,340926,34093,1,N'future fixture outbound',N'');
    INSERT dbo.ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(2501,2501,CONVERT(datetime,'2025-09-11 00:00:00.000',121),7,210,2500.1234,477273,47727,N'prior-year date sentinel'),
            (119701,89892,CONVERT(datetime,'2026-09-10 00:00:00.000',121),5,150,2500.1234,340926,34092.51,N'first'),
            (119700,89892,CONVERT(datetime,'2026-09-13 00:00:00.000',121),20,600,2500.1234,1363704,136370.04,N'legacy-preserve'),
            (2701,2701,CONVERT(datetime,'2027-01-07 00:00:00.000',121),5,150,2500.1234,340926,34092.51,N'future fixture date');
    INSERT dbo.ShipmentHistory(SdetailKey,ShipmentDtm,ChangeType,BeforeValue,AfterValue,Descr,ChangeID)
      VALUES(2501,CONVERT(datetime,'2025-09-11 00:00:00.000',121),N'신규',N'0',N'7',N'prior-year history sentinel',N'fixture-user');
    INSERT dbo.PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
      VALUES(1,N'202637',CONVERT(datetime,'2026-09-10 00:00:00.000',121),5),(2,N'202637',CONVERT(datetime,'2026-09-11 00:00:00.000',121),6),
            (3,N'202637',CONVERT(datetime,'2026-09-13 00:00:00.000',121),1),
            (4,N'202638',CONVERT(datetime,'2026-09-15 00:00:00.000',121),2),(5,N'202638',CONVERT(datetime,'2026-09-16 00:00:00.000',121),3),
            (6,N'202537',CONVERT(datetime,'2025-09-11 00:00:00.000',121),6),(7,N'202701',CONVERT(datetime,'2027-01-07 00:00:00.000',121),5);
    INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
      VALUES(2501,N'2025',N'37-01',N'20253701',1,N'fixture-user'),(3602,N'2026',N'36-02',N'20263602',1,N'fixture-user'),
            (3701,N'2026',N'37-01',N'20263701',1,N'fixture-user'),(3702,N'2026',N'37-02',N'20263702',1,N'fixture-user'),
            (3901,N'2026',N'39-01',N'20263901',1,N'fixture-user'),(2701,N'2027',N'01-01',N'20270101',1,N'fixture-user');
    INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(2501,866,11),(3602,866,40),(3701,866,15),(3702,866,10),(3901,866,10),(2701,866,0);
    IF NOT EXISTS(SELECT 1 FROM dbo.CodeInfo WHERE Category=N'StockType' AND Descr=N'재고조정') INSERT dbo.CodeInfo(Category,Descr) VALUES(N'StockType',N'재고조정');
    UPDATE dbo.FixtureNativeCalcControl SET FailNext=0,NullNext=0 WHERE ControlKey=1;
    UPDATE dbo.NenovaStockWeekGate SET Mode=NULL,PendingCalc=0,OwnerSessionID=NULL,OwnerToken=NULL,LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL,CalcProdKey=NULL WHERE GateKey='1';
    INSERT dbo.KeyNumbering(Category,LastKeyNo,Descr) VALUES(N'ShipmentDetailKey',89892,N''),(N'OrderMasterKey',3901,N''),(N'OrderDetailKey',3901,N'');
  `);
}

function dependencies(gate, presence) {
  return { assertGateCapability:gate.assertDirectionalGateCapability,lockGate:gate.lockDirectionalGate,
    acquireEditLease:presence.acquireErpEditLease,assertEditGuard:presence.assertErpEditGuard,
    advanceEditGuard:presence.advanceErpEditGuard,releaseEditLease:presence.releaseErpEditLease };
}
function change(week, dates, expected) { return { year:'2026',orderWeek:week,prodKey:866,unit:'박스',expected,dates }; }
function body(changes, reason='adversarial SQL fixture') { return { operationId:crypto.randomUUID(),reason,custKey:533,changes }; }

async function actualSnapshot(tQ, wk) {
  const base={year:'2026',orderWeek:wk,custKey:533,prodKey:866};
  const params={yr:{type:sql.NVarChar,value:base.year},wk:{type:sql.NVarChar,value:wk},ck:{type:sql.Int,value:base.custKey},pk:{type:sql.Int,value:base.prodKey}};
  const context=await tQ(`SELECT p.ProdKey,p.ProdName,p.CountryFlower,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box,p.Stock,
      c.CustKey,c.Manager,c.OrderCode,ISNULL(c.BaseOutDay,0) BaseOutDay FROM Product p CROSS JOIN Customer c
      WHERE p.ProdKey=@pk AND c.CustKey=@ck`,params);
  const masters=await tQ(`SELECT ShipmentKey,isFix MasterIsFix,OrderYearWeek FROM ShipmentMaster WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND ISNULL(isDeleted,0)=0 AND OrderYearWeek=@ywk`,
    {...params,ywk:{type:sql.NVarChar,value:`2026${wk.slice(0,2)}`}});
  assert.equal(masters.recordset.length,1,`single fixture master ${wk}`);
  const master=masters.recordset[0];
  const details=await tQ(`SELECT sd.SdetailKey,sd.ShipmentKey,sd.CustKey,sd.ProdKey,sd.ShipmentDtm,sd.OutQuantity,sd.BoxQuantity,sd.BunchQuantity,
      CONVERT(nvarchar(23),sd.ShipmentDtm,121) ShipmentTimestamp,
      sd.SteamQuantity,sd.EstQuantity,sd.Cost DetailCost,sd.Amount DetailAmount,sd.Vat DetailVat,sd.isFix DetailIsFix,
      ISNULL(sd.Descr,N'') DetailDescr,ISNULL(sd.EstDescr,N'') EstDescr FROM ShipmentDetail sd WHERE sd.ShipmentKey=@sk AND sd.ProdKey=@pk`,
    {...params,sk:{type:sql.Int,value:Number(master.ShipmentKey)}});
  const detail=details.recordset[0]||null;
  const dates=detail?await tQ(`SELECT d.SdateKey,d.SdetailKey,sd.ShipmentKey,CONVERT(nvarchar(10),d.ShipmentDtm,120) [Date],
      CONVERT(nvarchar(23),d.ShipmentDtm,121) [Timestamp],d.ShipmentQuantity,d.EstQuantity,d.Cost,d.Amount,d.Vat,ISNULL(d.Descr,N'') Descr
    FROM ShipmentDate d JOIN ShipmentDetail sd ON sd.SdetailKey=d.SdetailKey WHERE d.SdetailKey=@sdk ORDER BY d.SdateKey`,
    {sdk:{type:sql.Int,value:Number(detail.SdetailKey)}}):{recordset:[]};
  const shipmentDates=dates.recordset.map((d)=>({sdateKey:Number(d.SdateKey),sdetailKey:Number(d.SdetailKey),shipmentKey:Number(d.ShipmentKey),
    date:String(d.Date),timestamp:String(d.Timestamp),shipmentQuantity:Number(d.ShipmentQuantity),estimateQuantity:Number(d.EstQuantity),
    detailFixed:detail?.DetailIsFix===true||detail?.DetailIsFix===1,cost:d.Cost==null?null:Number(d.Cost),amount:d.Amount==null?null:Number(d.Amount),
    vat:d.Vat==null?null:Number(d.Vat),descr:String(d.Descr||'')}));
  const actual={detailRows:details.recordset.length,shipmentOutQuantity:detail?Number(detail.OutQuantity):null,shipmentDates,detail,master,product:context.recordset[0],customer:context.recordset[0]};
  return {change:base,expected:{detailRows:detail?1:0,shipmentOutQuantity:detail?Number(detail.OutQuantity):null,shipmentDates,
    snapshotDigest:(await import(pathToFileURL(path.join(ROOT,'lib','weekdayDistributionPolicy.js')).href)).weekdaySnapshotDigest(base,actual)}};
}
async function expected(tQ,wk) { return (await actualSnapshot(tQ,wk)).expected; }

async function fingerprint(pool) {
  const tables=[
    ['orders',`SELECT * FROM dbo.OrderMaster ORDER BY OrderMasterKey; SELECT * FROM dbo.OrderDetail ORDER BY OrderDetailKey`],
    ['shipments',`SELECT * FROM dbo.ShipmentMaster ORDER BY ShipmentKey; SELECT * FROM dbo.ShipmentDetail ORDER BY SdetailKey`],
    ['dates',`SELECT * FROM dbo.ShipmentDate ORDER BY SdateKey`],
    ['product',`SELECT ProdKey,Stock FROM dbo.Product ORDER BY ProdKey`],
    ['stock',`SELECT * FROM dbo.StockMaster ORDER BY StockKey; SELECT * FROM dbo.ProductStock ORDER BY StockKey,ProdKey; SELECT * FROM dbo.StockHistory ORDER BY StockHistoryKey`],
    ['shipmentHistory',`SELECT * FROM dbo.ShipmentHistory ORDER BY ShipmentHistoryKey`],
    ['audit',`SELECT * FROM dbo.WebWeekdayDistributionOperation ORDER BY UUID; SELECT * FROM dbo.WebWeekdayDistributionChange ORDER BY OperationFK,[Year],[Week],CustKey,ProdKey`],
  ];
  const out={};
  for(const [key,statement] of tables){const result=await query(pool,statement);out[key]=result.recordsets.map((set)=>set.map((r)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?v.toISOString():v]))));}
  return JSON.stringify(out);
}
async function commitScenario(pool,fn){const tx=new sql.Transaction(pool);await tx.begin();try{const value=await fn(tq(tx));await tx.commit();return value;}catch(error){await tx.rollback().catch(()=>{});throw error;}}
async function rollbackScenario(pool,fn){
  const tx=new sql.Transaction(pool);await tx.begin();
  try{return await fn(tq(tx));}finally{await tx.rollback().catch(()=>{});}
}
async function failedAndRolledBack(pool,fn,expectedCode){const before=await fingerprint(pool);let caught;let value;try{value=await rollbackScenario(pool,fn);}catch(e){caught=e;}assert.ok(caught,'expected operation failure');if(expectedCode)assert.equal(caught.code,expectedCode);assert.equal(await fingerprint(pool),before,'business rows, StockHistory, ShipmentHistory, and audit must all rollback');return caught;}
async function priorYearSnapshot(executor){
  const statements=[
    `SELECT OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager FROM OrderMaster WHERE OrderYear=N'2025' AND OrderWeek=N'37-01' ORDER BY OrderMasterKey`,
    `SELECT od.* FROM OrderDetail od JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey WHERE om.OrderYear=N'2025' AND om.OrderWeek=N'37-01' ORDER BY od.OrderDetailKey`,
    `SELECT * FROM ShipmentMaster WHERE OrderYear=N'2025' AND OrderWeek=N'37-01' ORDER BY ShipmentKey`,
    `SELECT sd.* FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=N'2025' AND sm.OrderWeek=N'37-01' ORDER BY sd.SdetailKey`,
    `SELECT d.* FROM ShipmentDate d JOIN ShipmentDetail sd ON sd.SdetailKey=d.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=N'2025' AND sm.OrderWeek=N'37-01' ORDER BY d.SdateKey`,
    `SELECT h.* FROM ShipmentHistory h JOIN ShipmentDetail sd ON sd.SdetailKey=h.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=N'2025' AND sm.OrderWeek=N'37-01' ORDER BY h.ShipmentHistoryKey`,
  ];
  const rows=[];for(const statement of statements)rows.push((await (typeof executor==='function'?executor(statement):query(executor,statement))).recordset);
  return JSON.stringify(rows.map((set)=>set.map((row)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])))));
}

async function seedAlternateDirection(tQ){
  await tQ(`UPDATE dbo.ShipmentDetail SET OutQuantity=20,BoxQuantity=20,BunchQuantity=600,SteamQuantity=600,EstQuantity=600,Amount=1363704,Vat=136370 WHERE SdetailKey=89892;
    DELETE dbo.ShipmentDate WHERE SdetailKey=89892;
    INSERT dbo.ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(119700,89892,CONVERT(datetime,'2026-09-13 00:00:00.000',121),20,600,2500.1234,1363704,136370.04,N'legacy-preserve');
    INSERT dbo.ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
      VALUES(89893,6267,533,866,CONVERT(datetime,'2026-09-15 00:00:00.000',121),5,5,150,150,150,2500.1234,340926,34093,1,N'reverse source',N'');
    INSERT dbo.ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(119702,89893,CONVERT(datetime,'2026-09-15 00:00:00.000',121),5,150,2500.1234,340926,34092.51,N'reverse source date');`);
}

async function run(pool,core,gate,presence){
  const user={userId:'fixture-user',userName:'Fixture User'};const deps=dependencies(gate,presence);
  console.log('CASE: cross-year same-total transfer');
  const prior=await priorYearSnapshot(pool);
  for (const flag of ['0','NULL']) {
    console.log(`CASE: ${flag} unfixed detail cannot save or auto-confirm`);
    await failedAndRolledBack(pool,async(tQ)=>{
      if (flag==='NULL') await tQ(`ALTER TABLE ShipmentDetail ALTER COLUMN isFix bit NULL`);
      await tQ(`UPDATE ShipmentDetail SET isFix=${flag} WHERE SdetailKey=89892`);
      const a=await expected(tQ,'37-01');
      return core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:4}],a)]),user,deps);
    },'ERP_CONFIRMATION_REQUIRED');
  }
  console.log('CASE: representative-only concurrent change rejects stale snapshot');
  await failedAndRolledBack(pool,async(tQ)=>{
    const a=await expected(tQ,'37-01');
    await tQ(`UPDATE ShipmentDetail SET ShipmentDtm=CONVERT(datetime,'2026-09-13 00:00:00.000',121) WHERE SdetailKey=89892`);
    return core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:4}],a)]),user,deps);
  },'STALE_SNAPSHOT');
  console.log('CASE: confirmation changed since read rejects stale snapshot');
  await failedAndRolledBack(pool,async(tQ)=>{
    const a=await expected(tQ,'37-01');
    await tQ(`UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey=89892`);
    return core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:4}],a)]),user,deps);
  },'STALE_SNAPSHOT');
  console.log('CASE: representative readback mismatch rolls back quantities and history');
  await failedAndRolledBack(pool,async(tQ)=>{
    const a=await expected(tQ,'37-01');
    await tQ(`CREATE TRIGGER dbo.FixtureWrongRepresentative ON dbo.ShipmentDetail AFTER UPDATE AS
      BEGIN
        IF TRIGGER_NESTLEVEL()>1 RETURN;
        UPDATE d SET ShipmentDtm=CONVERT(datetime,'2026-09-13 00:00:00.000',121)
        FROM dbo.ShipmentDetail d JOIN inserted i ON i.SdetailKey=d.SdetailKey;
      END`);
    return core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],a)]),user,deps);
  },'WEEKDAY_VERIFY_FAILED');
  console.log('CASE: fixed detail preserves mixed master flag');
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=6266`);
    const a=await expected(tQ,'37-01');
    await core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],a)]),user,deps);
    assert.equal((await tQ(`SELECT isFix FROM ShipmentMaster WHERE ShipmentKey=6266`)).recordset[0].isFix,false);
    assert.equal((await tQ(`SELECT isFix FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0].isFix,true);
  });
  console.log('CASE: cross-year same-total transfer');
  await rollbackScenario(pool,async(tQ)=>{
    const a=await expected(tQ,'37-01'),b=await expected(tQ,'37-02');
    const request=body([change('37-01',[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5},{date:'2026-09-13',quantity:15}],a),
      change('37-02',[{date:'2026-09-15',quantity:5}],b)],'same-total cross-week directional stock transfer');
    await core.executeWeekdayDistributionApply(tQ,sql,request,user,deps);
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock),0,'fixed stock transfer 37-01 to 37-02 nets to zero');
    const old=await tQ(`SELECT om.OrderMasterKey,od.OrderDetailKey,od.OutQuantity,sd.SdetailKey,sd.OutQuantity ShipmentOut,d.ShipmentQuantity,h.ShipmentHistoryKey
      FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey JOIN ShipmentMaster sm ON sm.OrderYear=om.OrderYear AND sm.OrderWeek=om.OrderWeek AND sm.CustKey=om.CustKey
      LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=od.ProdKey LEFT JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey
      LEFT JOIN ShipmentHistory h ON h.SdetailKey=sd.SdetailKey WHERE om.OrderYear=N'2025' AND om.OrderWeek=N'37-01'`);
    assert.equal(old.recordset[0].OutQuantity,7);assert.equal(old.recordset[0].ShipmentOut,7);assert.equal(old.recordset[0].ShipmentQuantity,7);
    assert.equal(await priorYearSnapshot(tQ),prior,'2025 matching-week order, shipment, dates, and history remain byte-for-byte equivalent');
  });

  // The production edit-presence helpers replace an actually expired lease, advance its revision, and release that token.
  console.log('CASE: expired lease helpers');
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`INSERT dbo.WebErpEditLease(OrderYear,OrderWeek,CustKey,LeaseToken,OwnerUserId,OwnerName,ClientId,PageCode,BaselineDigest,Revision,ExpiresAt)
      VALUES(N'2026',N'37',533,N'expired-token',N'old-owner',N'Old',N'old-client',N'estimate',REPLICATE('0',64),4,DATEADD(minute,-2,SYSUTCDATETIME()))`);
    const scope={orderYear:'2026',orderWeek:'37',custKey:533};
    const acquired=await presence.acquireErpEditLease(tQ,scope,user,{clientId:'adv-client',pageCode:'estimate'});
    const token=acquired.lease.leaseToken;assert.notEqual(token,'expired-token');assert.equal(acquired.lease.revision,0);
    const guard={leaseToken:token,clientId:'adv-client'};
    await presence.assertErpEditGuard(tQ,scope,user,{editGuard:guard});
    const advanced=await presence.advanceErpEditGuard(tQ,scope,user,{editGuard:guard});assert.equal(advanced.revision,1);
    await presence.releaseErpEditLease(tQ,scope,user,{editGuard:guard});
    const row=(await tQ(`SELECT LeaseToken,Revision,ExpiresAt FROM dbo.WebErpEditLease WHERE OrderYear=N'2026' AND OrderWeek=N'37' AND CustKey=533`)).recordset[0];
    assert.equal(row.LeaseToken,token);assert.equal(row.Revision,1);assert.ok(new Date(row.ExpiresAt).getTime()<Date.now());
  });
  await query(pool,`INSERT dbo.WebErpEditLease(OrderYear,OrderWeek,CustKey,LeaseToken,OwnerUserId,OwnerName,ClientId,PageCode,BaselineDigest,Revision,ExpiresAt)
    VALUES(N'2026',N'37',533,N'foreign-active-token',N'other-user',N'Other',N'other-client',N'estimate',REPLICATE('1',64),8,DATEADD(minute,5,SYSUTCDATETIME()))`);
  console.log('CASE: active owner lease conflict');
  await failedAndRolledBack(pool,async(tQ)=>{
    const a=await expected(tQ,'37-01');
    return core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:4}],a)]),user,deps);
  },'ERP_EDIT_LOCKED');
  const foreign=(await query(pool,`SELECT LeaseToken,OwnerUserId,Revision,ExpiresAt FROM dbo.WebErpEditLease WHERE OrderYear=N'2026' AND OrderWeek=N'37' AND CustKey=533`)).recordset[0];
  assert.equal(foreign.LeaseToken,'foreign-active-token');assert.equal(foreign.OwnerUserId,'other-user');assert.equal(foreign.Revision,8);
  await query(pool,`DELETE dbo.WebErpEditLease WHERE OrderYear=N'2026' AND OrderWeek=N'37' AND CustKey=533`);

  // Opposite transfer is seeded transaction-locally; the pure fixed transfer is executed through the production core.
  console.log('CASE: reverse same-total transfer');
  await rollbackScenario(pool,async(tQ)=>{
    await seedAlternateDirection(tQ);await tQ(`UPDATE Product SET Stock=0 WHERE ProdKey=866`);
    const a=await expected(tQ,'37-01'),b=await expected(tQ,'37-02');
    await core.executeWeekdayDistributionApply(tQ,sql,body([change('37-02',[{date:'2026-09-15',quantity:0}],b),
      change('37-01',[{date:'2026-09-10',quantity:5},{date:'2026-09-13',quantity:20}],a)],'reverse same-total transfer 37-02 to 37-01'),user,deps);
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock),0,'reverse fixed transfer nets to zero from zero stock');
  });

  // Split 0.10 box into two 0.05 dates: disallow if conversion/quote rounding cannot be represented exactly.
  console.log('CASE: decimal date split rejection');
  await failedAndRolledBack(pool,async(tQ)=>{
    await tQ(`DELETE dbo.ShipmentDate WHERE SdetailKey=89892;
      INSERT dbo.ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(119701,89892,CONVERT(datetime,'2026-09-10 00:00:00.000',121),0.10,3,2500.1234,6819,681.90,N'0.10 baseline');
      UPDATE dbo.ShipmentDetail SET OutQuantity=0.10,BoxQuantity=0.10,BunchQuantity=3,SteamQuantity=3,EstQuantity=3,Amount=6819,Vat=682 WHERE SdetailKey=89892`);
    const a=await expected(tQ,'37-01');
    return core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:0.05},{date:'2026-09-11',quantity:0.05}],a)],'nonrepresentable same-total date split'),user,deps);
  },'UNIT_CONVERSION_ROUNDTRIP_FAILED');

  // New target dates inherit ShipmentDetail.Cost, not an incompatible source DateCost.
  await failedAndRolledBack(pool,async(tQ)=>{
    await tQ(`UPDATE ShipmentDate SET Cost=2000,Amount=272727,Vat=27272.73 WHERE SdateKey=119701`);
    const a=await expected(tQ,'37-01'),b=await expected(tQ,'37-02');
    return core.executeWeekdayDistributionApply(tQ,sql,body([
      change('37-01',[{date:'2026-09-10',quantity:0}],a),
      change('37-02',[{date:'2026-09-15',quantity:5}],b),
    ],'reject cross-week transfer across incompatible date-price buckets'),user,deps);
  },'NEEDS_REDESIGN');

  // A NULL/zero DetailCost cannot be filtered away when resolving a new target's source price.
  await failedAndRolledBack(pool,async(tQ)=>{
    await tQ(`UPDATE ShipmentDetail SET Cost=0 WHERE SdetailKey=89892`);
    const a=await expected(tQ,'37-01'),b=await expected(tQ,'37-02');
    return core.executeWeekdayDistributionApply(tQ,sql,body([
      change('37-01',[{date:'2026-09-10',quantity:0}],a),
      change('37-02',[{date:'2026-09-15',quantity:5}],b),
    ],'reject invalid source detail price for new target'),user,deps);
  },'NEEDS_REDESIGN');

  // Increase and decrease both produce actual fixed stock effects; their opposite paths restore Product.Stock.
  console.log('CASE: fixed stock increase/decrease');
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE Product SET Stock=10 WHERE ProdKey=866`);const before=10;
    const a=await expected(tQ,'37-01');
    await core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:5},{date:'2026-09-13',quantity:21}],a)],'fixed quantity increase control'),user,deps);
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock),before-1);
    const b=await expected(tQ,'37-01');
    await core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:5},{date:'2026-09-13',quantity:20}],b)],'fixed quantity decrease control'),user,deps);
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock),before);
  });

  // A fixed delta=0 date move must not round raw Product.Stock precision through the quantity normalizer.
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE Product SET Stock=0.1234 WHERE ProdKey=866`);
    const a=await expected(tQ,'37-01');
    await core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[
      {date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5},{date:'2026-09-13',quantity:20},
    ],a)],'delta-zero date move preserves raw stock precision'),user,deps);
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock),0.1234,
      'delta-zero operation performs no Product.Stock write and retains 4-decimal precision');
  });

  // 2027 cascade negative: native recalculation runs, postcheck rejects, outer transaction rolls everything back.
  console.log('CASE: native future negative rollback');
  await failedAndRolledBack(pool,async(tQ)=>{
    await tQ(`UPDATE Product SET Stock=10 WHERE ProdKey=866; UPDATE ProductStock SET Stock=30 WHERE StockKey=3602 AND ProdKey=866;
      UPDATE ProductStock SET Stock=15 WHERE StockKey=3701 AND ProdKey=866; UPDATE ProductStock SET Stock=10 WHERE StockKey=3702 AND ProdKey=866;
      UPDATE ProductStock SET Stock=10 WHERE StockKey=3901 AND ProdKey=866; UPDATE ProductStock SET Stock=0 WHERE StockKey=2701 AND ProdKey=866;
      INSERT dbo.StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
        VALUES(GETDATE(),N'2027',N'01-01',N'fixture-user',N'재고조정',N'수량',0,-10,N'negative post-native fixture control',866)`);
    const a=await expected(tQ,'37-01');
    const result=await core.executeWeekdayDistributionApply(tQ,sql,body([change('37-01',[{date:'2026-09-10',quantity:5},{date:'2026-09-11',quantity:5},{date:'2026-09-13',quantity:20}],a)],'future 2027 ProductStock native postcheck'),user,deps);
    return result;
  },'FUTURE_STOCK_SHORTAGE');

  console.log('PASS: adversarial weekday apply SQL sidecar (2025 sentinel, real expired/active leases, bidirectional Stock=0 transfer, unit split rejection, stock direction controls, 2027 native negative rollback)');
}

async function main(){
  const password=inspectApprovedContainer();
  const name=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;
  if(!DB_RE.test(name))fail('generated database name guard failed');
  if(['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'].some((key)=>process.env[key]))fail('operational DB variables are forbidden in this fixture process');
  let master;let pool;
  try{
    master=await new sql.ConnectionPool({user:'sa',password,server:HOST,port:PORT,database:'master',requestTimeout:60000,options:{encrypt:false,trustServerCertificate:true},pool:{max:2,min:0}}).connect();
    await query(master,`CREATE DATABASE ${bracket(name)}`);await query(master,`ALTER DATABASE ${bracket(name)} SET COMPATIBILITY_LEVEL=130`);
    pool=await new sql.ConnectionPool({user:'sa',password,server:HOST,port:PORT,database:name,requestTimeout:60000,options:{encrypt:false,trustServerCertificate:true},pool:{max:4,min:0}}).connect();
    await install(pool);await seed(pool);
    const [core,gate,presence]=await Promise.all([
      import(pathToFileURL(path.join(ROOT,'lib','weekdayDistributionApply.js')).href),
      import(pathToFileURL(path.join(ROOT,'lib','estimateDirectionalQuantity.js')).href),
      import(pathToFileURL(path.join(ROOT,'lib','erpEditPresence.js')).href),
    ]);
    await run(pool,core,gate,presence);
  }finally{
    await pool?.close().catch(()=>{});
    if(master){await query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${bracket(name)}; END`).catch(()=>{});await master.close().catch(()=>{});}
  }
}
main().catch((error)=>{console.error(error.stack||error.message);if(error.expectedDigest||error.actualDigest)console.error(JSON.stringify({expectedDigest:error.expectedDigest,actualDigest:error.actualDigest}));process.exitCode=1;});
