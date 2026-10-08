#!/usr/bin/env node
/*
 * Isolated real-MSSQL harness for weekday distribution apply.
 * It reads no app .env and never connects to an operational endpoint. The
 * approved Docker fixture is inspected by exact name/image/loopback port, a
 * fresh guarded database is created, and every business scenario is rolled
 * back before that database is dropped.
 */

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
const LEGACY_SHIPMENT_DETAIL_ALLOCATORS = [
  'pages/api/shipment/adjust.js',
  'pages/api/shipment/distribute.js',
  'pages/api/shipment/stock-status.js',
  'lib/shipmentImport.js',
];

function fail(message) { throw new Error(`[weekday-distribution-fixture] ${message}`); }
function splitBatches(text) { return text.split(/^\s*GO\s*;?\s*$/gim).map((part) => part.trim()).filter(Boolean); }
function loadLocalSafeNextKey(relativePath, sharedAllocator) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const start = source.indexOf('async function safeNextKey(');
  if (start < 0) fail(`${relativePath} safeNextKey function missing`);
  const functionSource = source.slice(start).match(/^async function safeNextKey\([^\n]+\) \{[\s\S]*?^\}/m)?.[0];
  if (!functionSource) fail(`${relativePath} safeNextKey extraction failed`);
  return Function(
    'safeNextShipmentDetailKey',
    `'use strict'; ${functionSource}; return safeNextKey;`,
  )(sharedAllocator);
}
function assertDbName(name) {
  if (!/^NenovaEstimateFixture_[0-9]{8}_[0-9a-f]{8}$/.test(name)) fail('database name guard failed');
}
function bracket(name) { assertDbName(name); return `[${name.replace(/]/g, ']]')}]`; }

function inspectFixture() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved fixture container is not inspectable');
  const info = JSON.parse(result.stdout)[0];
  if (!info?.State?.Running || info.Name !== `/${CONTAINER}`) fail('fixture container identity/running guard failed');
  if (!/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || ''))) fail('fixture image guard failed');
  if ((info.Mounts || []).length || (info.HostConfig?.Binds || []).length) fail('mounted fixture is not allowed');
  const bindings = info.HostConfig?.PortBindings?.['1433/tcp'] || [];
  if (!bindings.some((item) => item.HostIp === HOST && Number(item.HostPort) === PORT)) fail('fixture loopback port guard failed');
  const passwordEntry = (info.Config?.Env || []).find((item) => String(item).startsWith('MSSQL_SA_PASSWORD='));
  if (!passwordEntry) fail('fixture-only SA password is absent');
  return { password: passwordEntry.slice('MSSQL_SA_PASSWORD='.length), image: info.Config.Image };
}

function request(executor, params = {}) {
  const req = new sql.Request(executor);
  for (const [name, spec] of Object.entries(params)) req.input(name, spec.type, spec.value);
  return req;
}
function query(executor, statement, params = {}) { return request(executor, params).query(statement); }
function tQuery(tx) { return (statement, params = {}) => query(tx, statement, params); }

async function installSchema(pool) {
  for (const batch of splitBatches(fs.readFileSync(SCHEMA, 'utf8'))) await query(pool, batch);
  await query(pool, `
    ALTER TABLE dbo.ShipmentDetail ALTER COLUMN CustKey int NULL;
    ALTER TABLE dbo.Customer ADD Manager nvarchar(20) NULL,OrderCode nvarchar(50) NULL,BaseOutDay int NULL;
    ALTER TABLE dbo.ShipmentDetail ADD EstDescr nvarchar(1000) NULL;
    ALTER TABLE dbo.OrderMaster ADD OrderDtm datetime NULL,OrderCode nvarchar(50) NULL,Descr nvarchar(1000) NULL,
      CreateID nvarchar(20) NULL,CreateDtm datetime NULL,LastUpdateID nvarchar(20) NULL,LastUpdateDtm datetime NULL;
    ALTER TABLE dbo.OrderDetail ALTER COLUMN CustKey int NULL;
    ALTER TABLE dbo.OrderDetail ADD EstQuantity decimal(18,4) NULL,NoneOutQuantity decimal(18,4) NULL,
      Descr nvarchar(1000) NULL,CreateID nvarchar(20) NULL,CreateDtm datetime NULL,LastUpdateID nvarchar(20) NULL,LastUpdateDtm datetime NULL;
    ALTER TABLE dbo.OrderDetail ADD CONSTRAINT DF_AllocationFixtureOrderQty DEFAULT(0) FOR OrderQuantity;
    CREATE TABLE dbo.CustomerProdCost (CustKey int,ProdKey int,Cost decimal(18,4));
    CREATE TABLE dbo.OrderHistory (OrderDetailKey int,ChangeType nvarchar(50),ColumName nvarchar(50),
      BeforeValue nvarchar(100),AfterValue nvarchar(100),Descr nvarchar(1000),ChangeID nvarchar(20),ChangeDtm datetime);
    ALTER TABLE dbo.CodeInfo ADD DetailCode nvarchar(100) NULL,Descr2 nvarchar(100) NULL;
    CREATE TABLE dbo.ProductSort (CounName nvarchar(100),FlowerName nvarchar(100),CountryFlower nvarchar(200),
      OrderNo int,GroupNo int,GroupName nvarchar(100));
    CREATE TABLE dbo.PeriodDay (
      PeriodDayKey int NOT NULL PRIMARY KEY,
      OrderYearWeek nvarchar(20) NOT NULL,
      BaseYmd nvarchar(23) NOT NULL,
      WeekDay int NOT NULL
    );
    CREATE TABLE dbo.KeyNumbering (
      Category nvarchar(100) NOT NULL PRIMARY KEY,
      LastKeyNo int NOT NULL,
      Descr nvarchar(200) NULL
    );
  `);
  await query(pool, `CREATE VIEW dbo.ViewOrder AS
    SELECT om.OrderMasterKey,od.OrderDetailKey,om.OrderYear,om.OrderWeek,
           om.OrderYearWeek + RIGHT(om.OrderWeek,2) AS OrderYearWeek2,
           om.CustKey,od.ProdKey,od.OutQuantity
      FROM dbo.OrderMaster om
      JOIN dbo.OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
     WHERE ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0;`);
  // The directional fixture's minimal ViewShipment lacked the EXE full-week join key.
  const schemaSource=fs.readFileSync(SCHEMA,'utf8');
  const view=schemaSource.match(/CREATE VIEW dbo\.ViewShipment AS[\s\S]*?\r?\nGO/)[0]
    .replace('CREATE VIEW','ALTER VIEW').replace(/\r?\nGO$/,'')
    .replace('sm.OrderYearWeek,','sm.OrderYearWeek,\n  sm.OrderYearWeek + RIGHT(sm.OrderWeek,2) AS OrderYearWeek2,');
  await query(pool,view);
  for (const batch of splitBatches(fs.readFileSync(MIGRATION, 'utf8'))) await query(pool, batch);

  const nativeSource = fs.readFileSync(NATIVE, 'utf8');
  const reference = nativeSource.replace(
    /CREATE\s+PROCEDURE\s+\[dbo\]\.\[usp_StockCalculation\]/i,
    'CREATE PROCEDURE dbo.usp_StockCalculation_Reference',
  );
  if (reference === nativeSource) fail('native calculator declaration was not found');
  await query(pool, `IF OBJECT_ID(N'dbo.usp_StockCalculation_Reference',N'P') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation_Reference;`);
  for (const batch of splitBatches(reference)) await query(pool, batch);
}

