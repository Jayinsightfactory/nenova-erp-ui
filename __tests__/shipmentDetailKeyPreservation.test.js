import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  safeNextKey,
  safeNextShipmentDetailKey,
  syncKeyNumbering,
} from '../lib/safeNextKey.js';

const LOCAL_ALLOCATOR_FILES = [
  '../pages/api/shipment/adjust.js',
  '../pages/api/shipment/distribute.js',
  '../pages/api/shipment/stock-status.js',
  '../lib/shipmentImport.js',
];

function loadLocalSafeNextKey(relativePath, sharedAllocator) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  assert.match(source, /import \{ safeNextShipmentDetailKey \} from ['"][^'"]*safeNextKey\.js['"]/);
  const start = source.indexOf('async function safeNextKey(');
  assert.notEqual(start, -1, `${relativePath} safeNextKey function missing`);
  const functionSource = source.slice(start).match(/^async function safeNextKey\([^\n]+\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(functionSource, `${relativePath} safeNextKey extraction failed`);
  return Function(
    'safeNextShipmentDetailKey',
    `'use strict'; ${functionSource}; return safeNextKey;`,
  )(sharedAllocator);
}

test('ShipmentDetail allocator locks active/history/KeyNumbering ceilings and reserves max+1', async () => {
  const calls = [];
  const tQ = async (statement, params = {}) => {
    calls.push({ statement, params });
    if (/AS ActiveMax/.test(statement)) {
      return { recordset: [{ ActiveMax: 89892, HistoryMax: 89893, NumberingMax: 90000 }] };
    }
    return { rowsAffected: [1] };
  };
  assert.equal(await safeNextShipmentDetailKey(tQ), 90001);
  assert.equal(calls.length, 2);
  assert.match(calls[0].statement, /ShipmentDetail sd WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(calls[0].statement, /ShipmentHistory h WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(calls[0].statement, /KeyNumbering kn WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(calls[1].statement, /UPDATE dbo\.KeyNumbering SET LastKeyNo=90001/);
});

test('safeNextKey dispatches only the exact ShipmentDetail key pair to history-safe allocation', async () => {
  const shipmentCalls = [];
  assert.equal(await safeNextKey(async (statement) => {
    shipmentCalls.push(statement);
    if (/AS ActiveMax/.test(statement)) {
      return { recordset: [{ ActiveMax:89892,HistoryMax:89893,NumberingMax:89892 }] };
    }
    return { rowsAffected: [1] };
  }, 'ShipmentDetail', 'SdetailKey'), 89894);
  assert.match(shipmentCalls[0], /ShipmentHistory/);

  const otherCalls = [];
  assert.equal(await safeNextKey(async (statement) => {
    otherCalls.push(statement);
    return { recordset: [{ nk: 44 }] };
  }, 'OrderDetail', 'OrderDetailKey'), 44);
  assert.equal(otherCalls.length, 1);
  assert.match(otherCalls[0], /SELECT ISNULL\(MAX\(OrderDetailKey\),0\)\+1 AS nk FROM OrderDetail/);
  assert.doesNotMatch(otherCalls[0], /ShipmentHistory|KeyNumbering/);
});

test('four legacy shipment writers delegate only ShipmentDetail/SdetailKey to the shared allocator', async () => {
  for (const relativePath of LOCAL_ALLOCATOR_FILES) {
    const sharedCalls = [];
    const queryCalls = [];
    const localSafeNextKey = loadLocalSafeNextKey(relativePath, async (tQ) => {
      sharedCalls.push(tQ);
      return 89894;
    });
    const tQ = async (statement) => {
      queryCalls.push(statement);
      return { recordset:[{nk:44}] };
    };
    assert.equal(await localSafeNextKey(tQ,'ShipmentDetail','SdetailKey'),89894,relativePath);
    assert.deepEqual(sharedCalls,[tQ],relativePath);
    assert.equal(queryCalls.length,0,relativePath);

    assert.equal(await localSafeNextKey(tQ,'OrderDetail','OrderDetailKey'),44,relativePath);
    assert.equal(sharedCalls.length,1,relativePath);
    assert.match(queryCalls[0],/MAX\(OrderDetailKey\)/,relativePath);
  }
});

test('ShipmentDetail allocator fails closed on missing, non-finite, fractional or negative ceilings', async () => {
  for (const row of [
    { ActiveMax:1,HistoryMax:2 },
    { ActiveMax:1,HistoryMax:2,NumberingMax:null },
    { ActiveMax:1,HistoryMax:2,NumberingMax:'3' },
    { ActiveMax:1,HistoryMax:2,NumberingMax:NaN },
    { ActiveMax:1,HistoryMax:2.5,NumberingMax:3 },
    { ActiveMax:1,HistoryMax:-1,NumberingMax:3 },
  ]) {
    await assert.rejects(
      safeNextShipmentDetailKey(async () => ({ recordset:[row] })),
      /ShipmentDetail key ceiling/,
    );
  }
  await assert.rejects(
    safeNextShipmentDetailKey(async () => ({ recordset:[{
      ActiveMax:2147483647,HistoryMax:0,NumberingMax:0,
    }] })),
    /invalid ShipmentDetail key allocation result/,
  );
});

test('syncKeyNumbering remains monotonic and never lowers LastKeyNo after cleanup', async () => {
  let statement = '';
  await syncKeyNumbering(async (sqlText) => {
    statement = sqlText;
    return { rowsAffected: [1] };
  }, 'ShipmentDetailKey', 'ShipmentDetail', 'SdetailKey');
  assert.match(statement, /CASE WHEN LastKeyNo < x\.MaxKey THEN x\.MaxKey ELSE LastKeyNo END/);
});
