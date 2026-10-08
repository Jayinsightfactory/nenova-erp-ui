import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getInvoiceDocument,
  listInvoiceDocuments,
  normalizeInvoiceDraft,
  saveInvoiceDraft,
} from '../lib/invoiceReceiptDocuments.js';

const adapterReady = import('../lib/importPackingReceiptAdapter.js');

const IDS = {
  document: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  line: '33333333-3333-4333-8333-333333333333',
  operation: '44444444-4444-4444-8444-444444444444',
  part: '55555555-5555-4555-8555-555555555555',
};

const types = new Proxy({ MAX: 'MAX' }, { get(target, key) {
  if (key in target) return target[key];
  return (...args) => `${String(key)}(${args.join(',')})`;
} });
const values = params => Object.fromEntries(Object.entries(params || {}).map(([key, item]) => [key, item?.value]));
const rowVersion = value => Buffer.from(`000000000000000${value}`.slice(-16), 'hex');

function validDraft(overrides = {}) {
  return {
    documentId: IDS.document,
    orderYear: '2026', orderWeek: '41-01', sourceHash: 'ab'.repeat(32), originalFileName: ' invoice.xlsx ',
    farmKey: 7, invoiceNo: ' INV-1 ', invoiceYear: '2026', rawMetadata: { source: 'upload' },
    reviewedMetadata: { country: 'CO' }, reason: 'reviewed',
    lines: [{ lineId: IDS.line, lineNo: 1, originalName: ' Freedom ', lengthText: '60cm', prodKey: 99,
      boxQuantity: 0, bunchQuantity: '1.250000', stemQuantity: null, priceUnit: 'stem', unitPrice: '0.125000',
      currency: 'usd', lineAmount: '12.5', sourceEvidence: { cell: 'A2' }, reviewed: { ok: true } }],
    ...overrides,
  };
}

