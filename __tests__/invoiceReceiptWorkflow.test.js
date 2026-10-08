import test from 'node:test';
import assert from 'node:assert/strict';
import { runReceiptPreparation, verifyReceiptDocument } from '../lib/invoiceReceiptWorkflow.js';

const base = () => ({ documentId: '11111111-1111-4111-8111-111111111111', sourceHash: 'a'.repeat(64),
  orderYear: '2026', orderWeek: '41-01', revision: 1, receiptStatus: 'DRAFT',
  reviewedMetadata: { country: 'CN' }, lines: [{ lineId: 'L1', bunchQuantity: 0 }] });
const preview = document => ({ canCommit: true, issues: [], documentRevision: document.revision,
  document, baselineDigest: 'b'.repeat(64) });
function committed(document = base()) {
  return { ...document, receiptStatus: 'COMMITTED', warehouseKey: 19, operations: [{
    operationId: 'operation1', documentRevision: document.revision, status: 'COMMITTED',
    result: { documentId: document.documentId, revision: document.revision, warehouseKey: 19 },
  }] };
}
function context(record = { document: base(), dirty: false }) {
  const calls = [], stages = [];
  return { calls, stages, record,
    saveDraft: async d => { calls.push('save'); return { ...d, revision: Number(d.revision || 0) + 1 }; },
    previewDraft: async d => { calls.push('preview'); return preview(d); },
    readDocument: async () => { calls.push('read'); return committed(record.document); },
    onStage: e => stages.push(e),
  };
}

test('readback must match the expected operation and every warehouse key', () => {
  const document = committed();
  assert.throws(() => verifyReceiptDocument(document, { ...document, operationId: 'different' }));
  assert.throws(() => verifyReceiptDocument(document, { ...document, warehouseKey: 20 }));
  document.operations[0].warehouseKey = 20;
  assert.throws(() => verifyReceiptDocument(document));
});

test('saved amendment validates its current revision instead of re-reading the prior committed revision', async () => {
  const document = committed();
  document.revision = 2;
  const ctx = context({ document, dirty: false });
  const result = await runReceiptPreparation(ctx);
  assert.deepEqual(ctx.calls, ['preview']);
  assert.equal(result.status, 'WAITING_CONFIRMATION');
  assert.equal(result.document.revision, 2);
});

