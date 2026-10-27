const test = require('node:test');
require('./invoiceCostDownloadFeedback.test.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const modulePromise = import('../lib/invoiceCostOnlyWorkflow.js');
function fixture() {
  const calls = [];
  const document = { documentId: 'document', revision: 1, orderYear: '2026', orderWeek: '44-01', reviewedMetadata: { country: 'CN' }, operations: [] };
  return { calls, record: { document, dirty: false },
    saveDraft: async record => { calls.push('draft'); return { ...record.document, revision: 2 }; },
    previewLink: async document => { calls.push(`preview:${document.revision}`); return { canLink: true, baselineDigest: 'digest', warehouseKey: 123 }; },
    confirmLink: async () => { calls.push('confirm'); return true; },
    linkExisting: async () => { calls.push('link'); return { operationId: 'operation', warehouseKey: 123 }; },
    readDocument: async () => { calls.push('read'); return document; },
    verify: () => { calls.push('verify'); },
  };
}
test('cost-only existing receipt links and verifies without a receipt commit dependency', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise; const f = fixture();
  await prepareInvoiceCostOnly(f);
  assert.deepEqual(f.calls, ['preview:1', 'confirm', 'link', 'read', 'verify']);
});
test('dirty unlinked draft is saved once then the saved revision is matched', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise; const f = fixture(); f.record.dirty = true;
  await prepareInvoiceCostOnly(f);
  assert.deepEqual(f.calls, ['draft', 'preview:2', 'confirm', 'link', 'read', 'verify']);
});
test('already committed web receipts in every country only read back', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise;
  for (const country of ['CN', 'NL', 'TH', 'CO', 'EC', 'AU', 'US', 'VN']) {
    const f = fixture(); f.record.document.reviewedMetadata.country = country;
    f.record.document.operations = [{ status: 'COMMITTED', documentRevision: 1 }];
    await prepareInvoiceCostOnly(f); assert.deepEqual(f.calls, ['read', 'verify']);
  }
});
test('pending, unknown, dirty committed and stale committed never save or link', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise;
  for (const setup of [f => f.record.pendingOperation = {}, f => f.record.recoveryRequired = true,
    f => { f.record.dirty = true; f.record.document.operations = [{ status:'COMMITTED', documentRevision:1 }]; },
    f => { f.record.document.operations = [{ status:'COMMITTED', documentRevision:0 }]; }]) {
    const f = fixture(); setup(f); await assert.rejects(prepareInvoiceCostOnly(f)); assert.deepEqual(f.calls, []);
  }
});
test('unsupported native country never falls back to receipt registration', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise; const f = fixture(); f.record.document.reviewedMetadata.country = 'CO';
  await assert.rejects(prepareInvoiceCostOnly(f), /지원하지 않습니다/); assert.deepEqual(f.calls, []);
});
test('server mismatch, zero/omitted canLink, cancel and changed selection never link', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise;
  for (const allowed of [undefined, false, 0, 'true']) {
    const f = fixture(); f.previewLink = async () => ({ canLink: allowed, baselineDigest: 'hash', warehouseKey: 123 });
    await assert.rejects(prepareInvoiceCostOnly(f)); assert.deepEqual(f.calls, []);
  }
  const mismatch = fixture(); mismatch.previewLink = async () => { throw new Error('다른 연도'); };
  await assert.rejects(prepareInvoiceCostOnly(mismatch), /다른 연도/); assert.deepEqual(mismatch.calls, []);
  const cancelled = fixture(); cancelled.confirmLink = async () => false;
  assert.equal(await prepareInvoiceCostOnly(cancelled), null); assert.deepEqual(cancelled.calls, ['preview:1']);
  const changed = fixture(); let current = true; changed.isCurrent = () => current;
  changed.previewLink = async () => { current = false; return { canLink: true }; };
  await assert.rejects(prepareInvoiceCostOnly(changed), /선택 문서/); assert.deepEqual(changed.calls, []);
});
test('link/readback failures propagate and do not retry or register', async () => {
  const { prepareInvoiceCostOnly } = await modulePromise;
  for (const stage of ['linkExisting', 'readDocument', 'verify']) {
    const f = fixture(); f[stage] = () => { throw new Error(stage); };
    await assert.rejects(prepareInvoiceCostOnly(f), new RegExp(stage));
    assert.ok(f.calls.filter(call => call === 'link').length <= 1);
  }
});
test('UI preserves mounted drafts and separates explicit receipt from cost approval', () => {
  const source = fs.readFileSync(path.join(root, 'components/import-tools/InvoiceReceiptWorkbench.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/import/tools.js'), 'utf8');
  assert.match(page, /hidden=\{packingWorkMode!=='upload'\}/);
  assert.match(page, /hidden=\{packingWorkMode==='upload'\}/);
  assert.match(source, /hidden=\{workspaceMode !== 'cost'\}/);
  assert.match(source, /autoSaveRequested=\{false\}/);
  assert.match(source, /autoProcess=\{workspaceMode === 'cost' && receiptReadbackPassed\}/);
  assert.match(source, /disabled=\{currentRevisionCommitted \|\| Boolean\(busy\)/);
  assert.doesNotMatch(source, /setRunThroughCostId|runThroughCostId/);
});