function createFakeDb(seed = {}) {
  const state = {
    documents: new Map(), lines: [], history: [], operations: [], queries: [], nextHistory: 1,
    ...seed,
  };
  if (!(state.documents instanceof Map)) state.documents = new Map(state.documents.map(row => [String(row.DocumentId).toLowerCase(), row]));
  const execute = async (sqlText, rawParams) => {
    const p = values(rawParams); state.queries.push({ sql: sqlText, params: p, rawParams });
    if (sqlText.includes('lock-document')) {
      const d = state.documents.get(String(p.documentId).toLowerCase());
      return { recordset: d ? [{ ...d, HasCommittedOperation: state.operations.some(o => o.DocumentId === d.DocumentId && o.Status === 'COMMITTED') ? 1 : 0 }] : [] };
    }
    if (sqlText.includes('check-business-key')) {
      const found = [...state.documents.values()].find(d => d.DocumentId !== p.documentId && Buffer.isBuffer(d.BusinessKeyHash) && d.BusinessKeyHash.equals(p.businessKeyHash));
      return { recordset: found ? [{ DocumentId: found.DocumentId }] : [] };
    }
    if (sqlText.includes('insert-document')) {
      state.documents.set(p.documentId, { DocumentId: p.documentId, OrderYear: p.orderYear, OrderWeek: p.orderWeek,
        Revision: p.revision, FarmKey: p.farmKey, InvoiceNo: p.invoiceNo, InvoiceYear: p.invoiceYear,
        SourceHash: p.sourceHash, OriginalFileName: p.originalFileName, BusinessKeyHash: p.businessKeyHash,
        ReceiptStatus: p.receiptStatus, CostStatus: p.costStatus, RawMetadataJson: p.rawMetadataJson,
        ReviewedMetadataJson: p.reviewedMetadataJson, CreatedBy: p.actor, CreatedAt: p.now,
        UpdatedBy: p.actor, UpdatedAt: p.now, RowVersion: rowVersion(1) });
      return { recordset: [] };
    }
    if (sqlText.includes('update-document')) {
      const d = state.documents.get(p.documentId);
      const matches = d && d.Revision === p.expectedRevision && (!p.expectedRowVersion || d.RowVersion.equals(p.expectedRowVersion));
      if (!matches) return { recordset: [{ Affected: 0 }] };
      Object.assign(d, { OrderYear: p.orderYear, OrderWeek: p.orderWeek, Revision: p.revision, FarmKey: p.farmKey,
        InvoiceNo: p.invoiceNo, InvoiceYear: p.invoiceYear, BusinessKeyHash: p.businessKeyHash,
        ReceiptStatus: p.receiptStatus, CostStatus: p.costStatus, ReviewedMetadataJson: p.reviewedMetadataJson,
        UpdatedBy: p.actor, UpdatedAt: p.now, RowVersion: rowVersion(Number(d.Revision) + 1) });
      return { recordset: [{ Affected: 1 }] };
    }
    if (sqlText.includes('insert-line')) {
      state.lines.push({ DocumentId: p.documentId, Revision: p.revision, LineId: p.lineId, LineNo: p.lineNo,
        OriginalName: p.originalName, LengthText: p.lengthText, ProdKey: p.prodKey, BoxQuantity: p.boxQuantity,
        BunchQuantity: p.bunchQuantity, StemQuantity: p.stemQuantity, PriceUnit: p.priceUnit, UnitPrice: p.unitPrice,
        Currency: p.currency, LineAmount: p.lineAmount, SourceEvidenceJson: p.sourceEvidenceJson, ReviewedJson: p.reviewedJson });
      return { recordset: [] };
    }
    if (sqlText.includes('insert-history')) {
      state.history.push({ HistoryId: state.nextHistory++, DocumentId: p.documentId, Revision: p.revision, OperationId: null,
        Action: p.action, BeforeJson: p.beforeJson, AfterJson: p.afterJson, Reason: p.reason, Actor: p.actor, CreatedAt: p.now });
      return { recordset: [] };
    }
    if (sqlText.includes('get-document')) {
      const d = state.documents.get(String(p.documentId).toLowerCase()); return { recordset: d ? [{ ...d }] : [] };
    }
    if (sqlText.includes('get-lines')) return { recordset: state.lines.filter(x => x.DocumentId === p.documentId && x.Revision === p.revision).sort((a, b) => a.LineNo - b.LineNo) };
    if (sqlText.includes('get-history')) return { recordset: state.history.filter(x => x.DocumentId === p.documentId) };
    if (sqlText.includes('get-operations')) return { recordset: state.operations.filter(x => x.DocumentId === p.documentId) };
    if (sqlText.includes('list-documents')) return { recordset: [...state.documents.values()].filter(x => x.OrderYear === p.orderYear && x.OrderWeek === p.orderWeek).map(x => ({ ...x, LineCount: state.lines.filter(l => l.DocumentId === x.DocumentId && l.Revision === x.Revision).length })) };
    throw new Error(`Unhandled SQL: ${sqlText}`);
  };
  const withTransactionFn = async (callback, options) => { state.transactionOptions = options; return callback(execute); };
  return { state, queryFn: execute, withTransactionFn };
}

test('normalizeInvoiceDraft bounds fields, preserves null versus zero, and prepares exact decimals', () => {
  const draft = normalizeInvoiceDraft(validDraft());
  assert.equal(draft.originalFileName, 'invoice.xlsx');
  assert.equal(draft.lines[0].boxQuantity, '0');
  assert.equal(draft.lines[0].bunchQuantity, '1.25');
  assert.equal(draft.lines[0].stemQuantity, null);
  assert.equal(draft.lines[0].currency, 'USD');
  assert.throws(() => normalizeInvoiceDraft(validDraft({ sourceHash: 'not-a-hash' })), /SHA-256/);
  assert.equal(normalizeInvoiceDraft(validDraft({ lines: [{ ...validDraft().lines[0], unitPrice: '-1', lineAmount: '-10' }] })).lines[0].unitPrice, '-1', 'credit price remains representable because V1 only forbids negative quantities');
  assert.throws(() => normalizeInvoiceDraft(validDraft({ lines: [{ ...validDraft().lines[0], boxQuantity: '1.0000001' }] })), /decimal\(18,6\)/);
});

