'use strict';

const assert = require('node:assert/strict');
const {
  cloneParsedItems,
  loadDistributionRequestBalanceFacts,
  buildDistributionRequestBalanceComparison,
} = require('../lib/distributionRequestBalance');

const scope = { year: '2026', weeks: ['37-01'], from: '2026-09-10', to: '2026-09-11' };
const sourceAt = '2026-09-10T09:00:00+09:00';
const request = (id, sourceIdentity, custKey, action, qty = 1) => ({
  id, sourceIdentity, custKey, prodKey: 1718, productText: 'SALAL TIPS', unit: '박스', qty, action,
  year: '2026', week: '37-01', sourceAt, timestamp_approximate: false, status: 'PENDING',
});
const event = (eventId, custKey, before, after, extra = {}) => ({
  eventId: String(eventId), year: '2026', week: '37-01', custKey, prodKey: 1718, unit: '박스', before, after,
  changeAt: '2026-09-10T10:00:00+09:00', ...extra,
});
const facts = shipmentEvents => ({ products: [{ ProdKey: 1718, ProdName: 'SALAL TIPS', OutUnit: '박스' }], shipmentEvents, queryTruncated: false });
const balanceFacts = (snapshotRows = [{ ProdKey: 1718, snapshotStockKeyCount: 1, snapshotRowCount: 1, finiteValueCount: 1, storedStockSnapshot: 44 }], distributionRows = [{ ProdKey: 1718, distributionRowCount: 1, finiteValueCount: 1, actualDistributionTotal: 7 }], scopeStockMasterCount = 1) => ({ scopeStockMasterCount, snapshotRows, distributionRows, snapshotsTruncated: false, distributionsTruncated: false });
const parsed = requests => requests.map(item => ({ sourceIdentity: item.sourceIdentity, requests: [item] }));

const exact = buildDistributionRequestBalanceComparison({
  parsedItems: cloneParsedItems(parsed([
    request('cancel', 'message-a', 1, 'CANCEL'), request('add', 'message-b', 2, 'ADD'),
  ])),
  facts: facts([event('cancel-event', 1, 5, 4), event('add-event', 2, 10, 11)]), balanceFacts: balanceFacts(), scope,
});
assert.equal(exact.products.length, 1);
assert.equal(exact.products[0].requestedSignedDelta, 0);
assert.equal(exact.products[0].observedSignedDelta, 0);
assert.equal(exact.products[0].evidenceStatus, 'CONSISTENT');
assert.equal(exact.products[0].actualDistributionTotal, 7);
assert.equal(exact.products[0].storedStockSnapshot, 44);
assert.equal(exact.products[0].snapshotSource, 'PRODUCT_STOCK_SNAPSHOT');
assert.equal(exact.products[0].snapshotStatus, 'AVAILABLE');
assert.equal(exact.products[0].requests.length, 2);
assert.deepEqual(exact.products[0].requests.map(row => [row.sourceIdentity, row.requestedSignedDelta, row.evidenceStatus]), [['message-a', -1, 'CONSISTENT'], ['message-b', 1, 'CONSISTENT']]);
assert.equal(exact.products[0].visibleByDefault, false);
assert.equal('currentCalculatedBalance' in exact.products[0], false);

const partial = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('partial', 'partial-message', 1, 'ADD', 5)]), facts: facts([event('partial-event', 1, 0, 2)]), balanceFacts: balanceFacts(), scope });
assert.deepEqual(partial.products[0].requests.map(row => [row.evidenceStatus, row.observedSignedDelta]), [['PARTIAL', 2]]);
assert.equal(partial.products[0].observedComplete, false);

const mismatch = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('mismatch', 'mismatch-message', 1, 'ADD', 5)]), facts: facts([event('mismatch-event', 1, 5, 0)]), balanceFacts: balanceFacts(), scope });
assert.equal(mismatch.products[0].evidenceStatus, 'MISMATCH');
assert.equal(mismatch.products[0].observedSignedDelta, -5);

const competing = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('a', 'one', 1, 'ADD'), request('b', 'two', 1, 'ADD')]), facts: facts([event('shared', 1, 0, 1)]), balanceFacts: balanceFacts(), scope });
assert.equal(competing.products[0].evidenceStatus, 'AMBIGUOUS');
assert.equal(competing.products[0].observedSignedDelta, null, 'a shared partial/exact candidate cannot be claimed by either request');
assert.ok(competing.products[0].requests.every(row => row.reasonCodes.some(code => code.startsWith('COMPETING_SHIPMENT_EVENT:'))));

const priorYear = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('cross-year', 'cross-year', 1, 'ADD')]), facts: facts([{ ...event('old', 1, 0, 1), year: '2025' }]), balanceFacts: balanceFacts(), scope });
assert.equal(priorYear.products[0].evidenceStatus, 'UNCONFIRMED');
assert.equal(priorYear.products[0].observedSignedDelta, null);

const multiDate = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('multi', 'multi', 1, 'ADD')]), facts: facts([event('multi-event', 1, 0, 1, { multiDate: true })]), balanceFacts: balanceFacts(), scope });
assert.equal(multiDate.products[0].evidenceStatus, 'AMBIGUOUS');
assert.ok(multiDate.products[0].reasonCodes.includes('MULTI_DATE_SHIPMENT'));