async function seed(pool) {
  await query(pool, `
    INSERT dbo.UserInfo(UserID,UserName) VALUES(N'fixture-user',N'Fixture User');
    INSERT dbo.Customer(CustKey,CustName,Manager,OrderCode,BaseOutDay)
      VALUES(533,N'Fixture Cust',N'fixture-user',N'F533',4);
    INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
      BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
      VALUES(866,N'Fixture Carnation',N'Colombia Carnation',N'Fixture Country',N'Carnation',
        N'박스',N'단',30,1,30,2500.1234,0);

    INSERT dbo.OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager)
      VALUES(3701,N'2026',N'37-01',N'202637',533,N'fixture-user'),
            (3702,N'2026',N'37-02',N'202637',533,N'fixture-user');
    INSERT dbo.OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,BoxQuantity,BunchQuantity,
      SteamQuantity,OutQuantity,OrderQuantity)
      VALUES(3701,3701,533,866,25,750,750,25,25),
            (3702,3702,533,866,5,150,150,5,5);

    INSERT dbo.ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
      VALUES(6266,N'2026',N'37-01',N'202637',533,1,0,1,N'fixture-user'),
            (6267,N'2026',N'37-02',N'202637',533,1,0,1,N'fixture-user');
    INSERT dbo.ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,
      BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix,Descr,EstDescr)
      VALUES(89892,6266,533,866,CONVERT(datetime,'2026-09-10 00:00:00.000',121),25,
        25,750,750,750,2500.1234,1704630,170462.55,1,N'fixture detail',N'');
    INSERT dbo.ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(119701,89892,CONVERT(datetime,'2026-09-10 00:00:00.000',121),5,150,2500.1234,340926,34092.51,N'first'),
            (119700,89892,CONVERT(datetime,'2026-09-13 00:00:00.000',121),20,600,2500.1234,1363704,136370.04,N'legacy-preserve');

    INSERT dbo.PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
      VALUES(1,N'202637',N'2026-09-10',5),
            (2,N'202637',N'2026-09-11',6),
            (3,N'202637',N'2026-09-13',1),
            -- Mon/Tue/Wed can belong to the following PeriodDay parent while
            -- remaining in the 37 Thu..Wed business cycle.
            (4,N'202638',N'2026-09-15',3),
            (5,N'202638',N'2026-09-16',4);

    INSERT dbo.WarehouseMaster(WarehouseKey,OrderYear,OrderWeek,UploadDtm,FileName)
      VALUES(3701,N'2026',N'37-01',GETDATE(),N'fixture.xlsx');
    INSERT dbo.WarehouseDetail(WdetailKey,WarehouseKey,ProdKey,FarmKey,BoxQuantity,BunchQuantity,
      SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch)
      VALUES(3701,3701,866,NULL,25,750,750,25,750,2500.1234,1875093,30,1);
    INSERT dbo.StockMaster(StockKey,OrderYear,OrderWeek,OrderYearWeek,isFix,CreateID)
      VALUES(3701,N'2026',N'37-01',N'20263701',1,N'fixture-user'),
            (3702,N'2026',N'37-02',N'20263702',1,N'fixture-user'),
            (3901,N'2026',N'39-01',N'20263901',1,N'fixture-user');
    INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(3701,866,0),(3702,866,0),(3901,866,0);
    IF NOT EXISTS(SELECT 1 FROM dbo.CodeInfo WHERE Category=N'StockType' AND Descr=N'재고조정')
      INSERT dbo.CodeInfo(Category,Descr) VALUES(N'StockType',N'재고조정');
    IF EXISTS(SELECT 1 FROM dbo.FixtureNativeCalcControl WHERE ControlKey=1)
      UPDATE dbo.FixtureNativeCalcControl SET FailNext=0,NullNext=0,FailureMessage=N'fixture native failure' WHERE ControlKey=1;
    ELSE INSERT dbo.FixtureNativeCalcControl(ControlKey,FailNext,FailureMessage)
      VALUES(1,0,N'fixture native failure');
    IF EXISTS(SELECT 1 FROM dbo.NenovaStockWeekGate WHERE GateKey='1')
      UPDATE dbo.NenovaStockWeekGate SET Mode=NULL,PendingCalc=0,OwnerSessionID=NULL,OwnerToken=NULL,
        LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL,CalcProdKey=NULL WHERE GateKey='1';
    ELSE INSERT dbo.NenovaStockWeekGate(GateKey,Mode) VALUES('1',NULL);
    INSERT dbo.KeyNumbering(Category,LastKeyNo,Descr)
      VALUES(N'ShipmentDetailKey',89892,N''),
            (N'OrderMasterKey',3702,N''),(N'OrderDetailKey',3702,N'');
  `);
}

async function convertShipmentDateToIdentity(pool) {
  await query(pool, `
    CREATE TABLE dbo.ShipmentDateIdentityFixture (
      SdateKey int IDENTITY(1,1) NOT NULL PRIMARY KEY,
      SdetailKey int NOT NULL,
      ShipmentDtm datetime NOT NULL,
      ShipmentQuantity decimal(18,4) NOT NULL,
      EstQuantity decimal(18,4) NOT NULL,
      Cost decimal(18,4) NOT NULL,
      Amount decimal(18,4) NOT NULL,
      Vat decimal(18,4) NOT NULL,
      Descr nvarchar(1000) NULL
    );
    SET IDENTITY_INSERT dbo.ShipmentDateIdentityFixture ON;
    INSERT dbo.ShipmentDateIdentityFixture
      (SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
    SELECT SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr
      FROM dbo.ShipmentDate;
    SET IDENTITY_INSERT dbo.ShipmentDateIdentityFixture OFF;
    DROP TABLE dbo.ShipmentDate;
    EXEC sys.sp_rename N'dbo.ShipmentDateIdentityFixture',N'ShipmentDate';
  `);
}

function leaseDependencies(gate, presence) {
  return {
    assertGateCapability: gate.assertDirectionalGateCapability,
    lockGate: gate.lockDirectionalGate,
    acquireEditLease: presence.acquireErpEditLease,
    assertEditGuard: presence.assertErpEditGuard,
    advanceEditGuard: presence.advanceErpEditGuard,
    releaseEditLease: presence.releaseErpEditLease,
  };
}

function fixtureActual(orderWeek, rows, outQuantity, stock = 0) {
  const isSource = orderWeek === '37-01';
  return {
    detailRows: outQuantity == null ? 0 : 1,
    shipmentOutQuantity: outQuantity,
    shipmentDates: rows,
    master: {
      ShipmentKey: isSource ? 6266 : 6267,
      MasterIsFix: 1,
      OrderYearWeek: '202637',
    },
    detail: outQuantity == null ? null : {
      SdetailKey: 89892, ShipmentKey: 6266, CustKey: 533, ProdKey: 866,
      ShipmentTimestamp: '2026-09-10 00:00:00.000',
      OutQuantity: 25, BoxQuantity: 25, BunchQuantity: 750, SteamQuantity: 750,
      EstQuantity: 750, DetailCost: 2500.1234, DetailAmount: 1704630,
      DetailVat: 170462.55, DetailIsFix: 1,
    },
    product: {
      ProdKey: 866, OutUnit: '박스', EstUnit: '단', BunchOf1Box: 30,
      SteamOf1Bunch: 1, SteamOf1Box: 30, Stock: stock,
    },
  };
}

function expectedFromActual(core, orderWeek, actual) {
  return {
    detailRows: actual.detailRows,
    shipmentOutQuantity: actual.shipmentOutQuantity,
    shipmentDates: actual.shipmentDates,
    snapshotDigest: core.weekdaySnapshotDigest({
      year:'2026',orderWeek,custKey:533,prodKey:866,
    }, actual),
  };
}

function expected(core, orderWeek, rows, outQuantity, stock = 0) {
  return expectedFromActual(core, orderWeek, fixtureActual(orderWeek, rows, outQuantity, stock));
}

function existingRows() {
  return [
    {sdateKey:119701,sdetailKey:89892,shipmentKey:6266,date:'2026-09-10',timestamp:'2026-09-10 00:00:00.000',shipmentQuantity:5,estimateQuantity:150,detailFixed:true,cost:2500.1234,amount:340926,vat:34092.51},
    {sdateKey:119700,sdetailKey:89892,shipmentKey:6266,date:'2026-09-13',timestamp:'2026-09-13 00:00:00.000',shipmentQuantity:20,estimateQuantity:600,detailFixed:true,cost:2500.1234,amount:1363704,vat:136370.04},
  ];
}

function crossWeekBody(core, operationId, reason = 'fixed pure same-total cross-week target') {
  return {operationId,reason,custKey:533,changes:[
    {year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),dates:[{date:'2026-09-13',quantity:15}]},
    {year:'2026',orderWeek:'37-02',prodKey:866,unit:'박스',expected:expected(core,'37-02',[],null),dates:[{date:'2026-09-15',quantity:5}]},
  ]};
}

async function expectCode(action, code) {
  try { await action(); } catch (error) { assert.equal(error?.code,code); return error; }
  fail(`expected ${code}`);
}

async function rollbackScenario(pool, run) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try { await run(tQuery(tx)); } finally { await tx.rollback().catch(()=>{}); }
}