test('normalizes the actual adapter UUIDv8 payload and common Number decimals without losing null or zero', async () => {
  const adapter = await adapterReady;
  const [document] = await adapter.adaptPackingReceipts({
    sourceHash: '9a'.repeat(32), fileName: '2026_41-01_CN.xlsx', country: 'CN', reviewConfirmed: true,
    invoices: [{ invoice: 'CN-V8', date: '2026-10-08', currency: 'CNY', products: [
      { description: 'ROSE V8', pcs: 0, total_bunch: 0.07, total_stems: null, u_price: 0.29, t_price: 0 },
    ] }],
    excels: [{ products: [] }], products: [],
  });
  const payload = adapter.toReceiptDraftPayload(document, 'adapter integration fixture');
  const draft = normalizeInvoiceDraft(payload);
  assert.match(draft.documentId, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(draft.lines[0].lineId, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(draft.lines[0].boxQuantity, '0');
  assert.equal(draft.lines[0].bunchQuantity, '0.07');
  assert.equal(draft.lines[0].stemQuantity, null);
  assert.equal(draft.lines[0].unitPrice, '0.29');
  assert.equal(draft.lines[0].lineAmount, '0');
  assert.equal(draft.expectedRevision, null, 'adapter new-document revision 0 is treated as omitted, never as revision 0');
  assert.equal(normalizeInvoiceDraft(validDraft({ lines: [{ ...validDraft().lines[0], unitPrice: 100000000000 }] })).lines[0].unitPrice, '100000000000');
  assert.equal(normalizeInvoiceDraft(validDraft({ lines: [{ ...validDraft().lines[0], unitPrice: 0.1 + 0.2 }] })).lines[0].unitPrice, '0.3');
  assert.throws(() => normalizeInvoiceDraft(validDraft({ lines: [{ ...validDraft().lines[0], unitPrice: 0.0000001 }] })), /decimal\(18,6\)/);
});

test('saveInvoiceDraft creates an append-only revision with bound decimal parameters and retries disabled', async () => {
  const db = createFakeDb();
  const saved = await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types, input: validDraft(), actor: 'server-user' });
  assert.equal(saved.revision, 1); assert.equal(saved.updatedBy, 'server-user');
  assert.equal(saved.lines[0].boxQuantity, '0'); assert.equal(saved.lines[0].stemQuantity, null);
  assert.deepEqual(db.state.transactionOptions, { retries: 0 });
  const insert = db.state.queries.find(call => call.sql.includes('insert-line'));
  assert.equal(insert.rawParams.unitPrice.type, 'Decimal(18,6)');
  assert.equal(insert.rawParams.lineAmount.type, 'Decimal(18,6)');
  assert.equal(db.state.history[0].Action, 'CREATE_DRAFT');
  assert.ok(db.state.queries.every(call => !/\b(?:WarehouseMaster|WarehouseDetail|OrderMaster|ShipmentDetail|ProductStock|StockHistory)\b/i.test(call.sql)));
});

test('revision locks the document, preserves original source evidence, and marks linked cost stale', async () => {
  const db = createFakeDb();
  await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types, input: validDraft(), actor: 'creator' });
  const original = { ...db.state.documents.get(IDS.document), SourceHash: Buffer.from(db.state.documents.get(IDS.document).SourceHash), RawMetadataJson: db.state.documents.get(IDS.document).RawMetadataJson };
  db.state.operations.push({ OperationId: IDS.operation, DocumentId: IDS.document, DocumentRevision: 1, ReceiptPartId: IDS.part,
    RequestHash: Buffer.from('cd'.repeat(32), 'hex'), Action: 'CREATE_RECEIPT', Status: 'COMMITTED', WarehouseKey: 123,
    ResultJson: '{"ok":true}', ErrorCode: null, Actor: 'writer', CreatedAt: new Date(), CompletedAt: new Date() });
  const revised = await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types,
    input: validDraft({ expectedRevision: 1, expectedRowVersion: original.RowVersion.toString('hex'), sourceHash: 'ef'.repeat(32),
      originalFileName: 'changed.xlsx', rawMetadata: { forged: true }, reviewedMetadata: { country: 'EC', inputDate: '2026-10-08' } }), actor: 'editor', documentId: IDS.document });
  const stored = db.state.documents.get(IDS.document);
  assert.equal(revised.revision, 2); assert.equal(revised.receiptStatus, 'COMMITTED'); assert.equal(revised.costStatus, 'STALE');
  assert.equal(revised.operations.length, 1); assert.equal(revised.operations[0].documentId, IDS.document);
  assert.equal(revised.operations[0].warehouseKey, 123); assert.deepEqual(revised.operations[0].result, { ok: true });
  assert.ok(stored.SourceHash.equals(original.SourceHash)); assert.equal(stored.RawMetadataJson, original.RawMetadataJson);
  assert.equal(stored.OriginalFileName, original.OriginalFileName);
  assert.equal(db.state.lines.filter(line => line.Revision === 1).length, 1);
  assert.equal(db.state.lines.filter(line => line.Revision === 2).length, 1);
  assert.equal(db.state.history.at(-1).OperationId, null, 'new revision history must not point at an operation for an older revision');
  assert.equal(db.state.history.at(-1).Action, 'REVISE_COMMITTED_DOCUMENT');
});