const zero = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('zero', 'zero', 1, 'ADD')]), facts: facts([]), balanceFacts: balanceFacts([{ ProdKey: 1718, snapshotStockKeyCount: 1, snapshotRowCount: 1, finiteValueCount: 1, storedStockSnapshot: 0 }]), scope });
assert.equal(zero.products[0].storedStockSnapshot, 0);
assert.equal(zero.products[0].snapshotStatus, 'AVAILABLE');
const duplicate = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('duplicate', 'duplicate', 1, 'ADD')]), facts: facts([]), balanceFacts: balanceFacts([{ ProdKey: 1718, snapshotStockKeyCount: 2, snapshotRowCount: 2, finiteValueCount: 2, storedStockSnapshot: 44 }]), scope });
assert.equal(duplicate.products[0].storedStockSnapshot, null);
assert.equal(duplicate.products[0].snapshotStatus, 'AMBIGUOUS');
assert.ok(duplicate.products[0].reasonCodes.includes('DUPLICATE_STOCK_SNAPSHOT'));
const twoMastersOneProductRow = buildDistributionRequestBalanceComparison({
  parsedItems: parsed([request('two-masters', 'two-masters', 1, 'ADD')]), facts: facts([]),
  balanceFacts: balanceFacts([{ ProdKey: 1718, snapshotStockKeyCount: 1, snapshotRowCount: 1, finiteValueCount: 1, storedStockSnapshot: 44 }], undefined, 2), scope,
});
assert.equal(twoMastersOneProductRow.products[0].storedStockSnapshot, null);
assert.equal(twoMastersOneProductRow.products[0].snapshotStatus, 'AMBIGUOUS');
assert.ok(twoMastersOneProductRow.products[0].reasonCodes.includes('AMBIGUOUS_STOCK_MASTER_SCOPE'));
const missing = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('missing', 'missing', 1, 'ADD')]), facts: facts([]), balanceFacts: balanceFacts([], []), scope });
assert.equal(missing.products[0].storedStockSnapshot, null);
assert.equal(missing.products[0].snapshotStatus, 'UNKNOWN');
assert.equal(missing.products[0].actualDistributionTotal, 0);
const missingMaster = buildDistributionRequestBalanceComparison({ parsedItems: parsed([request('missing-master', 'missing-master', 1, 'ADD')]), facts: facts([]), balanceFacts: balanceFacts([], [], 0), scope });
assert.equal(missingMaster.products[0].storedStockSnapshot, null);
assert.equal(missingMaster.products[0].snapshotStatus, 'UNKNOWN');
assert.ok(missingMaster.products[0].reasonCodes.includes('STOCK_MASTER_SCOPE_MISSING'));
const incompleteTotal = buildDistributionRequestBalanceComparison({
  parsedItems: parsed([request('incomplete-total', 'incomplete-total', 1, 'ADD')]), facts: facts([event('complete', 1, 0, 1)]),
  balanceFacts: balanceFacts(undefined, [{ ProdKey: 1718, distributionRowCount: 1, finiteValueCount: 0, actualDistributionTotal: null }]), scope,
});
assert.equal(incompleteTotal.products[0].evidenceStatus, 'CONSISTENT');
assert.equal(incompleteTotal.products[0].actualDistributionTotal, null);
assert.equal(incompleteTotal.products[0].visibleByDefault, true, 'null current distribution must remain visible even with matching history and snapshot');
assert.ok(incompleteTotal.products[0].reasonCodes.includes('INVALID_DISTRIBUTION_TOTAL'));
const unitConflict = buildDistributionRequestBalanceComparison({
  parsedItems: parsed([request('unit-conflict', 'unit-conflict', 1, 'ADD')]), facts: facts([]),
  balanceFacts: balanceFacts(undefined, [
    { ProdKey: 1718, unit: '박스', distributionRowCount: 1, finiteValueCount: 1, actualDistributionTotal: 1 },
    { ProdKey: 1718, unit: '단', distributionRowCount: 1, finiteValueCount: 1, actualDistributionTotal: 1 },
  ]), scope,
});
assert.equal(unitConflict.products[0].actualDistributionTotal, null);
assert.ok(unitConflict.products[0].reasonCodes.includes('AMBIGUOUS_DISTRIBUTION_UNIT'));

const sqlCalls = [];
loadDistributionRequestBalanceFacts(async (statement, params) => {
  sqlCalls.push({ statement, params });
  if (/COUNT_BIG\(\*\) AS scopeStockMasterCount/.test(statement)) return { recordset: [{ scopeStockMasterCount: 1 }] };
  return { recordset: [] };
}, { NVarChar: 'NVARCHAR' }, scope).then(result => {
  assert.equal(sqlCalls.length, 3);
  for (const call of sqlCalls) {
    assert.match(call.statement, /OrderYear=@year/);
    assert.match(call.statement, /OrderWeek=@week/);
    assert.doesNotMatch(call.statement, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    assert.equal(call.params.year.value, '2026'); assert.equal(call.params.week.value, '37-01');
  }
  const snapshots = sqlCalls.find(call => call.statement.includes('JOIN ProductStock')).statement;
  const masterScope = sqlCalls.find(call => call.statement.includes('scopeStockMasterCount')).statement;
  assert.match(masterScope, /FROM StockMaster sm/);
  assert.equal(result.scopeStockMasterCount, 1);
  assert.match(snapshots, /JOIN ProductStock ps ON ps\.StockKey=sm\.StockKey/);
  assert.match(snapshots, /TOP 10001/);
  assert.match(snapshots, /COUNT_BIG\(DISTINCT sm\.StockKey\) AS snapshotStockKeyCount/);
  const totals = sqlCalls.find(call => call.statement.includes('FROM ViewShipment')).statement;
  assert.match(totals, /TOP 10001/);
  assert.match(totals, /JOIN Product p ON p\.ProdKey=vs\.ProdKey/);
  assert.match(totals, /p\.OutUnit AS unit/);
  assert.doesNotMatch(totals, /vs\.OutUnit|ShipmentDate/);
  console.log('distribution request balance tests passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
