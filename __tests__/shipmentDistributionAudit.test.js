import assert from 'node:assert/strict';
import fs from 'node:fs';
import { distributionEditSnapshot, insertDistributionEditAudit } from '../lib/shipmentDistributionAudit.js';
import { parsePasteOperation, matchesPasteOperation } from '../lib/pasteOperationHistory.js';
import { normalizeOrderHistorySearch } from '../lib/orderHistorySearch.js';
import applicationStatus from '../lib/distributionMessageApplicationStatus.js';

const entries = [
  { custKey: 478, prodKey: 2429, outQtyBefore: 48, outQtyAfter: 32, unit: '단', custName: '왕자원예' },
  { custKey: 436, prodKey: 2429, outQtyBefore: 0, outQtyAfter: 16, unit: '단', custName: '수경원예' },
  { custKey: 77, prodKey: 9, outQtyBefore: 7, outQtyAfter: 0, unit: '박스' },
];
const snapshot = distributionEditSnapshot({ orderYear: '2026', orderWeek: '41-02', entries });
assert.equal(snapshot.week, '2026-41-02');
assert.equal(snapshot.committedCount, 3);
assert.deepEqual(snapshot.entries.map(e => [e.type, e.outQtyBefore, e.outQtyAfter]), [
  ['DISTRIBUTE', 48, 32], ['DISTRIBUTE', 0, 16], ['DISTRIBUTE', 7, 0],
]);
assert.equal(JSON.stringify(snapshot).includes('token'), false);
assert.throws(() => distributionEditSnapshot({ orderYear: '2026', orderWeek: '41-02', entries: [{ ...entries[0], outQtyAfter: 48 }] }));
assert.throws(() => distributionEditSnapshot({ orderYear: '2026', orderWeek: '41-02', entries: [
  { custKey: 478, prodKey: 2429, outQtyBefore: 0, outQtyAfter: 0, unit: '단' },
] }));
assert.throws(() => distributionEditSnapshot({ orderYear: '2026', orderWeek: '41-02', entries: Array(1001).fill(entries[0]) }));

const calls = [];
await insertDistributionEditAudit(async (statement, params) => {
  calls.push({ statement, params });
}, { orderYear: '2026', orderWeek: '41-02', actor: '담당자', entries });
assert.equal(calls.length, 1);
assert.match(calls[0].statement, /INSERT INTO SystemActionLog/);
assert.equal(calls[0].params.count.value, 3);
const payload = JSON.parse(calls[0].params.payload.value);
assert.deepEqual(payload, snapshot);
await assert.rejects(insertDistributionEditAudit(async () => { throw new Error('log insert failed'); },
  { orderYear: '2026', orderWeek: '41-02', actor: '담당자', entries }), /log insert failed/);
await insertDistributionEditAudit(async () => { throw new Error('no-op must skip log'); },
  { orderYear: '2026', orderWeek: '41-02', actor: '담당자', entries: [] });

const operation = parsePasteOperation({
  LogKey: 101, Actor: '담당자', ActionType: 'SHIPMENT_DISTRIBUTION_EDIT',
  Result: 'SUCCESS', ResultDesc: 'committed=3; verified=true', Payload: JSON.stringify(payload),
});
assert.equal(operation.status, 'committed');
assert.equal(operation.source, 'shipment-distribute');
assert.equal(operation.entries[0].type, 'DISTRIBUTE');
assert.equal(applicationStatus.sourceConfirmation({ operation, identity: 'chat/request', year: '2026', week: '41-02', requestCount: 1 }).confirmed, false,
  'absolute distribution edits never complete a Kakao request');
assert.deepEqual([operation.entries[2].outQtyBefore, operation.entries[2].outQtyAfter], [7, 0]);
assert.equal(matchesPasteOperation(operation, normalizeOrderHistorySearch({ year: '2026', week: '41-02' })), true);
assert.equal(matchesPasteOperation(operation, normalizeOrderHistorySearch({ year: '2025', week: '41-02' })), false);
assert.equal(parsePasteOperation({ ...operation, Payload: JSON.stringify({ ...payload, year: '2025' }) }), null);

const api = fs.readFileSync('pages/api/shipment/distribute.js', 'utf8');
assert.match(api, /OrderYear=@yr AND OrderWeek=@week/);
assert.match(api, /await insertDistributionEditAudit\(tQuery/);
assert.match(api, /if \(editPolicy\.action === 'delete'\) \{[\s\S]*?if \(oldQty !== 0\) \{\s*auditRows\.push/);
assert.match(api, /ISNULL\(sd\.Descr,N''\) AS ShipmentDescr/);
const historyApi = fs.readFileSync('pages/api/orders/paste-history.js', 'utf8');
assert.match(historyApi, /'SHIPMENT_DISTRIBUTION_EDIT'/);
console.log('shipment distribution audit tests passed');
