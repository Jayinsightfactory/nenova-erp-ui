import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyInvoiceReceiptLive } from '../lib/invoiceReceiptCost.js';

const id = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const body = { documentRevision: 2, sourceHash: 'a'.repeat(64), stage: 'validation', status: 'running', attemptId, eventId };
function load(path, names, dependencies) {
  const source = fs.readFileSync(path, 'utf8').replace(/^import .*;\s*$/gm, '').replace(/export default[^;]+;/g, '').replace(/export /g, '');
  return new Function(...Object.keys(dependencies), `${source}\nreturn {${names}};`)(...Object.values(dependencies));
}
const { appendInvoiceReceiptStageEvent: append } = load('lib/invoiceReceiptStageLog.js', 'appendInvoiceReceiptStageEvent', {
  createHash, getInvoiceDocument: undefined, readInvoiceCosts: undefined, verifyInvoiceReceiptLive: undefined,
});
function harness() {
  const document = { documentId: id, revision: 2, sourceHash: body.sourceHash, orderYear: '2026', orderWeek: '41-02', invoiceNo: 'TEST',
    lines: [{ lineId: attemptId, prodKey: 7300 }], operations: [] };
  const rows = [], queries = [];
  let live = { matches: true }, costs = null;
  const queryFn = async (sql, params) => {
    queries.push(sql);
    if (sql.includes('lock-document')) return { recordset: [{ DocumentId: id }] };
    if (sql.includes('find-event')) return { recordset: rows.filter(row => JSON.parse(row.AfterJson).eventId === params.eventId.value) };
    if (sql.includes('invoice-stage:append')) {
      const row = { HistoryId: rows.length + 1, AfterJson: params.after.value, Actor: params.actor.value, CreatedAt: new Date('2026-10-12T00:00:00Z') };
      rows.push(row); return { recordset: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  let queue = Promise.resolve();
  const withTransactionFn = callback => {
    const next = queue.then(() => callback(queryFn)); queue = next.catch(() => {}); return next;
  };
  return { document, rows, queries, setLive: value => { live = value; }, setCosts: value => { costs = value; },
    run: (input = body, actor = 'importA', overrides = {}) => append({ withTransactionFn, types: {}, documentId: id, actor, input,
      getDocumentFn: async () => document, verifyLiveFn: async () => live, readCostsFn: async () => costs, ...overrides }) };
}
function committed(h) {
  h.document.operations = [{ operationId, documentId: id, documentRevision: 2, status: 'COMMITTED', warehouseKey: 700,
    result: { operationId, documentId: id, revision: 2, warehouseKey: 700,
      receiptSnapshot: { header: { OrderYear: '2026', OrderWeek: '41-02', InvoiceNo: 'TEST' } },
      lineMappings: [{ lineId: attemptId, prodKey: 7300 }] } }];
}
test('team events append chronologically, actor server-owned, duplicate concurrent request writes once', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.run(), h.run()]);
  assert.equal(a.idempotent, false); assert.equal(b.idempotent, true); assert.equal(h.rows.length, 1);
  assert.equal(a.event.actor, 'importA'); assert.equal(a.event.evidence.origin, 'CLIENT_OBSERVED');
  await h.run({ ...body, eventId: attemptId, status: 'passed' }, 'importB');
  assert.equal(h.rows.length, 2); assert.equal(h.rows[1].Actor, 'importB');
  assert.deepEqual(h.document, harness().document);
  assert(h.queries.filter(q => /INSERT|UPDATE|DELETE|EXEC/i.test(q)).every(q => q.includes('INSERT dbo.WebInvoiceHistory')));
  assert(h.queries.some(q => q.includes('UPDLOCK,HOLDLOCK')));
});
test('same event different payload/actor conflicts without write', async () => {
  const h = harness(); await h.run();
  await assert.rejects(h.run({ ...body, status: 'failed' }), { code: 'STAGE_EVENT_CONFLICT' });
  await assert.rejects(h.run(body, 'importB'), { code: 'STAGE_EVENT_CONFLICT' });
  assert.equal(h.rows.length, 1);
});
test('strict request schema rejects arbitrary errors, ids, enum, code, length and revision', async () => {
  for (const patch of [{ rawError: 'secret' }, { actor: 'admin' }, { stage: 'other' }, { status: 'success' }, { eventId: 'x'.repeat(300) },
    { attemptId: [] }, { sourceHash: 'a' }, { documentRevision: '2' }, { documentRevision: 0 }, { code: 'arbitrary error' }, { code: null }]) {
    const h = harness(); await assert.rejects(h.run({ ...body, ...patch }), { code: 'STAGE_INPUT_INVALID' }); assert.equal(h.queries.length, 0);
  }
});
test('stale version or source is terminal including duplicate from an old revision', async () => {
  const h = harness(); await h.run(); h.document.revision = 3;
  await assert.rejects(h.run(), { code: 'STAGE_DOCUMENT_STALE' });
  const other = harness(); await assert.rejects(other.run({ ...body, sourceHash: 'b'.repeat(64) }), { code: 'STAGE_DOCUMENT_STALE' });
  assert.equal(other.rows.length, 0);
});
test('receipt passed requires current committed scope and fresh native validation', async () => {
  for (const stage of ['receipt', 'receiptVerify']) {
    const h = harness(); const input = { ...body, stage, status: 'passed' };
    await assert.rejects(h.run(input), { code: 'STAGE_RECEIPT_UNVERIFIED' });
    committed(h); h.document.operations[0].documentRevision = 1;
    await assert.rejects(h.run(input), { code: 'STAGE_RECEIPT_UNVERIFIED' });
    committed(h); h.setLive({ matches: false, issues: [{ code: 'HEADER_CHANGED' }] });
    await assert.rejects(h.run(input), { code: 'STAGE_RECEIPT_UNVERIFIED' }); assert.equal(h.rows.length, 0);
    h.setLive({ matches: true }); const ok = await h.run(input);
    assert.equal(ok.event.evidence.origin, 'SERVER_VERIFIED'); assert.equal(ok.event.evidence.orderYear, '2026');
  }
});
test('cross-year receipt cannot produce proof and browser calculation is never approval', async () => {
  const h = harness(); committed(h); h.document.operations[0].result.receiptSnapshot.header.OrderYear = '2025';
  await assert.rejects(h.run({ ...body, stage: 'receiptVerify', status: 'passed' }), { code: 'STAGE_RECEIPT_UNVERIFIED' });
  const result = await h.run({ ...body, stage: 'cost', status: 'passed' });
  assert.deepEqual(result.event.evidence, { origin: 'CLIENT_OBSERVED', kind: 'BROWSER_CALCULATION_REPORT', erpProof: false });
});
test('real read-only verifier detects native header/year, detail quantity/price and extra-row mutations', async () => {
  for (const mutation of ['none', 'year', 'weight', 'quantity', 'price', 'extra']) {
    const h = harness(); committed(h);
    const header = { WarehouseKey: 700, OrderYear: '2026', OrderWeek: '41-02', InvoiceNo: 'TEST', FarmName: 'TEST', OrderNo: '',
      InputDate: '2026-10-10', GrossWeight: 10, ChargeableWeight: 10, FreightRateUSD: null, DocFeeUSD: null, isDeleted: false };
    const detail = { WdetailKey: 800, WarehouseKey: 700, ProdKey: 7300, BoxQuantity: 1, BunchQuantity: 10, SteamQuantity: 100,
      OutQuantity: 10, EstQuantity: 10, UPrice: 2, TPrice: 20 };
    Object.assign(h.document.lines[0], { boxQuantity: 1, bunchQuantity: 10, stemQuantity: 100, unitPrice: 2, lineAmount: 20 });
    Object.assign(h.document.operations[0].result, { receiptDigest: 'a'.repeat(64), receiptSnapshot: { header, details: [detail] },
      lineMappings: [{ ...h.document.lines[0], wdetailKey: 800, outQuantity: 10, unit: '단' }] });
    const nativeHeader = { ...header }, nativeDetails = [{ ...detail }];
    if (mutation === 'year') nativeHeader.OrderYear = '2025';
    if (mutation === 'weight') nativeHeader.GrossWeight = 11;
    if (mutation === 'quantity') nativeDetails[0].BunchQuantity = 11;
    if (mutation === 'price') nativeDetails[0].UPrice = 3;
    if (mutation === 'extra') nativeDetails.push({ ...detail, WdetailKey: 801 });
    const reads = [];
    const verifyLiveFn = args => verifyInvoiceReceiptLive({ ...args, types: { Int: 'Int' }, queryFn: async sql => {
      reads.push(sql); return { recordset: sql.includes('validate-live-receipt-header') ? [nativeHeader] : nativeDetails };
    } });
    const promise = h.run({ ...body, stage: 'receiptVerify', status: 'passed' }, 'importA', { verifyLiveFn });
    if (mutation === 'none') assert.equal((await promise).event.evidence.erpProof, true);
    else { await assert.rejects(promise, { code: 'STAGE_RECEIPT_UNVERIFIED' }); assert.equal(h.rows.length, 0); }
    assert.equal(reads.length, 2); assert(reads.every(sql => !/\b(?:INSERT|UPDATE|DELETE|EXEC)\b/i.test(sql)));
  }
});
test('cost passed requires approved ACTUAL with current document operation and native MATCH', async () => {
  for (const stage of ['costSave', 'costVerify']) {
    const h = harness(); committed(h); const input = { ...body, stage, status: 'passed' };
    await assert.rejects(h.run(input), { code: 'STAGE_COST_UNVERIFIED' });
    const costs = { status: 'APPROVED', documentCostStatus: 'APPROVED', documentId: id, documentRevision: 2, operationId, warehouseKey: 700,
      currentActual: { basis: 'ACTUAL', status: 'APPROVED', liveReceiptStatus: 'MATCH', documentId: id, documentRevision: 2, operationId, warehouseKey: 700, costRevisionId: eventId } };
    h.setCosts({ ...costs, currentActual: { ...costs.currentActual, liveReceiptStatus: 'CHANGED' } });
    await assert.rejects(h.run(input), { code: 'STAGE_COST_UNVERIFIED' });
    h.setCosts(costs); assert.equal((await h.run(input)).event.evidence.kind, 'COST_APPROVED_VERIFIED');
  }
});
function api(appendEventFn) {
  return load('pages/api/import/receipts/[id]/stage-events.js', 'createInvoiceReceiptStageEventsHandler', {
    withAuth: fn => fn, withTransaction: undefined, sql: {}, appendInvoiceReceiptStageEvent: appendEventFn,
    canManageInvoiceReceipt: user => user?.userId === 'importA' && user?.accountActive !== false,
  }).createInvoiceReceiptStageEventsHandler();
}
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(p) { this.payload = p; return this; } }; }
test('API authorization/method prevent DB access; authenticated actor cannot be supplied by body', async () => {
  const calls = []; const handler = api(async input => { calls.push(input); return { event: {}, idempotent: false }; });
  for (const user of [undefined, { userId: 'other' }, { userId: 'importA', accountActive: false }]) {
    const res = response(); await handler({ method: 'POST', user }, res); assert.equal(res.statusCode, 403);
  }
  const method = response(); await handler({ method: 'GET' }, method); assert.equal(method.statusCode, 405); assert.equal(calls.length, 0);
  const ok = response(); await handler({ method: 'POST', query: { id }, user: { userId: 'importA' }, body }, ok);
  assert.equal(ok.statusCode, 200); assert.equal(calls[0].actor, 'importA'); assert.equal(ok.headers['Cache-Control'], 'no-store');
});
test('logging failure never tells client to redo receipt or leaks SQL/error payload', async () => {
  const res = response(); await api(async () => { throw new Error('password SQL raw data'); })({ method: 'POST', query: { id }, user: { userId: 'importA' }, body }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.payload.receiptRetryRequired, false); assert.equal(res.payload.stageLogOnly, true);
  assert(!JSON.stringify(res.payload).includes('password'));
});