test('a committed document keeps order and farm/invoice identity while allowing in-year metadata dates', async () => {
  const db = createFakeDb();
  await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types, input: validDraft(), actor: 'creator' });
  db.state.operations.push({ OperationId: IDS.operation, DocumentId: IDS.document, DocumentRevision: 1, ReceiptPartId: IDS.part,
    RequestHash: Buffer.from('cd'.repeat(32), 'hex'), Action: 'CREATE_RECEIPT', Status: 'COMMITTED', WarehouseKey: 123,
    ResultJson: null, ErrorCode: null, Actor: 'writer', CreatedAt: new Date(), CompletedAt: new Date() });
  await assert.rejects(saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types,
    input: validDraft({ expectedRevision: 1, orderWeek: '42-01' }), actor: 'editor', documentId: IDS.document }),
  error => error.code === 'INVOICE_COMMITTED_SCOPE_CONFLICT');
  await assert.rejects(saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types,
    input: validDraft({ expectedRevision: 1, reviewedMetadata: { inputDate: '2025-12-31' } }), actor: 'editor', documentId: IDS.document }),
  error => error.code === 'INVOICE_COMMITTED_METADATA_DATE_OUT_OF_SCOPE');
});

test('revision and rowVersion conflicts fail closed', async () => {
  const db = createFakeDb();
  await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types, input: validDraft(), actor: 'creator' });
  await assert.rejects(saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types,
    input: validDraft({ expectedRevision: 9 }), actor: 'editor', documentId: IDS.document }), error => error.code === 'INVOICE_REVISION_CONFLICT');
  await assert.rejects(saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types,
    input: validDraft({ expectedRevision: 1, expectedRowVersion: 'ffffffffffffffff' }), actor: 'editor', documentId: IDS.document }), error => error.code === 'INVOICE_ROW_VERSION_CONFLICT');
});

test('duplicate business identity is rejected independently of order week', async () => {
  const db = createFakeDb();
  await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types, input: validDraft(), actor: 'creator' });
  await assert.rejects(saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types,
    input: validDraft({ documentId: IDS.other, orderWeek: '42-01', lines: [{ ...validDraft().lines[0], lineId: IDS.other }] }), actor: 'creator' }),
  error => error.code === 'INVOICE_BUSINESS_KEY_CONFLICT');
});

test('get and list return camelCase current revision data and summaries', async () => {
  const db = createFakeDb();
  await saveInvoiceDraft({ withTransactionFn: db.withTransactionFn, types, input: validDraft(), actor: 'creator' });
  const detail = await getInvoiceDocument({ queryFn: db.queryFn, types, documentId: IDS.document });
  const list = await listInvoiceDocuments({ queryFn: db.queryFn, types, orderYear: '2026', orderWeek: '41-01' });
  assert.equal(detail.documentId, IDS.document); assert.equal(detail.lines.length, 1); assert.equal(detail.history.length, 1);
  assert.equal(list.length, 1); assert.equal(list[0].lineCount, 1); assert.ok(!('lines' in list[0]));
});