async function commitScenario(pool, run) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const value = await run(tQuery(tx));
    await tx.commit();
    return value;
  } catch (error) {
    await tx.rollback().catch(()=>{});
    throw error;
  }
}

async function businessFingerprint(pool) {
  const [details,dates,product,history] = await Promise.all([
    query(pool,`SELECT SdetailKey,ShipmentKey,CustKey,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,
      EstQuantity,Cost,Amount,Vat,isFix FROM ShipmentDetail ORDER BY SdetailKey`),
    query(pool,`SELECT SdateKey,SdetailKey,CONVERT(varchar(23),ShipmentDtm,121) ShipmentDtm,
      ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr FROM ShipmentDate ORDER BY SdateKey`),
    query(pool,`SELECT ProdKey,Stock FROM Product ORDER BY ProdKey`),
    query(pool,`SELECT ShipmentHistoryKey,SdetailKey,ChangeType,BeforeValue,AfterValue
      FROM ShipmentHistory ORDER BY ShipmentHistoryKey`),
  ]);
  return JSON.stringify({
    details:details.recordset,dates:dates.recordset,product:product.recordset,history:history.recordset,
  });
}

async function seedCalendarRegression(tQ, timestamp = '2026-10-04 00:00:00.000') {
  await tQ(`
    UPDATE OrderMaster SET OrderWeek=N'40-01',OrderYearWeek=N'202640' WHERE OrderMasterKey=3701;
    UPDATE ShipmentMaster SET OrderWeek=N'40-01',OrderYearWeek=N'202640' WHERE ShipmentKey=6266;
    DELETE ShipmentDate WHERE SdateKey=119701;
    UPDATE ShipmentDate SET ShipmentDtm=CONVERT(datetime,@dt,121) WHERE SdateKey=119700;
    UPDATE ShipmentDetail SET ShipmentDtm=CONVERT(datetime,@dt,121),OutQuantity=20,
      BoxQuantity=20,BunchQuantity=600,SteamQuantity=600,EstQuantity=600,
      Amount=1363704,Vat=136370.04 WHERE SdetailKey=89892;
    DELETE PeriodDay;
    INSERT PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
      VALUES(1,N'202640',N'2026-10-01',5),(2,N'202640',N'2026-10-04',1);
  `, {dt:{type:sql.NVarChar,value:timestamp}});
  const rows = existingRows().filter((row) => row.sdateKey === 119700)
    .map((row) => ({...row,date:'2026-10-04',timestamp}));
  const actual = fixtureActual('37-01',rows,20);
  actual.master.OrderYearWeek = '202640';
  Object.assign(actual.detail, {
    ShipmentTimestamp: timestamp,
    OutQuantity:20,BoxQuantity:20,BunchQuantity:600,SteamQuantity:600,EstQuantity:600,
    DetailAmount:1363704,DetailVat:136370.04,
  });
  return actual;
}

function calendarRegressionBody(core, actual, operationId = crypto.randomUUID()) {
  return {operationId,reason:'nvarchar calendar exact timestamp regression',custKey:533,changes:[{
    year:'2026',orderWeek:'40-01',prodKey:866,unit:'박스',
    expected:expectedFromActual(core,'40-01',actual),
    dates:[{date:'2026-10-01',quantity:5},{date:'2026-10-04',quantity:15}],
  }]};
}