test('all eight existing country paths stop at explicit receipt confirmation; zero preserved', async () => {
  for (const country of ['NL','CN','CO','EC','TH','AU','US','VN']) {
    const document = base(); document.reviewedMetadata.country = country;
    const ctx = context({ document, dirty: true });
    const result = await runReceiptPreparation(ctx);
    assert.equal(result.status, 'WAITING_CONFIRMATION', country);
    assert.deepEqual(ctx.calls, ['save','preview']);
    assert.equal(result.document.revision, 2);
    assert.equal(result.document.lines[0].bunchQuantity, 0);
    assert.equal(ctx.stages.at(-1).id, 'receipt');
    assert.equal(ctx.stages.at(-1).status, 'waiting');
  }
});
test('save network failure is unknown and cannot reach preview', async () => {
  const ctx = context({ document: base(), dirty: true });
  ctx.saveDraft = async () => { ctx.calls.push('save'); throw Error('network'); };
  assert.equal((await runReceiptPreparation(ctx)).status, 'UNKNOWN');
  assert.deepEqual(ctx.calls, ['save']);
});
test('known rejected save stops at draft without preview', async () => {
  const ctx = context({ document: base(), dirty: true });
  ctx.saveDraft = async () => { throw Object.assign(Error('stale'), { httpStatus: 409 }); };
  const result = await runReceiptPreparation(ctx);
  assert.equal(result.status, 'FAILED'); assert.equal(result.stage, 'draft');
  assert.deepEqual(ctx.calls, []);
});
test('malformed save success is unknown, never a reason to save the same draft again', async () => {
  const ctx = context({ document: base(), dirty: true });
  ctx.saveDraft = async d => ({ ...d, revision: 9 });
  const result = await runReceiptPreparation(ctx);
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.stage, 'draft');
  assert.deepEqual(ctx.calls, []);
});
test('validation failed does not undo successful draft or invoke receipt', async () => {
  const ctx = context({ document: base(), dirty: true });
  ctx.previewDraft = async d => ({ ...preview(d), canCommit: false, issues: [{ code: 'NO_MATCH' }] });
  const result = await runReceiptPreparation(ctx);
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.document.revision, 2);
  assert.equal(result.stage, 'validation');
});
test('source review warning and unknown operation stop before any request', async () => {
  for (const record of [
    { document: { ...base(), sourceWarnings: ['인식 검토 필요'] }, dirty: true },
    { document: base(), pendingOperation: { operationId: 'pending' } },
  ]) {
    const ctx = context(record); const result = await runReceiptPreparation(ctx);
    assert.ok(['BLOCKED','UNKNOWN'].includes(result.status)); assert.deepEqual(ctx.calls, []);
  }
});
test('unrecognized country and empty result are not successful conversion', async () => {
  for (const document of [{ ...base(), reviewedMetadata: { country: '??' } }, { ...base(), lines: [] }]) {
    const ctx = context({ document });
    assert.equal((await runReceiptPreparation(ctx)).status, 'BLOCKED');
    assert.deepEqual(ctx.calls, []);
  }
});
test('already committed current revision does readback only and never preview or save', async () => {
  const ctx = context({ document: committed(), dirty: false });
  assert.equal((await runReceiptPreparation(ctx)).status, 'RECEIPT_VERIFIED');
  assert.deepEqual(ctx.calls, ['read']);
});
test('failed receipt readback retries only read and preserves committed receipt', async () => {
  const ctx = context({ document: committed(), dirty: false });
  ctx.readDocument = async () => { ctx.calls.push('read'); throw Error('read failed'); };
  const result = await runReceiptPreparation(ctx);
  assert.equal(result.status, 'FAILED'); assert.equal(result.stage, 'receiptVerify');
  assert.equal(result.document.receiptStatus, 'COMMITTED');
  ctx.readDocument = async () => { ctx.calls.push('read'); return committed(); };
  assert.equal((await runReceiptPreparation(ctx)).status, 'RECEIPT_VERIFIED');
  assert.deepEqual(ctx.calls, ['read','read']);
});
test('scope/version/source mismatch and prior-year same week cannot advance', async () => {
  for (const patch of [{ orderYear: '2025' }, { orderWeek: '42-01' }, { revision: 3 },
    { documentId: 'other' }, { sourceHash: 'c'.repeat(64) }]) {
    const ctx = context(); ctx.previewDraft = async d => ({ ...preview(d), document: { ...d, ...patch } });
    assert.equal((await runReceiptPreparation(ctx)).status, 'FAILED');
    assert.throws(() => verifyReceiptDocument({ ...committed(), ...patch }, base()));
  }
});
test('missing or different committed operation/warehouse key cannot open cost stage', () => {
  for (const document of [{ ...committed(), operations: [] }, { ...committed(), warehouseKey: 21 },
    { ...committed(), operations: committed().operations.map(o => ({ ...o, documentRevision: 0 })) },
    { ...committed(), operations: committed().operations.map(o => ({ ...o, result: null })) }]) {
    assert.throws(() => verifyReceiptDocument(document, base()));
  }
});
test('changed selection while save runs does not launch next stage', async () => {
  const ctx = context({ document: base(), dirty: true }); let current = true;
  ctx.isCurrent = () => current;
  ctx.saveDraft = async d => { current = false; return { ...d, revision: 2 }; };
  assert.equal((await runReceiptPreparation(ctx)).status, 'CANCELLED');
  assert.deepEqual(ctx.calls, []);
  assert.equal(ctx.stages.some(s => s.id === 'validation'), false);
});
test('missing canCommit or malformed preview fingerprint fails closed', async () => {
  for (const patch of [{ canCommit: undefined }, { baselineDigest: '' }, { issues: undefined }, { documentRevision: 2 }]) {
    const ctx = context(); ctx.previewDraft = async d => ({ ...preview(d), ...patch });
    assert.ok(['BLOCKED','FAILED'].includes((await runReceiptPreparation(ctx)).status));
  }
});
