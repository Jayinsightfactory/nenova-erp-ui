#!/usr/bin/env node
// Isolated real-MSSQL concurrency test. Uses only the approved Docker fixture.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sql = require('mssql');
const {
  inspectFixture, assertDbName, bracket, query,
} = require('./test-weekday-distribution-sql.cjs');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 14339;
let fixturePassword = '';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function bounded(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
function noOperationalEnvironment() {
  for (const name of ['DB_SERVER', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (process.env[name] != null) throw new Error(`Operational ${name} is present; fixture test refused`);
  }
}

async function snapshot(pool) {
  const rows = (await query(pool, `SELECT OrderYear,OrderWeek,CustKey,ProdKey,Quantity
    FROM dbo.AdjustmentRows ORDER BY OrderYear,OrderWeek,CustKey,ProdKey`)).recordset;
  return rows.map(row => [String(row.OrderYear), String(row.OrderWeek),
    Number(row.CustKey), Number(row.ProdKey), Number(row.Quantity)]);
}

async function runScenarios(pool, withTransaction, acquireLock, options) {
  const acquiredA = deferred();
  const releaseA = deferred();
  let enteredB = false;
  let first;
  let second;
  try {
    first = withTransaction(async (tQ, { attempt }) => {
      await acquireLock(tQ);
      await acquireLock(tQ); // Same transaction may enter the gate again.
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=611 AND ProdKey=1306`);
      acquiredA.resolve();
      await releaseA.promise;
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=456 AND ProdKey=1306`);
      return attempt;
    }, options);
    await bounded(Promise.race([acquiredA.promise, first]), 'first writer lock acquisition');
    second = withTransaction(async (tQ, { attempt }) => {
      await acquireLock(tQ);
      enteredB = true;
      // The second writer requests the same rows in reverse order.
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=456 AND ProdKey=1306`);
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=611 AND ProdKey=1306`);
      return attempt;
    }, options);
    await delay(250);
    assert.equal(enteredB, false, 'second writer must wait at the transaction app lock');
  } finally {
    releaseA.resolve();
  }
  assert.deepEqual(await bounded(Promise.all([first, second]), 'opposite-order writers'), [0, 0]);
  assert.deepEqual(await snapshot(pool), [
    ['2025', '41-02', 456, 1306, 80], ['2025', '41-02', 611, 1306, 90],
    ['2026', '41-01', 456, 1306, 70],
    ['2026', '41-02', 456, 1306, 22], ['2026', '41-02', 611, 1306, 12],
  ], 'both writers commit once; prior-year and other-week sentinels remain unchanged');

  const preview = await withTransaction(async tQ => {
    await acquireLock(tQ);
    await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+100
      WHERE OrderYear='2026' AND OrderWeek='41-02' AND ProdKey=1306 AND CustKey IN (611,456)`);
    return Number((await tQ(`SELECT Quantity FROM dbo.AdjustmentRows
      WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=611 AND ProdKey=1306`)).recordset[0].Quantity);
  }, { ...options, rollbackOnly: true });
  assert.equal(preview, 112, 'rollbackOnly callback can inspect its provisional change');
  assert.equal(Number(await withTransaction(async tQ => {
    await acquireLock(tQ);
    return (await tQ(`SELECT Quantity FROM dbo.AdjustmentRows
      WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=611 AND ProdKey=1306`)).recordset[0].Quantity;
  }, options)), 12, 'rollbackOnly releases the app lock and discards its write');

  await assert.rejects(withTransaction(async tQ => {
    await acquireLock(tQ);
    await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+100
      WHERE OrderYear='2026' AND OrderWeek='41-02' AND ProdKey=1306 AND CustKey IN (611,456)`);
    throw new Error('fixture rollback');
  }, options), /fixture rollback/);
  await withTransaction(async tQ => {
    await acquireLock(tQ);
    const current = (await tQ(`SELECT Quantity FROM dbo.AdjustmentRows
      WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=456 AND ProdKey=1306`)).recordset[0].Quantity;
    assert.equal(Number(current), 22, 'failed writer released the lock and rolled back');
  }, { ...options, rollbackOnly: true });
  assert.deepEqual(await snapshot(pool), [
    ['2025', '41-02', 456, 1306, 80], ['2025', '41-02', 611, 1306, 90],
    ['2026', '41-01', 456, 1306, 70],
    ['2026', '41-02', 456, 1306, 22], ['2026', '41-02', 611, 1306, 12],
  ]);
}

