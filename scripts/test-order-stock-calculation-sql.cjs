#!/usr/bin/env node
/*
 * Real SQL Server fixture for lib/orderStockCalculation.js. This deliberately
 * imports the helper source through a data URL: its actual implementation runs
 * against a new, isolated database and transaction-bound mssql requests.
 *
 * Usage: node scripts/test-order-stock-calculation-sql.cjs
 * No .env, app pool, production database, or keep-database option is supported.
 * The only database ever dropped is the unique fixture database created here.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const DB_PREFIX = 'NenovaEstimateFixture_';
const SCHEMA_FILE = path.join(REPO_ROOT, '__tests__', 'fixtures', 'estimateDirectionalSchema.sql');
const HELPER_FILE = path.join(REPO_ROOT, 'lib', 'orderStockCalculation.js');
const PROCEDURES_FILE = path.join(REPO_ROOT, '__tests__', 'fixtures', 'orderStockCalculationNative.sql');
const YEAR = '2026';
const WEEK = '40-01';
const USER_ID = 'fixture-order-stock';
const LONG_DELAY = '00:00:12';

function fail(message) {
  throw new Error(`[order-stock-calculation-sql-fixture] ${message}`);
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function parseArgs(argv) {
  if (argv.length === 3 && (argv[2] === '--help' || argv[2] === '-h')) return { help: true };
  if (argv.length !== 2) fail('no arguments are accepted (especially no database, host, or credential overrides)');
  return { help: false };
}

function usage() {
  console.log('Usage: node scripts/test-order-stock-calculation-sql.cjs');
  console.log('Creates and drops one fresh NenovaEstimateFixture_* database on the approved loopback SQL2022 container.');
}

function inspectApprovedContainer() {
  const result = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail('approved SQL fixture container is not inspectable');
  let info;
  try { info = JSON.parse(result.stdout)[0]; } catch { fail('container inspect response is invalid'); }
  ensure(info && info.Name === `/${CONTAINER}`, 'container name guard failed');
  ensure(info.State?.Running === true, 'approved fixture container is not running');
  ensure(/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(String(info.Config?.Image || '')),
    'container image is not official SQL Server 2022');
  ensure((info.Mounts || []).length === 0 && (info.HostConfig?.Binds || []).length === 0,
    'fixture container has a mount; refusing to connect');
  const portBindings = info.HostConfig?.PortBindings || {};
  const published = Object.entries(portBindings).flatMap(([containerPort, bindings]) =>
    (bindings || []).map(binding => ({ containerPort, ...binding })));
  ensure(Object.keys(portBindings).every(containerPort => containerPort === '1433/tcp')
    && published.length === 1 && published[0].HostIp === HOST
    && String(published[0].HostPort) === String(PORT),
  'fixture must have exactly one published port, 1433/tcp on the approved loopback endpoint');
  const env = new Map((info.Config?.Env || []).map(entry => {
    const at = String(entry).indexOf('=');
    return [at < 0 ? String(entry) : entry.slice(0, at), at < 0 ? '' : entry.slice(at + 1)];
  }));
  const password = env.get('MSSQL_SA_PASSWORD');
  ensure(typeof password === 'string' && password.length > 0, 'fixture SA credential is unavailable');
  // Never print or otherwise expose the secret; it remains in this function's return path only.
  return { password, image: info.Config.Image };
}

function assertFixtureDatabaseName(name) {
  ensure(/^NenovaEstimateFixture_[0-9]{8}_[0-9a-f]{12}$/.test(name), 'fixture database name guard failed');
}

function newDatabaseName() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `${DB_PREFIX}${date}_${crypto.randomBytes(6).toString('hex')}`;
  assertFixtureDatabaseName(name);
  return name;
}

function bracketFixtureDatabase(name) {
  assertFixtureDatabaseName(name);
  return `[${name}]`;
}

function splitBatches(source) {
  return source.split(/^\s*GO\s*;?\s*$/gim).map(batch => batch.trim()).filter(Boolean);
}

function loadInputs() {
  for (const file of [SCHEMA_FILE, HELPER_FILE, PROCEDURES_FILE]) {
    ensure(fs.existsSync(file), `required fixture input is missing: ${path.relative(REPO_ROOT, file)}`);
  }
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  ensure(schema.includes("DB_NAME() NOT LIKE N'NenovaEstimateFixture[_]%'")
    && schema.includes('CREATE TABLE dbo.NenovaStockWeekGate')
    && schema.includes('CREATE TABLE dbo.ProductStock'), 'fixture schema safety/stock markers are missing');
  const helperSource = fs.readFileSync(HELPER_FILE, 'utf8');
  ensure(helperSource.includes('export async function runOrderStockCalculationBatch')
    && helperSource.includes('dbo.usp_NenovaStockWeekGateCapability')
    && helperSource.includes('dbo.usp_StockCalculation'), 'actual order-stock helper API/SQL markers are missing');
  const nativeSql = fs.readFileSync(PROCEDURES_FILE, 'utf8');
  const procedures = new Map();
  for (const name of ['usp_NenovaStockWeekGateEnter', 'usp_NenovaStockWeekGateLeave', 'usp_StockCalculation']) {
    const declaration = new RegExp(`\\bCREATE\\s+(?:OR\\s+ALTER\\s+)?PROCEDURE\\s+(?:(?:dbo|\\[dbo\\])\\.)?\\[?${name}\\]?`, 'i');
    const definition = splitBatches(nativeSql).find(batch => declaration.test(batch));
    ensure(typeof definition === 'string' && definition.trim().length > 0, `native SQL fixture procedure missing: ${name}`);
    procedures.set(name, definition);
  }
  ensure(!/NenovaStockWeekGateCapability/.test(procedures.get('usp_NenovaStockWeekGateEnter')),
    'fixture capability must stay a fixture-only stub');
  ensure(procedures.get('usp_StockCalculation').includes('usp_NenovaStockWeekGateEnter')
    && procedures.get('usp_StockCalculation').includes('usp_NenovaStockWeekGateLeave'),
  'native procedure must be the artifact definition with native gate enter/leave');
  return { schema, helperSource, procedures };
}

function request(executor, params = {}, timeoutMs = 60000) {
  const req = new sql.Request(executor);
  req.timeout = timeoutMs;
  for (const [name, spec] of Object.entries(params)) req.input(name, spec.type, spec.value);
  return req;
}

function query(executor, statement, params = {}, timeoutMs = 60000) {
  return request(executor, params, timeoutMs).query(statement);
}

async function runTransaction(pool, fn, { requestTimeout = 60000, onOptions } = {}) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  let committed = false;
  try {
    const value = await fn(async (statement, params = {}) => query(tx, statement, params, requestTimeout));
    await tx.commit();
    committed = true;
    return value;
  } finally {
    if (!committed) await tx.rollback().catch(() => {});
    onOptions?.();
  }
}

async function installActualProcedures(pool, procedures) {
  for (const name of ['usp_NenovaStockWeekGateEnter', 'usp_NenovaStockWeekGateLeave', 'usp_StockCalculation']) {
    await query(pool, `IF OBJECT_ID(N'dbo.${name}',N'P') IS NOT NULL DROP PROCEDURE dbo.${name};`);
    await query(pool, procedures.get(name));
  }
  // The capability body intentionally remains the fixture schema's V2/ready stub.
  const ready = await query(pool, 'EXEC dbo.usp_NenovaStockWeekGateCapability;');
  ensure(Number(ready.recordset?.[0]?.ProtocolVersion) === 2
    && (ready.recordset?.[0]?.IsReady === true || Number(ready.recordset?.[0]?.IsReady) === 1),
  'fixture capability stub must report V2/ready');
}

async function installNativeStub(pool, body) {
  await query(pool, `IF OBJECT_ID(N'dbo.usp_StockCalculation',N'P') IS NOT NULL DROP PROCEDURE dbo.usp_StockCalculation;`);
  await query(pool, `CREATE PROCEDURE dbo.usp_StockCalculation
    @OrderYear nvarchar(20), @OrderWeek nvarchar(20), @ProdKey int, @iUserID nvarchar(20),
    @oResult int OUTPUT, @oMessage nvarchar(max) OUTPUT
    AS BEGIN SET NOCOUNT ON; ${body} END;`);
}

async function seedFixture(pool) {
  await query(pool, `
    DELETE FROM dbo.ShipmentDetail;
    DELETE FROM dbo.ShipmentMaster;
    DELETE FROM dbo.WarehouseDetail;
    DELETE FROM dbo.WarehouseMaster;
    DELETE FROM dbo.StockHistory;
    DELETE FROM dbo.ProductStock;
    DELETE FROM dbo.StockMaster;
    DELETE FROM dbo.Product;
    DELETE FROM dbo.FixtureAudit;
    UPDATE dbo.NenovaStockWeekGate SET Mode=NULL,LockedAt=NULL,Action=NULL,OrderYear=NULL,OrderWeek=NULL,
      OwnerSessionID=NULL,OwnerToken=NULL,PendingCalc=0,CalcProdKey=NULL,ProtocolVersion=2 WHERE GateKey='1';
    UPDATE dbo.FixtureNativeCalcControl SET FailNext=0,NullNext=0 WHERE ControlKey=1;
    INSERT dbo.Product (ProdKey,ProdName,Stock,isDeleted) VALUES
      (1001,N'fixture product one',100,0),(1002,N'fixture product two',100,0);
    INSERT dbo.StockMaster (StockKey,OrderYear,OrderWeek,OrderYearWeek,Descr,isFix,CreateID)
      VALUES (2501,N'2025',N'40-01',N'20254001',N'fixture prior-year same week',1,N'fixture'),
             (2601,N'2026',N'40-01',N'20264001',N'fixture selected week',1,N'fixture'),
             (2701,N'2027',N'01-01',N'20270101',N'fixture future-year cascade',1,N'fixture');
    INSERT dbo.ProductStock (StockKey,ProdKey,Stock)
      VALUES (2501,1001,5),(2501,1002,8),(2601,1001,90),(2601,1002,90),
             (2701,1001,91),(2701,1002,91);
    INSERT dbo.WarehouseMaster (WarehouseKey,OrderYear,OrderWeek,UploadDtm,FileName,isDeleted)
      VALUES (2601,N'2026',N'40-01','2026-10-01',N'fixture-2026.xlsx',0),
             (2701,N'2027',N'01-01','2027-01-01',N'fixture-2027.xlsx',0);
    INSERT dbo.WarehouseDetail (WdetailKey,WarehouseKey,ProdKey,FarmKey,BoxQuantity,BunchQuantity,SteamQuantity,
      OutQuantity,EstQuantity,UPrice,TPrice,SteamOf1Box,SteamOf1Bunch)
      VALUES (2601,2601,1001,NULL,0,10,10,10,10,1,10,1,1),
             (2602,2601,1002,NULL,0,2,2,2,2,1,2,1,1),
             (2701,2701,1001,NULL,0,3,3,3,3,1,3,1,1);
    INSERT dbo.ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID)
      VALUES (2601,N'2026',N'40-01',N'20264001',1,1,0,1,N'fixture');
    INSERT dbo.ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,OutQuantity,EstQuantity,BoxQuantity,
      BunchQuantity,SteamQuantity,Cost,Amount,Vat,Descr,ShipmentDtm,isFix)
      VALUES (2601,2601,1,1001,2,2,0,2,2,1,2,0,N'fixture fixed shipment','2026-10-01',1);
  `);
}

async function readGate(pool) {
  const result = await query(pool, `SELECT GateKey,Mode,LockedAt,Action,OrderYear,OrderWeek,OwnerSessionID,
    OwnerToken,PendingCalc,CalcProdKey,ProtocolVersion FROM dbo.NenovaStockWeekGate WHERE GateKey='1';`);
  return result.recordset?.[0] || null;
}

function assertIdle(gate, label) {
  ensure(gate && ['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey']
    .every(key => gate[key] === null) && (gate.PendingCalc === false || gate.PendingCalc === 0)
    && Number(gate.ProtocolVersion) === 2, `${label}: gate is not completely idle`);
}

async function tableRows(pool, table, orderBy) {
  const result = await query(pool, `SELECT * FROM dbo.[${table}] ORDER BY ${orderBy};`);
  return result.recordset;
}

async function stockSnapshot(pool) {
  return {
    productStock: await tableRows(pool, 'ProductStock', 'StockKey,ProdKey'),
    stockMaster: await tableRows(pool, 'StockMaster', 'StockKey'),
    product: await tableRows(pool, 'Product', 'ProdKey'),
    shipment: await tableRows(pool, 'ShipmentDetail', 'SdetailKey'),
    warehouse: await tableRows(pool, 'WarehouseDetail', 'WdetailKey'),
    history: await tableRows(pool, 'StockHistory', 'StockHistoryKey'),
  };
}

function loadActualHelper(source) {
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  return import(url);
}

function makeWithTransaction(pool, options = {}) {
  const requestTimeout = options.requestTimeout ?? 60000;
  const state = { calls: 0, retries: [], nativeBatchRequests: 0, nativeBatchTimeouts: [] };
  const withTransactionFn = async (callback, txOptions = {}) => {
    state.calls += 1;
    state.retries.push(txOptions.retries);
    ensure(txOptions.retries === 0, 'helper must request retries: 0 for the whole calculation batch');
    return runTransaction(pool, async tQuery => callback(async (statement, params = {}) => {
      if (/@products\s+TABLE/i.test(statement)) {
        state.nativeBatchRequests += 1;
        state.nativeBatchTimeouts.push(requestTimeout);
      }
      return tQuery(statement, params);
    }), { requestTimeout });
  };
  return { withTransactionFn, state };
}

async function runHelper(helper, pool, input = {}, options = {}) {
  const wrapped = makeWithTransaction(pool, options);
  const result = await helper.runOrderStockCalculationBatch({
    withTransactionFn: wrapped.withTransactionFn,
    types: sql,
    orderYear: YEAR,
    orderWeek: WEEK,
    uid: USER_ID,
    prodKeys: [1001],
    ...input,
  });
  return { result, state: wrapped.state };
}

async function expectReject(fn, code, label) {
  let caught;
  try { await fn(); } catch (error) { caught = error; }
  ensure(caught, `${label}: expected rejection`);
  if (code) ensure(caught.code === code, `${label}: expected ${code}, received ${caught.code || 'uncoded error'}`);
  return caught;
}

async function testSuccessAndCrossYearCascade(helper, pool) {
  await seedFixture(pool);
  const preserved = await stockSnapshot(pool);
  const { result, state } = await runHelper(helper, pool, { prodKeys: [1001, 1001, 1002] });
  ensure(Array.isArray(result) && result.length === 2, 'success returns one native result per distinct product');
  ensure(result[0].ProdKey === 1001 && result[1].ProdKey === 1002, 'native result rows preserve requested product ordering');
  ensure(result.every(row => row.result === 0 && row.returnCode === 0 && row.GateIdle && row.MarkerHeld),
    'success rows must report explicit native return/output and same-transaction gate markers');
  ensure(state.calls === 1 && state.retries.length === 1 && state.nativeBatchRequests === 1,
    'all products must execute in one transaction and one native SQL request with retries disabled');
  ensure(state.nativeBatchTimeouts[0] === 60000,
    'production-like fixture success must keep the existing 60000ms single-request timeout');
  const after = await stockSnapshot(pool);
  ensure(after.productStock.find(row => row.StockKey === 2601 && row.ProdKey === 1001)?.Stock === 13,
    'native fixture math: selected-year ProductStock includes previous stock + receipt - fixed shipment');
  ensure(after.productStock.find(row => row.StockKey === 2701 && row.ProdKey === 1001)?.Stock === 16,
    'legitimate 2027 ProductStock cascade across year boundary is retained');
  ensure(after.productStock.find(row => row.StockKey === 2601 && row.ProdKey === 1002)?.Stock === 10,
    'second product native calculation is applied');
  ensure(after.productStock.find(row => row.StockKey === 2501 && row.ProdKey === 1001)?.Stock === 5,
    '2025 same-week sentinel remains distinct and unchanged');
  for (const table of ['stockMaster','product','shipment','warehouse','history']) {
    assert.deepEqual(after[table], preserved[table], `native success must preserve unrelated ${table} fixture rows`);
  }
  assertIdle(await readGate(pool), 'successful batch');
  console.log('ok - actual helper success, one batched native request, idle gate, 2025 sentinel, and 2027 cascade');
}

async function enterFixtureGate(pool, { action = 'CALC', year = YEAR, week = WEEK, prodKey = 0 } = {}) {
  const result = await query(pool, `DECLARE @r int,@m nvarchar(200),@token uniqueidentifier;
    EXEC dbo.usp_NenovaStockWeekGateEnter @Action=@action,@OrderYear=@year,@OrderWeek=@week,
      @oResult=@r OUTPUT,@oMessage=@m OUTPUT,@ProtocolVersion=2,@OwnerToken=@token OUTPUT,@CalcProdKey=@prod;
    SELECT @r AS result,@m AS message,@token AS OwnerToken;`, {
    action: { type: sql.NVarChar, value: action }, year: { type: sql.NVarChar, value: year },
    week: { type: sql.NVarChar, value: week }, prod: { type: sql.Int, value: prodKey },
  });
  return result.recordset?.[0] || {};
}

async function testBusyGateAndNativeBusy(helper, pool) {
  await seedFixture(pool);
  const entered = await enterFixtureGate(pool, { prodKey: 1001 });
  ensure(Number(entered.result) === 0 && entered.OwnerToken, 'fixture native gate owner must enter');
  const before = await stockSnapshot(pool);
  const gateBefore = await readGate(pool);
  await expectReject(() => runHelper(helper, pool), 'STOCK_GATE_BUSY', 'helper with foreign RUN gate');
  const direct = await query(pool, `DECLARE @r int,@m nvarchar(max),@rc int;
    EXEC @rc=dbo.usp_StockCalculation @OrderYear=@year,@OrderWeek=@week,@ProdKey=1001,@iUserID=@uid,
      @oResult=@r OUTPUT,@oMessage=@m OUTPUT;
    SELECT @rc AS returnCode,@r AS result,@m AS message;`, {
    year: { type: sql.NVarChar, value: YEAR }, week: { type: sql.NVarChar, value: WEEK },
    uid: { type: sql.NVarChar, value: USER_ID },
  });
  const nativeResult = direct.recordset?.[0] || {};
  ensure(Number(nativeResult.result) !== 0, 'native CALC must refuse an already-owned gate');
  assert.deepEqual(await stockSnapshot(pool), before, 'busy native/helper path must not persist stock changes');
  assert.deepEqual(await readGate(pool), gateBefore, 'busy native/helper path must leave the foreign owner untouched');
  console.log('ok - foreign RUN gate is unchanged; both helper and native CALC refuse the busy gate');
}

async function testMissingNativeResultRollback(helper, pool) {
  await installNativeStub(pool, `
    DECLARE @gateResult int,@gateMessage nvarchar(200),@owner uniqueidentifier,@calcProd int=ISNULL(@ProdKey,0);
    EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'CALC',@OrderYear=@OrderYear,@OrderWeek=@OrderWeek,
      @oResult=@gateResult OUTPUT,@oMessage=@gateMessage OUTPUT,@ProtocolVersion=2,
      @OwnerToken=@owner OUTPUT,@CalcProdKey=@calcProd;
    IF @gateResult<>0 THROW 51070,'fixture native busy',1;
    SET @oResult=NULL; SET @oMessage=NULL; RETURN 0;`);
  await seedFixture(pool);
  const before = await stockSnapshot(pool);
  await expectReject(() => runHelper(helper, pool), null, 'native null output result');
  assert.deepEqual(await stockSnapshot(pool), before, 'missing native output must roll back the complete stock fixture');
  assertIdle(await readGate(pool), 'missing native output rollback');
  console.log('ok - fixture native stub with missing output is rejected and transaction rollback restores idle gate');
}

async function testAttentionRollsBackAfterNativeEnter(helper, pool) {
  await installNativeStub(pool, `
    DECLARE @gateResult int,@gateMessage nvarchar(200),@owner uniqueidentifier,@calcProd int=ISNULL(@ProdKey,0);
    EXEC dbo.usp_NenovaStockWeekGateEnter @Action=N'CALC',@OrderYear=@OrderYear,@OrderWeek=@OrderWeek,
      @oResult=@gateResult OUTPUT,@oMessage=@gateMessage OUTPUT,@ProtocolVersion=2,
      @OwnerToken=@owner OUTPUT,@CalcProdKey=@calcProd;
    IF @gateResult<>0 THROW 51071,'fixture native busy before attention',1;
    INSERT dbo.FixtureAudit (AuditKey,ActionName,OwnerToken,Detail)
      VALUES (9001,N'fixture-before-attention',CONVERT(nvarchar(100),@owner),N'must rollback');
    WAITFOR DELAY '${LONG_DELAY}';
    SET @oResult=0; SET @oMessage=N'fixture delay completed'; RETURN 0;`);
  await seedFixture(pool);
  const before = await stockSnapshot(pool);
  await expectReject(() => runHelper(helper, pool, {}, { requestTimeout: 1500 }), null, 'SQL attention after native gate enter');
  assert.deepEqual(await stockSnapshot(pool), before, 'SQL attention must roll back every native/fixture write');
  assertIdle(await readGate(pool), 'SQL attention rollback');
  const audit = await query(pool, `SELECT COUNT(*) AS count FROM dbo.FixtureAudit WHERE AuditKey=9001;`);
  ensure(Number(audit.recordset?.[0]?.count) === 0, 'SQL attention must not persist the in-transaction marker row');
  console.log('ok - SQLATTENTION after fixture native gate enter rolls back the outer transaction to idle');
}

async function testSecondProductNativeRollback(helper, pool, procedures) {
  await installActualProcedures(pool, procedures);
  await seedFixture(pool);
  await query(pool, `CREATE TRIGGER dbo.FixtureFailSecondProduct ON dbo.ProductStock AFTER UPDATE,INSERT AS
    BEGIN SET NOCOUNT ON; IF EXISTS(SELECT 1 FROM inserted WHERE ProdKey=1002)
      THROW 51072,'fixture second-product native failure',1; END;`);
  const before = await stockSnapshot(pool);
  await expectReject(() => runHelper(helper, pool, { prodKeys: [1001, 1002] }), null, 'second native product failure');
  await query(pool, 'DROP TRIGGER dbo.FixtureFailSecondProduct;');
  assert.deepEqual(await stockSnapshot(pool), before, 'second-product native CATCH ROLLBACK must undo first product and all later-year snapshots');
  assertIdle(await readGate(pool), 'second-product native rollback');
  console.log('ok - actual native CATCH rollback on product 2 undoes product 1 and future-year ProductStock');
}

async function testRollbackDelayedLeaveCannotClearNewOwner(pool, procedures, connectionConfig) {
  await installActualProcedures(pool, procedures);
  await seedFixture(pool);
  const config = { ...connectionConfig, pool: { min: 1, max: 1, idleTimeoutMillis: 60000 } };
  const first = await new sql.ConnectionPool(config).connect();
  const second = await new sql.ConnectionPool(config).connect();
  let firstTx;
  try {
    firstTx = new sql.Transaction(first);
    await firstTx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    const old = await enterFixtureGate(firstTx, { prodKey: 1001 });
    ensure(Number(old.result) === 0 && old.OwnerToken, 'old owner must enter within transaction A');
    await firstTx.rollback();
    firstTx = null;

    const next = await enterFixtureGate(second, { prodKey: 1002 });
    ensure(Number(next.result) === 0 && next.OwnerToken && String(next.OwnerToken) !== String(old.OwnerToken),
      'new owner B must acquire a new owner token after A rollback');
    const newOwnerState = await readGate(second);
    const staleLeave = await query(first, `DECLARE @r int,@token uniqueidentifier=CONVERT(uniqueidentifier,@owner);
      EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'CALC',@Success=0,@ProtocolVersion=2,
        @OwnerToken=@token,@oResult=@r OUTPUT; SELECT @r AS result;`, {
      owner: { type: sql.NVarChar, value: String(old.OwnerToken) },
    });
    ensure(Number(staleLeave.recordset?.[0]?.result) === -97, 'delayed stale leave must be a zero-row no-op');
    assert.deepEqual(await readGate(second), newOwnerState, 'rollback-all delayed leave cannot clear transaction B owner');
    const released = await query(second, `DECLARE @r int,@token uniqueidentifier=CONVERT(uniqueidentifier,@owner);
      EXEC dbo.usp_NenovaStockWeekGateLeave @Action=N'CALC',@Success=1,@ProtocolVersion=2,
        @OwnerToken=@token,@oResult=@r OUTPUT; SELECT @r AS result;`, {
      owner: { type: sql.NVarChar, value: String(next.OwnerToken) },
    });
    ensure(Number(released.recordset?.[0]?.result) === 0, 'current owner B must release its own gate');
    assertIdle(await readGate(second), 'delayed-leave lifecycle cleanup');
  } finally {
    if (firstTx) await firstTx.rollback().catch(() => {});
    await first.close().catch(() => {});
    await second.close().catch(() => {});
  }
  console.log('ok - fixture lifecycle replay: ROLLBACK-all, new owner enter, delayed old Leave cannot clear it');
}

async function testInputGuardsAndEmptyInput(helper, pool) {
  await seedFixture(pool);
  const before = await stockSnapshot(pool);
  const empty = await runHelper(helper, pool, { prodKeys: [] });
  ensure(Array.isArray(empty.result) && empty.result.length === 0 && empty.state.calls === 0,
    'empty changed-product list returns [] without opening a transaction');
  for (const input of [
    { orderYear: '2025' }, { orderWeek: '40-01-extra' }, { prodKeys: [0] }, { prodKeys: [-1] },
    { prodKeys: [2147483648] }, { prodKeys: [1.5] },
  ]) {
    await expectReject(() => runHelper(helper, pool, input), 'STOCK_CALC_SCOPE_INVALID', `invalid scope ${JSON.stringify(input)}`);
  }
  assert.deepEqual(await stockSnapshot(pool), before, 'invalid scope and empty input must not mutate fixture ledgers');
  assertIdle(await readGate(pool), 'input validation');
  console.log('ok - empty and invalid year/week/product scopes issue no stock mutations');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }

  // Validate every local input and the isolated container before opening SQL connections.
  const inputs = loadInputs();
  const helper = await loadActualHelper(inputs.helperSource);
  ensure(typeof helper.runOrderStockCalculationBatch === 'function', 'data-URL-loaded helper export is missing');
  const { password, image } = inspectApprovedContainer();
  const database = newDatabaseName();
  let master;
  let pool;
  let created = false;
  try {
    master = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database: 'master',
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { min: 0, max: 2, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 15000 }).connect();
    await query(master, `CREATE DATABASE ${bracketFixtureDatabase(database)};`);
    created = true;
    await query(master, `ALTER DATABASE ${bracketFixtureDatabase(database)} SET COMPATIBILITY_LEVEL=130;`);
    pool = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { min: 0, max: 8, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 60000 }).connect();

    for (const batch of splitBatches(inputs.schema)) await query(pool, batch);
    await installActualProcedures(pool, inputs.procedures);
    const initial = await query(pool, `SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME();`);
    ensure(Number(initial.recordset?.[0]?.compatibility_level) === 130, 'fixture database compatibility must be 130');
    console.log(`SETUP: image=${image}, endpoint=${HOST}:${PORT}, database=${database}, compatibility=130, nativeSource=repo-fixture`);

    await testInputGuardsAndEmptyInput(helper, pool);
    await testSuccessAndCrossYearCascade(helper, pool);
    await testBusyGateAndNativeBusy(helper, pool);
    await installActualProcedures(pool, inputs.procedures);
    await testMissingNativeResultRollback(helper, pool);
    await testAttentionRollsBackAfterNativeEnter(helper, pool);
    await testSecondProductNativeRollback(helper, pool, inputs.procedures);
    await testRollbackDelayedLeaveCannotClearNewOwner(pool, inputs.procedures, {
      user: 'sa', password, server: HOST, port: PORT, database,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      connectionTimeout: 5000, requestTimeout: 15000,
    });

    console.log('PASS: isolated SQL stock-calculation fixture scenarios completed; final-upload skip remains main API-test scope.');
  } finally {
    await pool?.close().catch(() => {});
    if (master && created) {
      // This name is the exact unique fixture database created by this invocation.
      await query(master, `ALTER DATABASE ${bracketFixtureDatabase(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE ${bracketFixtureDatabase(database)};`).catch(error => {
        console.error(`FIXTURE_CLEANUP_FAILED: database=${database}; ${error.message}`);
        process.exitCode = 1;
      });
    }
    await master?.close().catch(() => {});
  }
}

main().catch(error => {
  // SQL driver errors may include query text but never credentials; do not dump config objects.
  console.error(error?.message || 'fixture failed');
  process.exitCode = 1;
});
