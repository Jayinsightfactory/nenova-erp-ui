#!/usr/bin/env node
/* Isolated local SQL Server fixture. Never reads the app's .env or production DB. */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
const sql = require('mssql');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'nenova-estimate-sql-test-20260826';
const DB_NAME = `NenovaEstimateFixture_distribution_audit_${crypto.randomBytes(6).toString('hex')}`;
if (!/^NenovaEstimateFixture_distribution_audit_[0-9a-f]{12}$/.test(DB_NAME)) throw new Error('fixture database name guard failed');
const inspect = spawnSync('docker', ['inspect', CONTAINER], { encoding: 'utf8', windowsHide: true });
if (inspect.status !== 0) throw new Error('approved local SQL fixture container unavailable');
const info = JSON.parse(inspect.stdout)[0];
const port = info?.HostConfig?.PortBindings?.['1433/tcp'] || [];
if (!info?.State?.Running || info.Name !== `/${CONTAINER}` ||
    !/^mcr\.microsoft\.com\/mssql\/server:2022(?:-|$)/i.test(info.Config?.Image || '') ||
    (info.Mounts || []).length || (info.HostConfig?.Binds || []).length ||
    !port.some(p => p.HostIp === '127.0.0.1' && Number(p.HostPort) === 14339)) {
  throw new Error('SQL fixture container identity or isolation guard failed');
}
const password = (info.Config?.Env || []).find(v => v.startsWith('MSSQL_SA_PASSWORD='))?.slice('MSSQL_SA_PASSWORD='.length);
if (!password) throw new Error('fixture password unavailable');
register(pathToFileURL(path.join(ROOT, '__tests__/fixtures/dutchVolumeLoaderHook.mjs')).href);

function config(database) {
  return { server: '127.0.0.1', port: 14339, database, user: 'sa', password,
    options: { encrypt: false, trustServerCertificate: true }, pool: { min: 0, max: 2 } };
}
async function q(executor, statement, params = {}) {
  const request = new sql.Request(executor);
  for (const [key, spec] of Object.entries(params)) request.input(key, spec.type, spec.value);
  return request.query(statement);
}

(async () => {
  const { insertDistributionEditAudit } = await import(pathToFileURL(path.join(ROOT, 'lib/shipmentDistributionAudit.js')).href);
  const master = await sql.connect(config('master'));
  let fixture;
  try {
    await q(master, `CREATE DATABASE [${DB_NAME}]`);
    fixture = await new sql.ConnectionPool(config(DB_NAME)).connect();
    await q(fixture, `CREATE TABLE ShipmentMaster (ShipmentKey int PRIMARY KEY, OrderYear nvarchar(4), OrderWeek nvarchar(10), CustKey int);
      CREATE TABLE ShipmentDetail (SdetailKey int PRIMARY KEY, ShipmentKey int, ProdKey int, OutQuantity float);
      CREATE TABLE SystemActionLog (LogKey int IDENTITY PRIMARY KEY, ActionDtm datetime DEFAULT GETDATE(), Actor nvarchar(100),
        SessionId nvarchar(200), ActionType nvarchar(50), Method nvarchar(10), Endpoint nvarchar(300),
        AffectedTable nvarchar(100), AffectedCount int, Payload nvarchar(max), Result nvarchar(20),
        ResultDesc nvarchar(1000), RiskLevel nvarchar(20), IpAddress nvarchar(50), UserAgent nvarchar(500));
      INSERT INTO ShipmentMaster VALUES (1,N'2025',N'41-02',478),(2,N'2026',N'41-02',478),(3,N'2026',N'41-02',436);
      INSERT INTO ShipmentDetail VALUES (1,1,2429,99),(2,2,2429,48),(3,3,2429,16);`);
    await q(fixture, `CREATE TRIGGER FailDistributionAudit ON SystemActionLog AFTER INSERT AS
      BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE Actor=N'fail') THROW 51000, 'fixture audit failure', 1; END`);

    const failed = new sql.Transaction(fixture);
    await failed.begin();
    try {
      await q(failed, `UPDATE sd SET OutQuantity=32 FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
        WHERE sm.OrderYear=N'2026' AND sm.OrderWeek=N'41-02' AND sm.CustKey=478 AND sd.ProdKey=2429`);
      await insertDistributionEditAudit((statement, params) => q(failed, statement, params), {
        orderYear: '2026', orderWeek: '41-02', actor: 'fail',
        entries: [{ custKey: 478, prodKey: 2429, outQtyBefore: 48, outQtyAfter: 32, unit: '단' }],
      });
      throw new Error('audit failure was not raised');
    } catch (error) {
      assert.match(error.message, /fixture audit failure/);
      try { await failed.rollback(); } catch (rollbackError) {
        if (rollbackError.code !== 'EABORT') throw rollbackError;
      }
    }
    let result = await q(fixture, `SELECT sm.OrderYear, sd.OutQuantity FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.CustKey=478 ORDER BY sm.OrderYear`);
    assert.deepEqual(result.recordset.map(r => [r.OrderYear, r.OutQuantity]), [['2025', 99], ['2026', 48]]);
    result = await q(fixture, `SELECT COUNT(*) AS n FROM SystemActionLog`);
    assert.equal(result.recordset[0].n, 0);

    const committed = new sql.Transaction(fixture);
    await committed.begin();
    await q(committed, `DELETE sd FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
      WHERE sm.OrderYear=N'2026' AND sm.OrderWeek=N'41-02' AND sm.CustKey=436 AND sd.ProdKey=2429`);
    await insertDistributionEditAudit((statement, params) => q(committed, statement, params), {
      orderYear: '2026', orderWeek: '41-02', actor: 'fixture',
      entries: [{ custKey: 436, prodKey: 2429, outQtyBefore: 16, outQtyAfter: 0, unit: '단' }],
    });
    await committed.commit();
    result = await q(fixture, `SELECT Payload FROM SystemActionLog WHERE ActionType=N'SHIPMENT_DISTRIBUTION_EDIT'`);
    assert.equal(result.recordset.length, 1);
    const snapshot = JSON.parse(result.recordset[0].Payload);
    assert.equal(snapshot.week, '2026-41-02');
    assert.deepEqual([snapshot.entries[0].outQtyBefore, snapshot.entries[0].outQtyAfter], [16, 0]);
    result = await q(fixture, `SELECT sm.OrderYear, sm.CustKey, sd.OutQuantity FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey ORDER BY sm.OrderYear, sm.CustKey`);
    assert.deepEqual(result.recordset.map(r => [r.OrderYear, r.CustKey, r.OutQuantity]), [['2025', 478, 99], ['2026', 478, 48]]);
    console.log('shipment distribution audit SQL fixture passed: rollback, zero deletion, cross-year');
  } finally {
    if (fixture) await fixture.close();
    await q(master, `IF DB_ID(N'${DB_NAME}') IS NOT NULL BEGIN ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB_NAME}]; END`);
    await master.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
