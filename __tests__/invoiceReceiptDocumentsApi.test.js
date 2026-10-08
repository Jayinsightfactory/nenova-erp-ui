import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function response() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }
const manager = { userId: 'import-user', deptName: '수입부', authority: 9, accountActive: true };

function loadAccess() {
  const source = fs.readFileSync('lib/invoiceReceiptAccess.js', 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/export\s+(?=function)/g, '');
  return new Function('hasFullWebAccess', 'isAdminUser', `${source}\nreturn canManageInvoiceReceipt;`)(
    user => String(user?.userId || '').toLowerCase() === 'nenovass3',
    user => Number(user?.authority) <= 1 || String(user?.deptName || '') === '대표',
  );
}

function loadApi(path, factoryName, overrides = {}) {
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/^import .*;\s*$/gm, '');
  source = source.replace(/export\s+(?=function)/g, '');
  source = source.replace(/export const config[\s\S]*?;\s*/g, '');
  source = source.replace(/export default[^;]+;\s*/g, '');
  const dependencies = {
    withAuth: fn => fn, query: async () => ({ recordset: [] }), withTransaction: async () => null, sql: {},
    canManageInvoiceReceipt: loadAccess(),
    InvoiceReceiptDocumentError: class InvoiceReceiptDocumentError extends Error {},
    listInvoiceDocuments: async () => [], saveInvoiceDraft: async () => ({}), getInvoiceDocument: async () => null,
    ...overrides,
  };
  const names = Object.keys(dependencies);
  return new Function(...names, `${source}\nreturn ${factoryName};`)(...names.map(name => dependencies[name]));
}

test('canManageInvoiceReceipt requires active identity and existing import/admin eligibility', () => {
  const canManageInvoiceReceipt = loadAccess();
  assert.equal(canManageInvoiceReceipt(manager), true);
  assert.equal(canManageInvoiceReceipt({ ...manager, accountActive: false }), false);
  assert.equal(canManageInvoiceReceipt({ userId: 'ordinary', deptName: '영업부', authority: 9 }), false);
  assert.equal(canManageInvoiceReceipt({ userId: 'admin', deptName: '영업부', authority: 1 }), true);
});

test('draft API denies unauthorized users before touching the database', async () => {
  let touched = false;
  const createHandler = loadApi('pages/api/import/receipts/drafts.js', 'createInvoiceReceiptDraftsHandler', {
    listInvoiceDocuments: async () => { touched = true; }, saveInvoiceDraft: async () => { touched = true; },
  });
  const handler = createHandler();
  const res = response();
  await handler({ method: 'GET', query: { orderYear: '2026', orderWeek: '41-01' }, user: { userId: 'ordinary', deptName: '영업부', authority: 9 } }, res);
  assert.equal(res.statusCode, 403); assert.equal(res.payload.code, 'INVOICE_RECEIPT_FORBIDDEN'); assert.equal(touched, false);
});

test('draft GET validates input and returns bound list output without a real DB', async () => {
  const calls = [];
  const createHandler = loadApi('pages/api/import/receipts/drafts.js', 'createInvoiceReceiptDraftsHandler', {
    listInvoiceDocuments: async input => { calls.push(input); if (input.orderWeek === 'bad') throw Object.assign(new Error('bad week'), { code: 'INVOICE_DRAFT_INVALID', statusCode: 400 }); return []; },
  });
  const handler = createHandler({ queryFn: 'fake-query', types: 'fake-types' });
  const ok = response(); await handler({ method: 'GET', query: { orderYear: '2026', orderWeek: '41-01' }, user: manager }, ok);
  assert.equal(ok.statusCode, 200); assert.deepEqual(ok.payload.documents, []); assert.equal(calls[0].orderYear, '2026'); assert.equal(calls[0].queryFn, 'fake-query');
  const bad = response(); await handler({ method: 'GET', query: { orderYear: '2026', orderWeek: 'bad' }, user: manager }, bad);
  assert.equal(bad.statusCode, 400); assert.equal(bad.payload.code, 'INVOICE_DRAFT_INVALID');
});

test('draft POST passes only the authenticated server actor to the store', async () => {
  let captured;
  const createHandler = loadApi('pages/api/import/receipts/drafts.js', 'createInvoiceReceiptDraftsHandler', {
    saveInvoiceDraft: async input => { captured = input; return { documentId: 'saved' }; },
  });
  const handler = createHandler({ withTransactionFn: 'fake-transaction', types: 'fake-types' });
  const res = response();
  await handler({ method: 'POST', user: manager, body: { actor: 'forged-client' } }, res);
  assert.equal(res.statusCode, 201); assert.equal(captured.actor, 'import-user');
  assert.equal(captured.input.actor, 'forged-client', 'raw body remains data but is never selected as actor');
  assert.equal(captured.withTransactionFn, 'fake-transaction');
});

test('document GET returns 404 and methods publish Allow', async () => {
  const createHandler = loadApi('pages/api/import/receipts/[id]/index.js', 'createInvoiceReceiptDocumentHandler');
  const handler = createHandler();
  const missing = response(); await handler({ method: 'GET', query: { id: '11111111-1111-4111-8111-111111111111' }, user: manager }, missing);
  assert.equal(missing.statusCode, 404); assert.equal(missing.payload.code, 'INVOICE_DOCUMENT_NOT_FOUND');
  const method = response(); await handler({ method: 'DELETE', query: { id: '11111111-1111-4111-8111-111111111111' }, user: manager }, method);
  assert.equal(method.statusCode, 405); assert.equal(method.headers.Allow, 'GET, PATCH');
});

test('PATCH rejects a route/body id mismatch before opening a transaction', async () => {
  let saves = 0;
  const createHandler = loadApi('pages/api/import/receipts/[id]/index.js', 'createInvoiceReceiptDocumentHandler', {
    saveInvoiceDraft: async ({ input, documentId }) => { saves += 1; if (input.documentId !== documentId) throw Object.assign(new Error('documentId does not match route'), { code: 'INVOICE_DRAFT_INVALID', statusCode: 400 }); },
  });
  const handler = createHandler();
  const res = response();
  await handler({ method: 'PATCH', query: { id: '11111111-1111-4111-8111-111111111111' }, user: manager,
    body: { documentId: '22222222-2222-4222-8222-222222222222', expectedRevision: 1, orderYear: '2026', orderWeek: '41-01',
      sourceHash: 'ab'.repeat(32), originalFileName: 'a.xlsx', rawMetadata: {}, reviewedMetadata: {},
      lines: [{ lineId: '33333333-3333-4333-8333-333333333333', lineNo: 1, originalName: 'Rose' }] } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.payload.code, 'INVOICE_DRAFT_INVALID'); assert.equal(saves, 1);
});

test('API source wires authentication and never accepts a body actor', () => {
  const drafts = fs.readFileSync('pages/api/import/receipts/drafts.js', 'utf8');
  const detail = fs.readFileSync('pages/api/import/receipts/[id]/index.js', 'utf8');
  assert.match(drafts, /withAuth\(createInvoiceReceiptDraftsHandler\(\)\)/);
  assert.match(detail, /withAuth\(createInvoiceReceiptDocumentHandler\(\)\)/);
  assert.match(drafts, /actor: req\.user\.userId/); assert.match(detail, /actor: req\.user\.userId/);
  assert.doesNotMatch(drafts, /req\.body\.actor/); assert.doesNotMatch(detail, /req\.body\.actor/);
});