async function runCalendarRegressions(pool, core, user, dependencies) {
  const storage = (await query(pool,`SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=N'dbo' AND TABLE_NAME=N'PeriodDay' AND COLUMN_NAME=N'BaseYmd'`)).recordset[0];
  assert.equal(storage.DATA_TYPE,'nvarchar','fixture must reproduce the operational string calendar');
  for (const timestamp of ['2026-10-04 00:00:00.000','2026-10-04 12:34:56.123']) {
    await rollbackScenario(pool, async (tQ) => {
      const actual = await seedCalendarRegression(tQ,timestamp);
      if (timestamp !== '2026-10-04 00:00:00.000') {
        await tQ(`UPDATE PeriodDay SET BaseYmd=@dt WHERE PeriodDayKey=2`, {
          dt:{type:sql.NVarChar,value:timestamp},
        });
      }
      const representation = (await tQ(`SELECT pd.BaseYmd RawCalendar,
        CONVERT(nvarchar(23),pd.BaseYmd,121) DirectCalendar,
        CONVERT(nvarchar(23),CONVERT(datetime,pd.BaseYmd,121),121) CanonicalCalendar,
        CONVERT(nvarchar(23),d.ShipmentDtm,121) ShipmentTimestamp,pd.WeekDay
        FROM ShipmentDate d JOIN PeriodDay pd ON d.ShipmentDtm=pd.BaseYmd
        WHERE d.SdateKey=119700`)).recordset[0];
      assert.equal(representation.WeekDay,1);
      assert.equal(representation.CanonicalCalendar,timestamp);
      assert.equal(representation.ShipmentTimestamp,timestamp);
      if (timestamp === '2026-10-04 00:00:00.000') {
        assert.equal(representation.RawCalendar,'2026-10-04');
        assert.equal(representation.DirectCalendar,'2026-10-04','direct string conversion must expose the original bug');
      }
      const preserved = (await tQ(`SELECT
        (SELECT OutQuantity FROM OrderDetail WHERE OrderDetailKey=3701) OrderQuantity,
        (SELECT Stock FROM Product WHERE ProdKey=866) Stock,
        (SELECT COUNT(*) FROM StockHistory) StockHistoryCount,
        (SELECT COUNT(*) FROM ShipmentFarm) FarmCount`)).recordset[0];
      const body = calendarRegressionBody(core,actual);
      const result = await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
      assert.equal(result.saved,true);
      assert.equal(result.changes[0].oldQuantity,20);
      assert.equal(result.changes[0].newQuantity,20);
      assert.equal(result.changes[0].delta,0);
      const representative = (await tQ(`SELECT CONVERT(nvarchar(23),ShipmentDtm,121) Timestamp
        FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0].Timestamp;
      assert.equal(representative,'2026-10-01 00:00:00.000','EXE day5 Thursday wins over day1 Sunday, not chronological last');
      const dates = (await tQ(`SELECT d.SdateKey,CONVERT(nvarchar(23),d.ShipmentDtm,121) Timestamp,
        d.ShipmentQuantity,d.EstQuantity,d.Cost,pd.WeekDay
        FROM ShipmentDate d JOIN PeriodDay pd ON d.ShipmentDtm=pd.BaseYmd
        WHERE d.SdetailKey=89892 ORDER BY d.ShipmentDtm`)).recordset;
      assert.deepEqual(dates.map((row) => [row.Timestamp,Number(row.ShipmentQuantity),Number(row.EstQuantity),row.WeekDay]), [
        ['2026-10-01 00:00:00.000',5,150,5],[timestamp,15,450,1],
      ]);
      assert.equal(dates[1].SdateKey,119700,'existing physical date key is preserved');
      assert.ok(dates.every((row) => Number(row.Cost) === 2500.1234));
      const detail = (await tQ(`SELECT OutQuantity,EstQuantity,Cost,Amount,Vat,isFix
        FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0];
      assert.deepEqual([Number(detail.OutQuantity),Number(detail.EstQuantity),Number(detail.Cost),
        Number(detail.Amount),Number(detail.Vat),detail.isFix], [20,600,2500.1234,1363704,136370.04,true]);
      const after = (await tQ(`SELECT
        (SELECT OutQuantity FROM OrderDetail WHERE OrderDetailKey=3701) OrderQuantity,
        (SELECT Stock FROM Product WHERE ProdKey=866) Stock,
        (SELECT COUNT(*) FROM StockHistory) StockHistoryCount,
        (SELECT COUNT(*) FROM ShipmentFarm) FarmCount`)).recordset[0];
      assert.deepEqual(after,preserved,'same-total move preserves order/stock/farm policies');
    });
  }

  const before = await businessFingerprint(pool);
  const operationId = crypto.randomUUID();
  await assert.rejects(() => commitScenario(pool, async (tQ) => {
    const actual = await seedCalendarRegression(tQ,'2026-10-04 12:00:00.000');
    return core.executeWeekdayDistributionApply(tQ,sql,calendarRegressionBody(core,actual,operationId),user,dependencies);
  }), (error) => error?.code === 'CALENDAR_TIMESTAMP_MISMATCH');
  assert.equal(await businessFingerprint(pool),before,'nonmidnight mismatch must roll back business/history changes');
  assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`, {
    op:{type:sql.UniqueIdentifier,value:operationId},
  })).recordset[0].c),0,'timestamp rejection rolls back the operation reservation');
  console.log('PASS: nvarchar calendar 20→15+5 exact datetime JOIN, matching nonmidnight preservation, mismatched clock full rollback');
}

async function runPrintCompatibilityRegressions(pool) {
  const print=await import(pathToFileURL(path.join(ROOT,'lib','weekdayEstimatePrint.js')).href);
  const scope=print.normalizeWeekdayPrintRequest({year:2026,majorWeek:37,custKey:533,mode:'major'});
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE Product SET EstUnit=N'박스' WHERE ProdKey=866;
      UPDATE ShipmentDetail SET OutQuantity=4.5,EstQuantity=4.5,BoxQuantity=4.5,
        BunchQuantity=135,SteamQuantity=135,Cost=110,Amount=400,Vat=40 WHERE SdetailKey=89892;
      DELETE ShipmentDate WHERE SdateKey=119700;
      UPDATE ShipmentDate SET ShipmentQuantity=4.5,EstQuantity=4.5,Cost=110,Amount=400,Vat=40
        WHERE SdateKey=119701;`);
    const result=await print.readWeekdayPrintInTransaction(scope,tQ,sql);
    assert.equal(result.items[0].Quantity,5,'EXE print query SQL ROUND quantity is preserved');
    assert.equal(result.items[0].Amount,400,'EXE stored decimal midpoint-to-even Amount is preserved');
    assert.equal(result.items[0].Vat,40);
  });
  await rollbackScenario(pool,async(tQ)=>{
    const result=await print.readWeekdayPrintInTransaction(scope,tQ,sql);
    assert.equal(result.eligibility.eligible,true);
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].Quantity,750);
    assert.equal(result.items[0].Amount,1704630);
    assert.equal(result.items[0].Vat,170462.55);
    // All-main confirmation is separate from other customers' link diagnostics.
    await tQ(`INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
      VALUES(9001,N'2026',N'37-03',N'202637',999,1,0,1,N'fixture-user');
      INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
        BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
      VALUES(99001,9001,999,999,CONVERT(datetime,'2026-09-10',121),1,1,1,1,1,100,91,9,1,N'other customer bad link');`);
    const warned=await print.readWeekdayPrintInTransaction(scope,tQ,sql);
    assert.equal(warned.eligibility.eligible,true,'other customer fully fixed link warning cannot block selected customer');
    await tQ(`UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey=99001`);
    await assert.rejects(()=>print.readWeekdayPrintInTransaction(scope,tQ,sql),error=>error.status===409&&error.eligibility?.unfixedCount===1);
    await tQ(`UPDATE ShipmentMaster SET OrderYear=N'2025',OrderYearWeek=N'202537' WHERE ShipmentKey=9001`);
    assert.equal((await print.readWeekdayPrintInTransaction(scope,tQ,sql)).items[0].Quantity,750,'prior-year same cycle unfixed sentinel cannot block');
    await tQ(`INSERT PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
      VALUES(6,N'202637',N'2026-09-12',7),(7,N'202638',N'2026-09-14',2);`);
    const dateScope=print.normalizeWeekdayPrintRequest({...scope,mode:'dates',dates:['2026-09-10']});
    const dated=await print.readWeekdayPrintInTransaction(dateScope,tQ,sql);
    assert.equal(dated.items[0].Quantity,150);
    assert.equal(dated.items[0].Amount,340926);
    assert.equal(dated.items[0].Vat,34092.51);
    const tamperQuery=async(statement,params)=>{
      const data=await tQ(statement,params);
      if(statement.includes('WITH list AS')) data.recordset=data.recordset.map(row=>({...row,EstQuantity:999}));
      return data;
    };
    await assert.rejects(()=>print.readWeekdayPrintInTransaction(dateScope,tamperQuery,sql),error=>error.status===409);
    await tQ(`UPDATE ShipmentDate SET Amount=Amount-1,Vat=Vat+1 WHERE SdateKey=119701`);
    await assert.rejects(()=>print.readWeekdayPrintInTransaction(scope,tQ,sql),error=>error.status===409&&error.eligibility?.invalidCount>0);
  });
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE ShipmentDetail SET CustKey=NULL WHERE SdetailKey=89892`);
    const raw=(await tQ(`SELECT CustKey,isFix FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0];
    assert.equal(raw.CustKey,null,'native customer key remains raw NULL');
    assert.equal(raw.isFix,true,'ERP Detail.isFix is independent from page baseline confirmation');
    const result=await print.readWeekdayPrintInTransaction(scope,tQ,sql);
    assert.equal(result.eligibility.eligible,true,'native NULL passes locked print eligibility');
    assert.equal(result.items[0].Quantity,750,'native NULL remains connected to the selected Master customer for quote output');
  });
  for(const invalidCustKey of [0,999]) await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE ShipmentDetail SET CustKey=@custKey WHERE SdetailKey=89892`,
      {custKey:{type:sql.Int,value:invalidCustKey}});
    await assert.rejects(()=>print.readWeekdayPrintInTransaction(scope,tQ,sql),
      error=>error.status===409&&error.eligibility?.invalidCount>0,
      `explicit detail customer ${invalidCustKey} must not pass print eligibility`);
  });
  console.log('PASS: actual MSSQL print SQL, EXE midpoint money, all-main flags, selected customer links/money, date-only quote, prior-year sentinel and result reconciliation');
}

async function runNativeNullCustomerApplyRegressions(pool,core,user,dependencies) {
  const baselineSql=await import(pathToFileURL(path.join(ROOT,'lib','weekdayInitialBaselineSql.js')).href);
  const customerLink=await import(pathToFileURL(path.join(ROOT,'lib','weekdayCustomerLink.js')).href);
  const carrySource=fs.readFileSync(path.join(ROOT,'pages','api','estimate','weekday-carryover.js'),'utf8');
  const carryLiteral=carrySource.match(/const CONTEXT_SQL = `([\s\S]*?)`;/)?.[1];
  if(!carryLiteral) fail('weekday carryover CONTEXT_SQL extraction failed');
  const carrySql=Function('WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL',`return \`${carryLiteral}\`;`)(customerLink.WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL);
  const cycleParams={cycles:{type:sql.NVarChar(sql.MAX),value:JSON.stringify([{year:2026,majorWeek:'37'}])},
    custKey:{type:sql.Int,value:533}};
  const orderWeek='37-01';
  const actual=fixtureActual(orderWeek,existingRows(),25);
  actual.detail.CustKey=null;
  const operationId=crypto.randomUUID();
  const body={operationId,reason:'native NULL detail customer raw snapshot',custKey:533,changes:[{
    year:'2026',orderWeek,prodKey:866,unit:'박스',
    expected:expectedFromActual(core,orderWeek,actual),
    dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-13',quantity:25}],
  }]};
  const before=await businessFingerprint(pool);
  await rollbackScenario(pool,async(tQ)=>{
    await tQ(`UPDATE ShipmentDetail SET CustKey=NULL WHERE SdetailKey=89892`);
    const result=await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.success,true,'same-total native NULL date-move snapshot is accepted by the real transaction');
    const readback=await tQ(`SELECT CustKey,isFix,OutQuantity FROM ShipmentDetail WHERE SdetailKey=89892`);
    assert.equal(readback.recordset[0].CustKey,null,'apply does not populate or rewrite the raw native NULL key');
    assert.equal(readback.recordset[0].isFix,true,'apply keeps stored Detail.isFix separate from page baseline state');
    assert.equal(Number(readback.recordset[0].OutQuantity),25);
    const moved=(await tQ(`SELECT CONVERT(nvarchar(10),ShipmentDtm,120) [date],ShipmentQuantity
      FROM ShipmentDate WHERE SdetailKey=89892 ORDER BY ShipmentDtm`)).recordset;
    assert.deepEqual(moved.map(row=>[row.date,Number(row.ShipmentQuantity)]),[['2026-09-13',25]],
      'native NULL save moves day-one quantity 5 into day four while preserving total 25');
    const baseline=await baselineSql.readWeekdayInitialBaselineSnapshot({year:2026,orderWeek,custKey:533},
      {query:(statement,params)=>tQ(statement,params),sql});
    assert.equal(baseline.rows.find(row=>row.prodKey===866).quantity,25,'real baseline SQL aggregates native NULL detail');
    const carry=(await tQ(carrySql,cycleParams)).recordset.find(row=>row.OrderWeek===orderWeek);
    assert.equal(Number(carry.InvalidQuantityRows),0,'real carryover SQL does not flag native NULL detail');
    assert.equal(JSON.parse(carry.ShipmentDates).reduce((sum,row)=>sum+Number(row.invalidRows),0),0);
  });
  assert.deepEqual(await businessFingerprint(pool),before,'native NULL apply/date move scenario rolls back every ERP and history row');

  for(const invalidCustKey of [0,999]) {
    const nearMissBody={...body,operationId:crypto.randomUUID()};
    await assert.rejects(()=>rollbackScenario(pool,async(tQ)=>{
      await tQ(`UPDATE ShipmentDetail SET CustKey=@custKey WHERE SdetailKey=89892`,
        {custKey:{type:sql.Int,value:invalidCustKey}});
      const baselineRows=await tQ(baselineSql.WEEKDAY_INITIAL_BASELINE_SQL,{
        year:{type:sql.Int,value:2026},orderWeek:{type:sql.NVarChar(10),value:orderWeek},
        custKey:{type:sql.Int,value:533},
      });
      assert.equal(Number(baselineRows.recordset.find(row=>row.ProdKey===866).InvalidQuantityRows),1,
        'real baseline aggregate counts a wrong non-NULL detail customer');
      const carryRows=(await tQ(carrySql,cycleParams)).recordset.find(row=>row.OrderWeek===orderWeek);
      assert.equal(Number(carryRows.InvalidQuantityRows),1,'real carryover aggregate counts a wrong non-NULL detail customer');
      assert.ok(JSON.parse(carryRows.ShipmentDates).some(row=>Number(row.invalidRows)>0));
      return core.executeWeekdayDistributionApply(tQ,sql,nearMissBody,user,dependencies);
    }),error=>error?.code==='SHIPMENT_CUSTOMER_MISMATCH',
    `explicit detail customer ${invalidCustKey} aborts apply and transaction`);
    assert.deepEqual(await businessFingerprint(pool),before,'near-miss rollback preserves the raw detail key and all business rows');
  }
  console.log('PASS: native NULL customer save/readback preserves raw CustKey and Detail.isFix; zero/foreign customer near-misses fully roll back');
}