async function runBusyLockTimeout(pool, withTransaction, acquireLock, options) {
  const before = await snapshot(pool);
  const holderReady = deferred();
  const releaseHolder = deferred();
  const attempts = [];
  let erpWriteEntered = false;
  const holder = withTransaction(async tQ => {
    await acquireLock(tQ);
    holderReady.resolve();
    await releaseHolder.promise;
  }, options);
  try {
    await bounded(Promise.race([holderReady.promise, holder]), 'busy-lock holder acquisition');
    const started = Date.now();
    const contender = withTransaction(async (tQ, { attempt }) => {
      attempts.push(attempt);
      await acquireLock(tQ);
      erpWriteEntered = true;
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=611 AND ProdKey=1306`);
    }, options);
    await assert.rejects(bounded(contender, 'busy-lock contender timeout'), error => {
      assert.equal(error.code, 'ERP_DISTRIBUTION_BUSY');
      assert.equal(error.statusCode, 503);
      return true;
    });
    assert.ok(Date.now() - started >= 9000, 'contender must wait for the SQL app-lock timeout');
    assert.deepEqual(attempts, [0], 'busy error must not retry the transaction');
    assert.equal(erpWriteEntered, false, 'busy contender must stop before ERP writes');
    assert.deepEqual(await snapshot(pool), before, 'busy contender must leave the ledger unchanged');
  } finally {
    releaseHolder.resolve();
    await bounded(holder, 'busy-lock holder release');
  }
  await withTransaction(async tQ => {
    await acquireLock(tQ);
  }, { ...options, rollbackOnly: true });
  assert.deepEqual(await snapshot(pool), before, 'lock must be reacquirable after holder completes');
}

async function runRealDeadlockRetry(pool, withTransaction, options) {
  const readyA = deferred();
  const readyB = deferred();
  const attemptsA = [];
  const attemptsB = [];
  const writer = (firstCust, secondCust, priority, ownReady, otherReady, attempts) =>
    withTransaction(async (tQ, { attempt }) => {
      attempts.push(attempt);
      await tQ(`SET DEADLOCK_PRIORITY ${priority}`);
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=${firstCust} AND ProdKey=1306`);
      if (attempt === 0) {
        ownReady.resolve();
        await otherReady.promise;
      }
      await tQ(`UPDATE dbo.AdjustmentRows SET Quantity=Quantity+1
        WHERE OrderYear='2026' AND OrderWeek='41-02' AND CustKey=${secondCust} AND ProdKey=1306`);
      return attempt;
    }, options);
  // This scenario deliberately omits the app lock to exercise real SQL 1205.
  const results = await bounded(Promise.all([
    writer(611, 456, 'HIGH', readyA, readyB, attemptsA),
    writer(456, 611, 'LOW', readyB, readyA, attemptsB),
  ]), 'real SQL deadlock retry');
  assert.deepEqual([...results].sort(), [0, 1], 'one deadlock victim must replay its complete callback once');
  assert.deepEqual([attemptsA, attemptsB].map(attempts => attempts.join(',')).sort(), ['0', '0,1']);
  assert.deepEqual(await snapshot(pool), [
    ['2025', '41-02', 456, 1306, 80], ['2025', '41-02', 611, 1306, 90],
    ['2026', '41-01', 456, 1306, 70],
    ['2026', '41-02', 456, 1306, 24], ['2026', '41-02', 611, 1306, 14],
  ], 'victim partial write rolled back before the whole callback replayed');
}

async function main() {
  noOperationalEnvironment();
  const fixture = inspectFixture();
  fixturePassword = fixture.password;
  const dbName = `NenovaEstimateFixture_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${crypto.randomBytes(4).toString('hex')}`;
  assertDbName(dbName);
  let master;
  let appPool;
  try {
    master = await new sql.ConnectionPool({
      user: 'sa', password: fixture.password, server: HOST, port: PORT, database: 'master',
      options: { encrypt: false, trustServerCertificate: true }, pool: { max: 2, min: 0 },
    }).connect();
    await query(master, `CREATE DATABASE ${bracket(dbName)}`);
    process.env.DB_SERVER = HOST;
    process.env.DB_PORT = String(PORT);
    process.env.DB_NAME = dbName;
    process.env.DB_USER = 'sa';
    process.env.DB_PASSWORD = fixture.password;
    const db = await import(pathToFileURL(path.join(ROOT, 'lib', 'db.js')).href);
    const lock = await import(pathToFileURL(path.join(ROOT, 'lib', 'shipmentAdjustmentLock.js')).href);
    appPool = await db.getPool();
    await query(appPool, `CREATE TABLE dbo.AdjustmentRows (
      OrderYear char(4) NOT NULL, OrderWeek char(5) NOT NULL,
      CustKey int NOT NULL, ProdKey int NOT NULL,
      Quantity int NOT NULL,
      CONSTRAINT PK_AdjustmentRows PRIMARY KEY (OrderYear,OrderWeek,CustKey,ProdKey)
    );
    INSERT dbo.AdjustmentRows(OrderYear,OrderWeek,CustKey,ProdKey,Quantity) VALUES
      ('2025','41-02',611,1306,90),('2025','41-02',456,1306,80),
      ('2026','41-01',456,1306,70),
      ('2026','41-02',611,1306,10),('2026','41-02',456,1306,20);`);
    await runScenarios(appPool, db.withTransaction, lock.acquireShipmentAdjustmentLock,
      lock.SHIPMENT_ADJUSTMENT_TRANSACTION_OPTIONS);
    await runBusyLockTimeout(appPool, db.withTransaction, lock.acquireShipmentAdjustmentLock,
      lock.SHIPMENT_ADJUSTMENT_TRANSACTION_OPTIONS);
    await runRealDeadlockRetry(appPool, db.withTransaction,
      lock.SHIPMENT_ADJUSTMENT_TRANSACTION_OPTIONS);
    console.log('PASS: isolated MSSQL app lock serializes reverse-order writers, supports same-transaction reentry, and returns busy before ERP writes after timeout; rollback releases lock; real 1205 retries whole callback; prior-year/other-week sentinels preserved');
  } finally {
    await appPool?.close().catch(() => {});
    for (const name of ['DB_SERVER', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) delete process.env[name];
    if (master) {
      await query(master, `IF DB_ID(N'${dbName}') IS NOT NULL BEGIN
        ALTER DATABASE ${bracket(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE ${bracket(dbName)}; END`).catch(() => {});
    }
    await master?.close().catch(() => {});
  }
}

if (require.main === module) main().catch(error => {
  // Connection failures must not print fixture credentials.
  const message = String(error.message || 'fixture test failed');
  console.error(`FAIL: ${fixturePassword ? message.replaceAll(fixturePassword, '[redacted]') : message}`);
  process.exitCode = 1;
});
