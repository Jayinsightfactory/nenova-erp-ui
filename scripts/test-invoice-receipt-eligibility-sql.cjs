#!/usr/bin/env node
/*
 * Isolated read-only SQL fixture for lib/invoiceReceiptEligibility.js.
 * This executes the web eligibility SELECT only; it does NOT execute a native SP,
 * perform receipt writes, connect to a production database, or load app configuration.
 * Native comparison reference: C:/Users/USER/nenova-decompiled/Nenova/CommonLogic.cs:395-565.
 * The only database dropped is the unique NenovaInvoiceFixture_* database created here.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');

const REPO_ROOT = path.resolve(__dirname, '..');
const HELPER_FILE = path.join(REPO_ROOT, 'lib', 'invoiceReceiptEligibility.js');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const HOST = '127.0.0.1';
const PORT = 14339;
const DB_PREFIX = 'NenovaInvoiceFixture_';
const SENTINEL_TABLES = [
  'WarehouseMaster', 'WarehouseDetail', 'TempWarehouseDetail', 'KeyNumbering',
  'ShipmentMaster', 'ShipmentDetail', 'ProductStock', 'StockHistory',
];
const MAIN_SCOPE = { orderYear: '2026', orderWeek: '41-01', prodKeys: [101] };
const VIEW_SQL = `CREATE VIEW dbo.ViewShipment AS
  SELECT OrderYearWeek2,CountryFlower,ProdKey,ProdName,DetailFix,OutQuantity,CustKey
  FROM dbo.ShipmentFixture;`;

function fail(message) {
  throw new Error(`[invoice-receipt-eligibility-sql-fixture] ${message}`);
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
  console.log('Usage: node scripts/test-invoice-receipt-eligibility-sql.cjs');
  console.log('Creates and drops one fresh NenovaInvoiceFixture_* database on the approved loopback SQL2022 container.');
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
  const bindings = info.HostConfig?.PortBindings || {};
  const published = Object.entries(bindings).flatMap(([containerPort, items]) =>
    (items || []).map(item => ({ containerPort, ...item })));
  ensure(Object.keys(bindings).every(containerPort => containerPort === '1433/tcp')
    && published.length === 1 && published[0].HostIp === HOST && String(published[0].HostPort) === String(PORT),
  'fixture must have exactly one published port, 1433/tcp on the approved loopback endpoint');
  const variables = new Map((info.Config?.Env || []).map(entry => {
    const at = String(entry).indexOf('=');
    return [at < 0 ? String(entry) : entry.slice(0, at), at < 0 ? '' : entry.slice(at + 1)];
  }));
  const password = variables.get('MSSQL_SA_PASSWORD');
  ensure(typeof password === 'string' && password.length > 0, 'fixture SA credential is unavailable');
  // Credential remains in process memory and is never printed or added to errors.
  return { password, image: info.Config.Image };
}

function assertFixtureDatabaseName(name) {
  ensure(/^NenovaInvoiceFixture_[0-9]{8}_[0-9a-f]{12}$/.test(name), 'fixture database name guard failed');
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

function request(executor, params = {}, timeoutMs = 60000) {
  const req = new sql.Request(executor);
  req.timeout = timeoutMs;
  for (const [name, spec] of Object.entries(params)) req.input(name, spec.type, spec.value);
  return req;
}

function query(executor, statement, params = {}, timeoutMs = 60000) {
  return request(executor, params, timeoutMs).query(statement);
}

function ensureThreeRecordsets(result) {
  ensure(Array.isArray(result?.recordsets) && result.recordsets.length === 3
    && result.recordsets.every(Array.isArray), 'exported SQL must return exactly three recordsets');
}

async function readActual(helper, executor, scope = MAIN_SCOPE) {
  return helper.readInvoiceReceiptEligibility({
    ...scope,
    types: sql,
    queryFn: async (statement, params) => {
      const result = await query(executor, statement, params);
      ensureThreeRecordsets(result);
      return result;
    },
  });
}

function sqlErrorNumbers(error) {
  const numbers = new Set();
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    if (Number.isInteger(current.number)) numbers.add(current.number);
    if (Number.isInteger(current.info?.number)) numbers.add(current.info.number);
    if (current.originalError && current.originalError !== current) visit(current.originalError);
    for (const nested of current.precedingErrors || []) visit(nested);
  };
  visit(error);
  return numbers;
}

async function createFixtureSchema(pool) {
  for (const table of SENTINEL_TABLES) {
    await query(pool, `CREATE TABLE dbo.[${table}] (FixtureId int NOT NULL PRIMARY KEY, Marker nvarchar(80) NOT NULL);`);
    await query(pool, `INSERT dbo.[${table}] (FixtureId,Marker) VALUES (1,N'preserve-${table}');`);
  }
  await query(pool, `CREATE TABLE dbo.Product (
      ProdKey int NOT NULL PRIMARY KEY, ProdName nvarchar(150) NULL,
      CountryFlower nvarchar(150) NULL, isDeleted int NULL
    );
    CREATE TABLE dbo.StockMaster (
      StockKey int NOT NULL PRIMARY KEY, OrderYearWeek nvarchar(8) NOT NULL, OrderWeek nvarchar(8) NOT NULL
    );
    CREATE TABLE dbo.ShipmentFixture (
      FixtureKey int IDENTITY(1,1) NOT NULL PRIMARY KEY, OrderYearWeek2 nvarchar(8) NOT NULL,
      CountryFlower nvarchar(150) NOT NULL, ProdKey int NOT NULL, ProdName nvarchar(150) NOT NULL,
      DetailFix int NULL, OutQuantity decimal(18,6) NOT NULL, CustKey int NOT NULL
    );`);
  await query(pool, VIEW_SQL);
  await query(pool, `INSERT dbo.Product (ProdKey,ProdName,CountryFlower,isDeleted) VALUES
      (101,N'Orchid A',N'ORCHID',0),(102,N'Orchid B',N'ORCHID',0),(103,N'Rose A',N'ROSE',0),
      (104,N'Deleted orchid',N'ORCHID',1),(105,N'Unknown deletion orchid',N'ORCHID',NULL),
      (106,N'Blank cultivar',N'   ',0),(107,N'Null cultivar',NULL,0);
    INSERT dbo.StockMaster (StockKey,OrderYearWeek,OrderWeek) VALUES
      (1,N'20254101',N'41-01'),(2,N'20255201',N'52-01'),
      (3,N'20264101',N'41-01'),(4,N'20270201',N'02-01');
    INSERT dbo.ShipmentFixture (OrderYearWeek2,CountryFlower,ProdKey,ProdName,DetailFix,OutQuantity,CustKey) VALUES
      (N'20264101',N'ORCHID',102,N'Orchid B',1,0,9001),
      (N'20255201',N'ORCHID',102,N'Orchid B',NULL,0,9002),
      (N'20270201',N'ORCHID',102,N'Orchid B',1,0,9003),
      (N'20264101',N'ROSE',103,N'Rose A',1,5,101),
      (N'20254101',N'ORCHID',102,N'Orchid B',1,2,9004),
      (N'20264101',N'ORCHID',102,N'Orchid B',2,4,9005);`);
}

async function snapshotRows(pool, table, orderBy) {
  const result = await query(pool, `SELECT * FROM dbo.[${table}] ORDER BY ${orderBy};`);
  return result.recordset;
}

async function sourceSnapshot(pool) {
  return {
    Product: await snapshotRows(pool, 'Product', 'ProdKey'),
    StockMaster: await snapshotRows(pool, 'StockMaster', 'StockKey'),
    ShipmentFixture: await snapshotRows(pool, 'ShipmentFixture', 'FixtureKey'),
  };
}

async function sentinelSnapshot(pool) {
  const result = {};
  for (const table of SENTINEL_TABLES) result[table] = await snapshotRows(pool, table, 'FixtureId');
  return result;
}

async function testActualBlockersAndExclusions(helper, pool) {
  const result = await readActual(helper, pool);
  ensure(result.canProceed === false && result.code === 'NATIVE_ELIGIBILITY_BLOCKED',
    'current/previous/next blockers must prevent eligibility');
  ensure(result.previousYearWeek === '20255201' && result.nextYearWeek === '20270201',
    'gapped neighbors must use nearest StockMaster rows across the year boundary');
  ensure(result.previousYearWeek !== '20254101',
    '2025 same-week row must not replace the nearest previous stock week');
  const phases = new Set(result.blockers.map(row => row.phase));
  assert.deepEqual([...phases].sort(), ['CURRENT_FIXED', 'NEXT_FIXED', 'PREVIOUS_UNFIXED'].sort());
  ensure(result.blockers.every(row => row.prodKey === 102 && row.countryFlower === 'ORCHID'),
    'same-cultivar other ProdKey is included, while the different cultivar is excluded');
  ensure(result.blockers.some(row => row.phase === 'PREVIOUS_UNFIXED' && row.orderYear === '2025' && row.orderWeek === '52-01'),
    'NULL DetailFix must behave as zero for PREVIOUS_UNFIXED');
  ensure(result.blockers.some(row => row.phase === 'CURRENT_FIXED' && row.prodKey === 102),
    'zero-quantity row for a different customer and a non-requested same-cultivar product must still block');
  ensure(!result.blockers.some(row => row.phase === 'CURRENT_FIXED' && row.orderYear === '2025' && row.orderWeek === '41-01'),
    'a fixed row from the prior year with the same week number must not block the current year/week');
  ensure(!result.blockers.some(row => row.countryFlower === 'ROSE'), 'different CountryFlower must not block');
  console.log('ok - actual query detects all phases, NULL DetailFix=0, gapped/year-boundary neighbors, and category-wide scope');
}

async function insertPhaseShipment(executor, orderYearWeek, detailFix) {
  await query(executor, `INSERT dbo.ShipmentFixture
      (OrderYearWeek2,CountryFlower,ProdKey,ProdName,DetailFix,OutQuantity,CustKey)
    VALUES (@week,N'ORCHID',102,N'Orchid B',@detailFix,0,9010);`, {
    week: { type: sql.NVarChar(8), value: orderYearWeek },
    detailFix: { type: sql.Int, value: detailFix },
  });
}

async function inShipmentTransaction(pool, callback) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await query(tx, 'DELETE FROM dbo.ShipmentFixture;');
    return await callback(tx);
  } finally {
    await tx.rollback().catch(() => {});
  }
}

async function testEachPhaseIndependently(helper, pool) {
  const cases = [
    { phase: 'CURRENT_FIXED', week: '20264101', blocking: 1, nearMisses: [0, null, 2] },
    { phase: 'PREVIOUS_UNFIXED', week: '20255201', blocking: 0, nearMisses: [1, 2] },
    { phase: 'NEXT_FIXED', week: '20270201', blocking: 1, nearMisses: [0, null, 2] },
  ];

  for (const phaseCase of cases) {
    await inShipmentTransaction(pool, async tx => {
      await insertPhaseShipment(tx, phaseCase.week, phaseCase.blocking);
      const result = await readActual(helper, tx);
      ensure(!result.canProceed && result.blockers.length === 1 && result.blockers[0].phase === phaseCase.phase,
        `${phaseCase.phase} must independently block when its exact DetailFix predicate matches`);
    });
  }

  await inShipmentTransaction(pool, async tx => {
    for (const phaseCase of cases) {
      for (const detailFix of phaseCase.nearMisses) {
        await insertPhaseShipment(tx, phaseCase.week, detailFix);
      }
    }
    const clear = await readActual(helper, tx);
    ensure(clear.canProceed && clear.code === 'NATIVE_ELIGIBILITY_CLEAR' && clear.blockers.length === 0,
      'current 0/NULL/2, previous 1/2, and next 0/NULL/2 must all be clear near-misses');
  });
  console.log('ok - each SQL blocker phase independently blocks; all requested DetailFix near-misses are clear');
}

async function testMultiCategoryScope(helper, pool) {
  await inShipmentTransaction(pool, async tx => {
    await insertPhaseShipment(tx, '20264101', 1);
    const result = await readActual(helper, tx, { ...MAIN_SCOPE, prodKeys: [101, 103] });
    ensure(result.countryFlowers.length === 2
      && result.countryFlowers.includes('ORCHID') && result.countryFlowers.includes('ROSE'),
    'requested products must resolve to both CountryFlower categories');
    ensure(!result.canProceed && result.code === 'NATIVE_ELIGIBILITY_BLOCKED'
      && result.blockers.length === 1 && result.blockers[0].countryFlower === 'ORCHID',
    'a blocker in only one selected category must make the whole multi-category scope ineligible');
  });
  console.log('ok - one blocked CountryFlower blocks a multi-CountryFlower product selection');
}

async function testMalformedNearestStockWeek(helper, pool) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await query(tx, `INSERT dbo.StockMaster (StockKey,OrderYearWeek,OrderWeek)
      VALUES (900,N'20264000',N'40-00');`);
    const nearest = await query(tx, `SELECT TOP(1) OrderYearWeek FROM dbo.StockMaster
      WHERE OrderYearWeek<N'20264101' ORDER BY OrderYearWeek DESC,OrderWeek DESC;`);
    ensure(nearest.recordset?.[0]?.OrderYearWeek === '20264000'
      && nearest.recordset[0].OrderYearWeek > '20255201',
    'malformed key must be the selected nearest previous row, after the valid existing previous week');
    let caught;
    try { await readActual(helper, tx); } catch (error) { caught = error; }
    ensure(caught?.code === 'INVOICE_RECEIPT_SNAPSHOT_INVALID',
      `nearest malformed StockMaster week must reject as an invalid snapshot, got ${caught?.code || 'no coded error'}`);
  } finally {
    await tx.rollback().catch(() => {});
  }
  console.log('ok - nearest malformed previous StockMaster key is rejected, not skipped');
}

async function testClearStatusAndNoNeighborCases(helper, pool) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await query(tx, `UPDATE dbo.ShipmentFixture SET DetailFix=NULL WHERE OrderYearWeek2=N'20264101' AND CountryFlower=N'ORCHID';
      UPDATE dbo.ShipmentFixture SET DetailFix=1 WHERE OrderYearWeek2=N'20255201' AND CountryFlower=N'ORCHID';
      UPDATE dbo.ShipmentFixture SET DetailFix=0 WHERE OrderYearWeek2=N'20270201' AND CountryFlower=N'ORCHID';`);
    const clear = await readActual(helper, tx);
    ensure(clear.canProceed === true && clear.code === 'NATIVE_ELIGIBILITY_CLEAR' && clear.blockers.length === 0,
      'current NULL=0, prior fixed, next unfixed must produce a clear result');
  } finally {
    await tx.rollback().catch(() => {});
  }

  const noNeighborTx = new sql.Transaction(pool);
  await noNeighborTx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await query(noNeighborTx, `DELETE FROM dbo.StockMaster;
      INSERT dbo.StockMaster (StockKey,OrderYearWeek,OrderWeek) VALUES (100,N'20261001',N'10-01');
      DELETE FROM dbo.ShipmentFixture;`);
    const isolated = await readActual(helper, noNeighborTx, { orderYear: '2026', orderWeek: '10-01', prodKeys: [101] });
    ensure(isolated.canProceed && isolated.previousYearWeek === null && isolated.nextYearWeek === null,
      'a fixture containing only the selected StockMaster row must have no neighbors and remain clear');
  } finally {
    await noNeighborTx.rollback().catch(() => {});
  }
  console.log('ok - NULL current DetailFix is not fixed; transaction-isolated no-neighbor scope returns null bounds');
}

async function testInvalidProducts(helper, pool) {
  for (const [prodKey, label] of [[104, 'deleted'], [105, 'NULL isDeleted'], [106, 'blank CountryFlower'], [107, 'NULL CountryFlower'], [999, 'missing Product']]) {
    const result = await readActual(helper, pool, { ...MAIN_SCOPE, prodKeys: [prodKey] });
    ensure(!result.canProceed && result.code === 'INVOICE_RECEIPT_PRODUCT_SCOPE_INVALID'
      && result.unresolvedProducts.includes(prodKey), `${label} product must be unresolved and blocked`);
  }
  console.log('ok - deleted, NULL isDeleted, blank/NULL cultivar, and missing Product are blocked');
}

async function testActualSqlFailure(helper, pool) {
  await query(pool, `DROP VIEW dbo.ViewShipment;`);
  try {
    let caught;
    try { await readActual(helper, pool); } catch (error) { caught = error; }
    ensure(caught && sqlErrorNumbers(caught).has(208),
      `missing ViewShipment must propagate SQL error 208, got ${caught?.message || 'no error'}`);
  } finally {
    await query(pool, VIEW_SQL);
  }
  console.log('ok - actual ViewShipment SQL failure propagates; it is not coerced into an eligible zero result');
}

async function runFixture(helper, pool) {
  const initialSentinels = await sentinelSnapshot(pool);
  const initialSources = await sourceSnapshot(pool);
  await testActualBlockersAndExclusions(helper, pool);
  await testEachPhaseIndependently(helper, pool);
  await testMultiCategoryScope(helper, pool);
  await testMalformedNearestStockWeek(helper, pool);
  await testClearStatusAndNoNeighborCases(helper, pool);
  await testInvalidProducts(helper, pool);
  await testActualSqlFailure(helper, pool);
  assert.deepEqual(await sentinelSnapshot(pool), initialSentinels,
    'ERP ledger and shared staging sentinels must remain unchanged');
  assert.deepEqual(await sourceSnapshot(pool), initialSources,
    'Product, StockMaster, and ShipmentFixture setup rows must remain unchanged after SELECT-only tests');
  console.log('ok - all ERP/staging sentinel tables and fixture source rows are unchanged');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  const helper = await import(pathToFileURL(HELPER_FILE).href);
  ensure(typeof helper.readInvoiceReceiptEligibility === 'function'
    && typeof helper.invoiceReceiptEligibilitySql === 'function'
    && typeof helper.evaluateInvoiceReceiptEligibility === 'function',
  'actual invoice receipt eligibility exports are missing');

  const { password, image } = inspectApprovedContainer();
  const database = newDatabaseName();
  let master;
  let pool;
  let created = false;
  try {
    master = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database: 'master',
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { min: 0, max: 1, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 15000 }).connect();
    const collision = await query(master, 'SELECT DB_ID(@name) AS ExistingId;', {
      name: { type: sql.NVarChar(128), value: database },
    });
    ensure(collision.recordset?.[0]?.ExistingId == null, 'unique fixture database name unexpectedly exists; refusing reuse');
    await query(master, `CREATE DATABASE ${bracketFixtureDatabase(database)};`);
    created = true;
    await query(master, `ALTER DATABASE ${bracketFixtureDatabase(database)} SET COMPATIBILITY_LEVEL=130;`);
    pool = await new sql.ConnectionPool({ user: 'sa', password, server: HOST, port: PORT, database,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { min: 0, max: 4, idleTimeoutMillis: 60000 }, connectionTimeout: 5000, requestTimeout: 60000 }).connect();
    await query(pool, `SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;`);
    const level = await query(pool, `SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME();`);
    ensure(Number(level.recordset?.[0]?.compatibility_level) === 130, 'fixture database compatibility must be 130');
    await createFixtureSchema(pool);
    console.log(`SETUP: image=${image}, endpoint=${HOST}:${PORT}, database=${database}, compatibility=130`);
    console.log('MODE: actual web eligibility SELECT only; no native CommonLogic stored procedure is executed.');
    await runFixture(helper, pool);
    console.log('PASS: isolated invoice receipt eligibility SQL fixture scenarios completed.');
  } finally {
    await pool?.close().catch(() => {});
    if (master && created) {
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
  // Do not dump connection configuration, inspected container output, or credentials.
  console.error(error?.message || 'fixture failed');
  process.exitCode = 1;
});