async function runAllocationRegressions(pool, core, user, dependencies) {
  const make = (actual, week, dates) => ({ operationId: crypto.randomUUID(), reason: 'explicit unconfirmed allocation fixture',
    mode: 'ALLOCATION', custKey: 533, changes: [{ year: '2026', orderWeek: week, prodKey: 866, unit: '박스',
      expected: expectedFromActual(core, week, actual), dates }] });
  const priorYear = async tQ => {
    await tQ(`INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager)
      VALUES(2702,N'2025',N'37-02',N'202537',533,N'fixture-user');
      INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,OutQuantity,OrderQuantity)
      VALUES(2702,2702,533,866,88,88);
      INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix)
      VALUES(5267,N'2025',N'37-02',N'202537',533,1);
      INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix)
      VALUES(59892,5267,NULL,866,CONVERT(datetime,'2025-09-16',121),88,2640,88,2640,2640,333,100,10,1);
      INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat)
      VALUES(59700,59892,CONVERT(datetime,'2025-09-16',121),88,2640,333,100,10);`);
  };
  const assertPriorYear = async tQ => {
    const row=(await tQ(`SELECT od.OutQuantity AS OrderQty,sd.OutQuantity AS DetailQty,sd.Cost,sd.isFix,
      d.ShipmentQuantity AS DateQty FROM OrderDetail od CROSS JOIN ShipmentDetail sd
      JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey WHERE od.OrderDetailKey=2702 AND sd.SdetailKey=59892`)).recordset[0];
    assert.deepEqual([Number(row.OrderQty),Number(row.DetailQty),Number(row.DateQty),Number(row.Cost),Boolean(row.isFix)],
      [88,88,88,333,true],'same prior-year order/shipment/date/cost/fix sentinel remains untouched');
  };
  for (const absentMaster of [false, true]) await rollbackScenario(pool, async tQ => {
    await priorYear(tQ);
    await tQ(`UPDATE Product SET Stock=10000 WHERE ProdKey=866;
      INSERT CustomerProdCost(CustKey,ProdKey,Cost) VALUES(533,866,700);
      ${absentMaster ? 'DELETE ShipmentMaster WHERE ShipmentKey=6267;' : ''}`);
    const actual = fixtureActual('37-02', [], null, 10000);
    if (absentMaster) actual.master = null;
    const body = make(actual, '37-02', [{ date: '2026-09-15', quantity: 7 }]);
    const result = await core.executeWeekdayDistributionApply(tQ, sql, body, user, dependencies);
    assert.equal(result.saved, true);
    const detail = (await tQ(`SELECT sd.OutQuantity,sd.EstQuantity,sd.Cost,sd.isFix,sm.isFix AS MasterFix
      FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
      WHERE sm.OrderYear=N'2026' AND sm.OrderWeek=N'37-02' AND sm.CustKey=533 AND sd.ProdKey=866`)).recordset[0];
    assert.equal(Number(detail.OutQuantity), 7); assert.equal(Number(detail.EstQuantity), 210);
    assert.equal(Number(detail.Cost), 700); assert.equal(Boolean(detail.isFix), false);
    assert.equal(Boolean(detail.MasterFix), !absentMaster, 'existing master confirmation preserved, new master remains unfixed');
    assert.equal(Number((await tQ(`SELECT OutQuantity FROM OrderDetail WHERE OrderDetailKey=3702`)).recordset[0].OutQuantity), 5,
      'existing positive order demand never increases');
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock), 10000);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM StockHistory`)).recordset[0].c), 0);
    const replay = await core.executeWeekdayDistributionApply(tQ, sql, body, user, dependencies);
    assert.deepEqual(replay, result, 'same UUID+allocation hash replays without a second addition');
    await assertPriorYear(tQ);
  });
  await rollbackScenario(pool, async tQ => {
    await priorYear(tQ);
    await tQ(`UPDATE Product SET Stock=10000 WHERE ProdKey=866;
      DELETE OrderDetail WHERE OrderMasterKey=3702; DELETE OrderMaster WHERE OrderMasterKey=3702;`);
    const actual = fixtureActual('37-02', [], null, 10000);
    const result = await core.executeWeekdayDistributionApply(tQ,sql,make(actual,'37-02',[{date:'2026-09-15',quantity:9}]),user,dependencies);
    assert.equal(result.saved,true);
    const order = (await tQ(`SELECT od.OutQuantity,od.EstQuantity,om.Manager,om.OrderYearWeek
      FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
      WHERE om.OrderYear=N'2026' AND om.OrderWeek=N'37-02' AND om.CustKey=533 AND od.ProdKey=866`)).recordset[0];
    assert.equal(Number(order.OutQuantity),9);assert.equal(Number(order.EstQuantity),270);
    assert.equal(order.Manager,'fixture-user');assert.equal(order.OrderYearWeek,'202637');
    assert.equal(Number((await tQ(`SELECT Cost FROM ShipmentDetail WHERE ShipmentKey=6267 AND ProdKey=866`)).recordset[0].Cost),0,
      'native missing CPC means zero, never Product.Cost fallback');
    await assertPriorYear(tQ);
  });
  await rollbackScenario(pool, async tQ => {
    await tQ(`UPDATE Product SET Stock=10000 WHERE ProdKey=866;
      UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=6266;
      UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey=89892;
      DELETE OrderDetail WHERE OrderMasterKey=3701; DELETE OrderMaster WHERE OrderMasterKey=3701;`);
    const rows = existingRows().map(row => ({ ...row, detailFixed: false }));
    const actual = fixtureActual('37-01',rows,25,10000);
    actual.master.MasterIsFix=0; actual.detail.DetailIsFix=0;
    const body=make(actual,'37-01',[{date:'2026-09-10',quantity:25}]); // Final45-current25: ADD delta20.
    const result=await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.saved,true);
    const detail=(await tQ(`SELECT OutQuantity,Cost,isFix FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0];
    assert.equal(Number(detail.OutQuantity),45);assert.equal(Number(detail.Cost),2500.1234);assert.equal(Boolean(detail.isFix),false);
    assert.equal(Number((await tQ(`SELECT od.OutQuantity FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
      WHERE om.OrderYear=N'2026' AND om.OrderWeek=N'37-01' AND om.CustKey=533 AND od.ProdKey=866`)).recordset[0].OutQuantity),20);
    assert.equal(Number((await tQ(`SELECT ShipmentQuantity FROM ShipmentDate WHERE SdateKey=119700`)).recordset[0].ShipmentQuantity),20,
      'untouched dates remain unchanged; requested quantity is final, never additive');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM StockHistory`)).recordset[0].c),0);
  });
  await rollbackScenario(pool, async tQ => {
    await tQ(`UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=6266; UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey=89892;
      DELETE OrderDetail WHERE OrderMasterKey=3701;`);
    const actual=fixtureActual('37-01',existingRows().map(row=>({...row,detailFixed:false})),25);
    actual.master.MasterIsFix=0;actual.detail.DetailIsFix=0;
    const result=await core.executeWeekdayDistributionApply(tQ,sql,make(actual,'37-01',[{date:'2026-09-10',quantity:0}]),user,dependencies);
    assert.equal(result.saved,true);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM OrderDetail WHERE OrderMasterKey=3701`)).recordset[0].c),0,
      'CANCEL with no order preserves order absence');
  });
  await rollbackScenario(pool, async tQ => {
    await tQ(`UPDATE Product SET Stock=10000 WHERE ProdKey=866;
      INSERT CustomerProdCost(CustKey,ProdKey,Cost) VALUES(533,866,700),(533,866,701);`);
    await expectCode(()=>core.executeWeekdayDistributionApply(tQ,sql,make(fixtureActual('37-02',[],null,10000),'37-02',
      [{date:'2026-09-15',quantity:7}]),user,dependencies),'ALLOCATION_SCOPE_UNVERIFIED');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentDetail WHERE ShipmentKey=6267`)).recordset[0].c),0);
  });
  await rollbackScenario(pool, async tQ => {
    await tQ(`UPDATE ShipmentDetail SET Amount=333,Vat=22,ShipmentDtm=CONVERT(datetime,'2026-09-13 00:00:00.000',121)
      WHERE SdetailKey=89892;`);
    const actual=fixtureActual('37-01',existingRows(),25);
    Object.assign(actual.detail,{DetailAmount:333,DetailVat:22,ShipmentTimestamp:'2026-09-13 00:00:00.000'});
    const read=async()=> (await tQ(`SELECT SdetailKey,OutQuantity,EstQuantity,Cost,Amount,Vat,isFix,
      CONVERT(nvarchar(23),ShipmentDtm,121) AS ShipmentTimestamp FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset;
    const before=await read();
    const body=make(actual,'37-01',[{date:'2026-09-10',quantity:5}]);
    const result=await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.saved,true);assert.deepEqual(await read(),before,'no-op preserves historical money and representative date exactly');
    const again={...body,operationId:crypto.randomUUID()};
    assert.equal((await core.executeWeekdayDistributionApply(tQ,sql,again,user,dependencies)).saved,true);
    assert.deepEqual(await read(),before,'same fresh final target under a new UUID is still physically unchanged');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentHistory`)).recordset[0].c),0);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM StockHistory`)).recordset[0].c),0);
  });
  console.log('PASS allocation: missing/existing master, CPC/zero cost, unfixed stock preservation, ADD/no-order delta, CANCEL/no-order, untouched dates, UUID replay, duplicate pricing rejection');
}

async function runScenarios(pool, core, gate, presence, keyAllocator) {
  const user = { userId:'fixture-user', userName:'Fixture User' };
  const dependencies = leaseDependencies(gate,presence);
  await runAllocationRegressions(pool,core,user,dependencies);

  await runCalendarRegressions(pool,core,user,dependencies);
  await runPrintCompatibilityRegressions(pool);
  await runNativeNullCustomerApplyRegressions(pool,core,user,dependencies);

  await rollbackScenario(pool, async (tQ) => {
    const operationId = crypto.randomUUID();
    const body = {operationId,reason:'same-week exact date move',custKey:533,changes:[{
      year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),
      dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],
    }]};
    const result = await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.saved,true); assert.equal(result.appliedCount,1);
    assert.equal((await tQ(`SELECT CONVERT(nvarchar(23),ShipmentDtm,121) Timestamp FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0].Timestamp,
      '2026-09-11 00:00:00.000','EXE day6 Friday wins over day1 Sunday');
    assert.equal(result.changes[0].after.detail.shipmentTimestamp,'2026-09-11 00:00:00.000','permanent audit preserves representative date');
    const dates = (await tQ(`SELECT CONVERT(varchar(10),ShipmentDtm,120) d,ShipmentQuantity,EstQuantity,Cost,Descr FROM ShipmentDate WHERE SdetailKey=89892 ORDER BY ShipmentDtm`)).recordset;
    assert.deepEqual(dates.map((row)=>[row.d,Number(row.ShipmentQuantity)]),[['2026-09-11',5],['2026-09-13',20]]);
    const preserved=dates.find((row)=>row.d==='2026-09-13');
    assert.equal(Number(preserved.EstQuantity),600); assert.equal(Number(preserved.Cost),2500.1234); assert.equal(preserved.Descr,'legacy-preserve');
    const history=(await tQ(`SELECT ChangeType,BeforeValue,AfterValue,CONVERT(varchar(23),ShipmentDtm,121) dt FROM ShipmentHistory ORDER BY ShipmentHistoryKey`)).recordset;
    assert.deepEqual(history.map((row)=>[row.ChangeType,row.BeforeValue,row.AfterValue]),[['삭제','5','0'],['신규','0','5']]);
    const replay=await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.deepEqual(replay,result);
    const status=await core.readWeekdayOperation(tQ,sql,{operationId,custKey:533});
    assert.deepEqual(status,result);
  });
  assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation`)).recordset[0].c),0,'scenario must roll back audit');

  await rollbackScenario(pool, async (tQ) => {
    await tQ(`UPDATE Product SET Stock=0.1234 WHERE ProdKey=866`);
    const operationId = crypto.randomUUID();
    const body = {operationId,reason:'no stock write preserves raw precision',custKey:533,changes:[{
      year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25,0.1234),
      dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],
    }]};
    const result = await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.saved,true);
    const stock = Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock);
    assert.equal(stock,0.1234,'delta=0 must not round untouched Product.Stock');
  });

  const beforePriceBlock = await businessFingerprint(pool);
  await rollbackScenario(pool, async (tQ) => {
    await tQ(`UPDATE ShipmentDate SET Cost=2000,Amount=272727,Vat=27273 WHERE SdateKey=119701`);
    const pricedRows = existingRows().map((row) => row.sdateKey === 119701
      ? {...row,cost:2000,amount:272727,vat:27273} : row);
    const operationId = crypto.randomUUID();
    const body = {operationId,reason:'mixed move and increase incompatible date price blocked',custKey:533,changes:[{
      year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',pricedRows,25),
      dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:6}],
    }]};
    await expectCode(
      () => core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies),
      'NEEDS_REDESIGN',
    );
  });
  assert.equal(await businessFingerprint(pool),beforePriceBlock,'price-policy failure must roll back every business row');

  const beforeInvalidSource = await businessFingerprint(pool);
  await rollbackScenario(pool, async (tQ) => {
    await tQ(`UPDATE ShipmentDetail SET Cost=0 WHERE SdetailKey=89892`);
    const invalidSourceActual = fixtureActual('37-01',existingRows(),25);
    invalidSourceActual.detail = {...invalidSourceActual.detail,DetailCost:0};
    const operationId = crypto.randomUUID();
    const body = {operationId,reason:'new target invalid source price blocked',custKey:533,changes:[
      {
        year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',
        expected:expectedFromActual(core,'37-01',invalidSourceActual),
        dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-13',quantity:0}],
      },
      {
        year:'2026',orderWeek:'37-02',prodKey:866,unit:'박스',
        expected:expected(core,'37-02',[],null),
        dates:[{date:'2026-09-15',quantity:25}],
      },
    ]};
    await expectCode(
      () => core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies),
      'NEEDS_REDESIGN',
    );
  });
  assert.equal(await businessFingerprint(pool),beforeInvalidSource,'invalid source price must roll back every business row');

  await query(pool,`INSERT dbo.WebErpEditLease(OrderYear,OrderWeek,CustKey,LeaseToken,OwnerUserId,OwnerName,
    ClientId,PageCode,BaselineDigest,Revision,ExpiresAt)
    VALUES(N'2026',N'37',533,N'foreign-token',N'other-user',N'Other',N'other-client',N'other-page',N'x',0,DATEADD(minute,5,SYSUTCDATETIME()))`);
  const leaseOperation=crypto.randomUUID();
  await assert.rejects(
    () => commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,{
      operationId:leaseOperation,reason:'foreign active lease conflict',custKey:533,changes:[{
        year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',
        expected:expected(core,'37-01',existingRows(),25),dates:[{date:'2026-09-10',quantity:4}],
      }],
    },user,dependencies)),
    (error)=>error?.code==='ERP_EDIT_LOCKED',
  );
  await query(pool,`DELETE dbo.WebErpEditLease WHERE OrderYear=N'2026' AND OrderWeek=N'37' AND CustKey=533`);
  assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`,{
    op:{type:sql.UniqueIdentifier,value:leaseOperation},
  })).recordset[0].c),0,'lease conflict rolls back operation reservation');

  {
    const before=await businessFingerprint(pool);
    const operationId=crypto.randomUUID();
    const body={operationId,reason:'date-level nonrepresentable split rollback',custKey:533,changes:[
      {year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),
        dates:[{date:'2026-09-13',quantity:19.9}]},
      {year:'2026',orderWeek:'37-02',prodKey:866,unit:'박스',expected:expected(core,'37-02',[],null),
        dates:[{date:'2026-09-15',quantity:0.05},{date:'2026-09-16',quantity:0.05}]},
    ]};
    await assert.rejects(
      () => commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies)),
      (error)=>error?.code==='UNIT_CONVERSION_ROUNDTRIP_FAILED',
    );
    assert.equal(await businessFingerprint(pool),before,'failure after an earlier plan write must roll back every row');
    assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`,{
      op:{type:sql.UniqueIdentifier,value:operationId},
    })).recordset[0].c),0);
  }

  {
    const before=await businessFingerprint(pool);
    const operationId=crypto.randomUUID();
    await query(pool,`UPDATE dbo.FixtureNativeCalcControl SET FailNext=1 WHERE ControlKey=1`);
    try {
      await assert.rejects(() => commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,{
        operationId,reason:'native failure rollback',custKey:533,changes:[{
          year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),
          dates:[{date:'2026-09-10',quantity:4}],
        }],
      },user,dependencies)));
    } finally {
      await query(pool,`UPDATE dbo.FixtureNativeCalcControl SET FailNext=0 WHERE ControlKey=1`);
    }
    assert.equal(await businessFingerprint(pool),before,'native calculator failure must roll back business/history rows');
    assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`,{
      op:{type:sql.UniqueIdentifier,value:operationId},
    })).recordset[0].c),0);
  }

  {
    const before=await businessFingerprint(pool);
    const operationId=crypto.randomUUID();
    await query(pool,`CREATE TRIGGER dbo.TR_FixtureWeekdayAuditFailure
      ON dbo.WebWeekdayDistributionChange INSTEAD OF INSERT AS
      THROW 51001,N'fixture audit failure',1;`);
    try {
      await assert.rejects(() => commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,{
        operationId,reason:'audit failure rollback',custKey:533,changes:[{
          year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),
          dates:[{date:'2026-09-10',quantity:4}],
        }],
      },user,dependencies)));
    } finally {
      await query(pool,`DROP TRIGGER IF EXISTS dbo.TR_FixtureWeekdayAuditFailure`);
    }
    assert.equal(await businessFingerprint(pool),before,'audit failure after native work must roll back every business row');
    assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`,{
      op:{type:sql.UniqueIdentifier,value:operationId},
    })).recordset[0].c),0);
  }

  await rollbackScenario(pool, async (tQ) => {
    await tQ(`INSERT dbo.ShipmentHistory(SdetailKey,ShipmentDtm,ChangeType,BeforeValue,AfterValue,Descr,ChangeID)
      VALUES(89893,GETDATE(),N'삭제',N'1',N'0',N'past deleted max key',N'fixture-user');
      UPDATE dbo.KeyNumbering SET LastKeyNo=89893 WHERE Category=N'ShipmentDetailKey';`);
    const operationId=crypto.randomUUID();
    const result=await core.executeWeekdayDistributionApply(
      tQ,sql,crossWeekBody(core,operationId,'history-safe detail key'),user,dependencies,
    );
    const target=(await tQ(`SELECT SdetailKey,OutQuantity FROM ShipmentDetail WHERE ShipmentKey=6267`)).recordset;
    assert.equal(target.length,1); assert.equal(Number(target[0].SdetailKey),89894);
    assert.equal(Number(target[0].OutQuantity),5);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentHistory h
      LEFT JOIN ShipmentDetail sd ON sd.SdetailKey=h.SdetailKey
      WHERE h.SdetailKey=89893 AND sd.SdetailKey IS NULL`)).recordset[0].c),1,'past history key remains unowned');
    const responseTarget=result.changes.find((row)=>row.orderWeek==='37-02');
    assert.equal(responseTarget.before.detailRows,0); assert.equal(responseTarget.before.detail,null);
    assert.equal(responseTarget.after.detail.sdetailKey,'89894');
    assert.equal(responseTarget.after.detail.outQuantity,'5');
    const audit=(await tQ(`SELECT BeforeJson,AfterJson FROM dbo.WebWeekdayDistributionChange
      WHERE OperationFK=@op AND [Week]='37-02'`,{op:{type:sql.UniqueIdentifier,value:operationId}})).recordset[0];
    assert.equal(JSON.parse(audit.BeforeJson).detail,null);
    assert.equal(JSON.parse(audit.AfterJson).detail.sdetailKey,'89894');
  });

  await rollbackScenario(pool, async (tQ) => {
    await tQ(`DELETE FROM OrderDetail WHERE OrderDetailKey=3702`);
    await expectCode(
      () => core.executeWeekdayDistributionApply(tQ,sql,crossWeekBody(core,crypto.randomUUID(),'missing positive target order'),user,dependencies),
      'NEEDS_REDESIGN',
    );
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM OrderDetail`)).recordset[0].c),1,'missing target order must not be recreated');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentDetail WHERE ShipmentKey=6267`)).recordset[0].c),0);
  });

  await rollbackScenario(pool, async (tQ) => {
    const operationId=crypto.randomUUID();
    const body=crossWeekBody(core,operationId);
    const result=await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.saved,true); assert.equal(result.appliedCount,2);
    const target=(await tQ(`SELECT sd.SdetailKey,sd.OutQuantity,sd.EstQuantity,sd.Cost,sd.isFix,
      d.SdateKey,d.ShipmentQuantity,d.EstQuantity DateEst,CONVERT(varchar(23),d.ShipmentDtm,121) dt
      FROM ShipmentDetail sd JOIN ShipmentDate d ON d.SdetailKey=sd.SdetailKey
      WHERE sd.ShipmentKey=6267 AND sd.ProdKey=866`)).recordset;
    assert.equal(target.length,1); assert.equal(Number(target[0].OutQuantity),5); assert.equal(Number(target[0].EstQuantity),150);
    assert.equal(Number(target[0].Cost),2500.1234); assert.equal(target[0].isFix,true); assert.equal(target[0].dt,'2026-09-15 00:00:00.000');
    assert.equal(Number((await tQ(`SELECT Stock FROM Product WHERE ProdKey=866`)).recordset[0].Stock),0,'pure transfer returns then consumes stock');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM OrderDetail`)).recordset[0].c),2,'target creation must preserve orders and create none');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionChange WHERE OperationFK=@op`,{op:{type:sql.UniqueIdentifier,value:operationId}})).recordset[0].c),2);
  });

  await rollbackScenario(pool, async (tQ) => {
    const operationId=crypto.randomUUID();
    const body={operationId,reason:'quantity zero cleanup',custKey:533,changes:[{
      year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),
      dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-13',quantity:0}],
    }]};
    const result=await core.executeWeekdayDistributionApply(tQ,sql,body,user,dependencies);
    assert.equal(result.saved,true);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0].c),0);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentDate WHERE SdetailKey=89892`)).recordset[0].c),0);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM OrderDetail`)).recordset[0].c),2,'cleanup preserves OrderDetail');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentHistory WHERE SdetailKey=89892`)).recordset[0].c),2);

    await tQ(`INSERT dbo.Customer(CustKey,CustName) VALUES(777,N'Other Customer');
      INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,
        BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
      VALUES(999,N'Other Product',N'Other Flower',N'Other Country',N'Other',N'박스',N'단',30,1,30,1000,0);
      INSERT dbo.ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
      VALUES(7770,N'2026',N'37-01',N'202637',777,0,0,1,N'fixture-user');`);
    const allocatedKeys=[];
    for (const relativePath of LEGACY_SHIPMENT_DETAIL_ALLOCATORS) {
      const localSafeNextKey=loadLocalSafeNextKey(relativePath,keyAllocator.safeNextShipmentDetailKey);
      const nextKey=await localSafeNextKey(tQ,'ShipmentDetail','SdetailKey');
      allocatedKeys.push(nextKey);
      await tQ(`INSERT dbo.ShipmentDetail
        (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
         BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
        VALUES(@sdk,7770,777,999,CONVERT(datetime,'2026-09-10 00:00:00.000',121),
          1,30,1,30,30,1000,27273,2727,0,@descr)`,{
        sdk:{type:sql.Int,value:nextKey},
        descr:{type:sql.NVarChar,value:relativePath},
      });
    }
    assert.deepEqual(allocatedKeys,[89893,89894,89895,89896],
      'all four local wrappers must reserve above the purged history key');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentDetail
      WHERE CustKey=777 AND ProdKey=999 AND SdetailKey>89892`)).recordset[0].c),4);
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentDetail WHERE SdetailKey=89892`)).recordset[0].c),0,
      'purged weekday detail key must never be reused');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentHistory h
      JOIN ShipmentDetail sd ON sd.SdetailKey=h.SdetailKey
      WHERE h.SdetailKey=89892 AND (sd.CustKey=777 OR sd.ProdKey=999)`)).recordset[0].c),0,
      'prior customer history must not attach to another customer/product');
    assert.equal(Number((await tQ(`SELECT COUNT(*) c FROM ShipmentHistory
      WHERE SdetailKey=89892 AND ChangeID=N'fixture-user'`)).recordset[0].c),2,
      'prior customer native history rows remain intact');
  });

  await convertShipmentDateToIdentity(pool);
  const identityMode=(await query(pool,`SELECT COLUMNPROPERTY(OBJECT_ID(N'dbo.ShipmentDate'),N'SdateKey','IsIdentity') mode`)).recordset[0].mode;
  assert.equal(Number(identityMode),1,'second phase must exercise real IDENTITY OUTPUT INTO');
  const committedOperationId=crypto.randomUUID();
  const committedBody={operationId:committedOperationId,reason:'committed replay evidence',custKey:533,changes:[{
    year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:expected(core,'37-01',existingRows(),25),
    dates:[{date:'2026-09-10',quantity:0},{date:'2026-09-11',quantity:5}],
  }]};
  const committed=await commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,committedBody,user,dependencies));
  const replayed=await commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,committedBody,user,dependencies));
  assert.deepEqual(replayed,committed,'committed operation must replay after reconnecting transaction');
  await assert.rejects(
    () => commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,committedBody,{userId:'other-user',userName:'Other'},dependencies)),
    (error)=>error?.code==='WEEKDAY_OPERATION_CONFLICT',
  );
  await assert.rejects(
    () => commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(tQ,sql,{...committedBody,reason:'different body'},user,dependencies)),
    (error)=>error?.code==='WEEKDAY_OPERATION_CONFLICT',
  );
  assert.equal(await core.readWeekdayOperation((statement,params)=>query(pool,statement,params),sql,{operationId:committedOperationId,custKey:999}),null,'wrong customer lookup is unknown');

  const concurrentOperationId=crypto.randomUUID();
  const concurrentExpected={
    detailRows:committed.changes[0].after.detailRows,
    shipmentOutQuantity:committed.changes[0].after.shipmentOutQuantity,
    shipmentDates:committed.changes[0].after.shipmentDates,
    snapshotDigest:committed.changes[0].after.snapshotDigest,
  };
  const concurrentBody={operationId:concurrentOperationId,reason:'concurrent same UUID serialization',custKey:533,changes:[{
    year:'2026',orderWeek:'37-01',prodKey:866,unit:'박스',expected:concurrentExpected,
    dates:[{date:'2026-09-11',quantity:0},{date:'2026-09-10',quantity:5}],
  }]};
  const tx1=new sql.Transaction(pool); const tx2=new sql.Transaction(pool);
  await tx1.begin();
  let firstConcurrent;
  try {
    firstConcurrent=await core.executeWeekdayDistributionApply(tQuery(tx1),sql,concurrentBody,user,dependencies);
    await tx2.begin();
    const contender=await core.executeWeekdayDistributionApply(tQuery(tx2),sql,concurrentBody,user,dependencies)
      .then((value)=>({value}), (error)=>({error}));
    assert.equal(contender.error?.code,'STOCK_GATE_BUSY','concurrent writer must fail before business writes');
    await tx2.rollback();
    await tx1.commit();
    const secondConcurrent=await commitScenario(pool,(tQ)=>core.executeWeekdayDistributionApply(
      tQ,sql,concurrentBody,user,dependencies,
    ));
    assert.deepEqual(secondConcurrent,firstConcurrent,'concurrent same UUID replays the committed response exactly once');
  } catch (error) {
    await tx1.rollback().catch(()=>{}); await tx2.rollback().catch(()=>{}); throw error;
  }
  assert.equal(Number((await query(pool,`SELECT COUNT(*) c FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`,{
    op:{type:sql.UniqueIdentifier,value:concurrentOperationId},
  })).recordset[0].c),1);
  console.log('PASS: weekday distribution actual core on isolated MSSQL (lease/key/unit/native/audit rollback + IDENTITY commit/reconnect/concurrency replay)');
}

async function main() {
  const fixture=inspectFixture();
  const dbName=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;
  assertDbName(dbName);
  let master; let pool;
  try {
    master=await new sql.ConnectionPool({user:'sa',password:fixture.password,server:HOST,port:PORT,database:'master',options:{encrypt:false,trustServerCertificate:true},pool:{max:2,min:0}}).connect();
    await query(master,`CREATE DATABASE ${bracket(dbName)}`);
    await query(master,`ALTER DATABASE ${bracket(dbName)} SET COMPATIBILITY_LEVEL=130`);
    pool=await new sql.ConnectionPool({user:'sa',password:fixture.password,server:HOST,port:PORT,database:dbName,options:{encrypt:false,trustServerCertificate:true},pool:{max:4,min:0}}).connect();
    await installSchema(pool); await seed(pool);
    for (const name of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD']) {
      if (process.env[name]) fail(`operational ${name} must not be present in the isolated fixture process`);
    }
    const core=await import(pathToFileURL(path.join(ROOT,'lib','weekdayDistributionApply.js')).href);
    const gate=await import(pathToFileURL(path.join(ROOT,'lib','estimateDirectionalQuantity.js')).href);
    const presence=await import(pathToFileURL(path.join(ROOT,'lib','erpEditPresence.js')).href);
    const keyAllocator=await import(pathToFileURL(path.join(ROOT,'lib','safeNextKey.js')).href);
    const mode=(await query(pool,`SELECT COLUMNPROPERTY(OBJECT_ID(N'dbo.ShipmentDate'),N'SdateKey','IsIdentity') mode`)).recordset[0].mode;
    assert.equal(Number(mode),0,'fixture intentionally exercises non-IDENTITY safeNextKey');
    console.log(`SETUP: image=${fixture.image}, host=${HOST}:${PORT}, db=${dbName}, ShipmentDateIdentity=${mode}`);
    await runScenarios(pool,core,gate,presence,keyAllocator);
  } finally {
    await pool?.close().catch(()=>{});
    if (master) {
      await query(master,`IF DB_ID(N'${dbName}') IS NOT NULL BEGIN ALTER DATABASE ${bracket(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${bracket(dbName)}; END`).catch(()=>{});
    }
    await master?.close().catch(()=>{});
  }
}

module.exports = { inspectFixture, assertDbName, bracket, query, tQuery, installSchema, seed, leaseDependencies };
if (require.main === module) main().catch((error)=>{ console.error(error.stack||error.message); process.exitCode=1; });
