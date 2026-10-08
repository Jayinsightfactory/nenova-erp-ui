import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireInvoiceCostWorkflowLock,
  classifyInvoiceCostPostResponse,
  invoiceCostApprovalInvalidationEvents,
  invoiceCostRevisionIds,
  isInvoiceCostGenerationCurrent,
  runInvoiceCostStageRunner,
  shouldShowInvoiceCostPreviewNotice,
  verifyInvoiceCostReadback,
} from '../lib/invoiceReceiptCostWorkflow.js';

const document = { documentId: '11111111-1111-4111-8111-111111111111', revision: 7, warehouseKey: 901 };
const costId = '22222222-2222-4222-8222-222222222222';
const approvedReadback = (overrides = {}) => ({
  success: true,
  costs: {
    warehouseKey: 901, documentId: document.documentId, documentRevision: 7,
    status: 'APPROVED', documentCostStatus: 'APPROVED',
    currentActual: {
      costRevisionId: costId, documentId: document.documentId, documentRevision: 7, operationId: '44444444-4444-4444-8444-444444444444',
      warehouseKey: 901, revisionNo: 2, basis: 'ACTUAL', status: 'APPROVED', storedStatus: 'APPROVED', liveReceiptStatus: 'MATCH',
      currency: 'KRW', formulaId: 'CN_SEA_ACTUAL_V1', formulaVersion: '1.0.0', formulaSourceHash: 'aa'.repeat(32),
      approvedBy: 'approver', approvedAt: '2026-10-08T00:00:00.000Z', createdAt: '2026-10-08T00:00:00.000Z',
      orderYear: '2026', orderWeek: '41-01', invoiceNo: 'CN-1', comparisonOnly: false,
      lines: [{ lineId: '55555555-5555-4555-8555-555555555555', wdetailKey: 7001, prodKey: 10,
        unit: 'BUNCH', quantity: 10, costPerUnitKRW: 2800, totalCostKRW: 28000, componentAmounts: {} }],
      totalCostKRW: 28000,
    },
    operationId: '44444444-4444-4444-8444-444444444444',
    comparisons: [], revisions: [],
    ...overrides,
  },
});

test('2xx malformed save responses remain unknown, while explicit rejection is definite', () => {
  assert.equal(classifyInvoiceCostPostResponse(true, { success: true }).outcomeUnknown, true);
  assert.equal(classifyInvoiceCostPostResponse(true, {}).outcomeUnknown, true);
  assert.deepEqual(classifyInvoiceCostPostResponse(true, { success: false, error: 'rejected' }), { success: false, error: 'rejected' });
  assert.deepEqual(invoiceCostRevisionIds({ savedCostRevisionIds: [costId] }), [costId]);
  assert.deepEqual(invoiceCostRevisionIds({ idempotent: true, savedCostRevisionId: costId.toUpperCase() }), [costId]);
  assert.equal(classifyInvoiceCostPostResponse(true, { success: true, cost: { savedCostRevisionId: costId } }).outcomeUnknown, undefined);
  assert.equal(classifyInvoiceCostPostResponse(true, { success: true, cost: { savedCostRevisionIds: [costId] } }).outcomeUnknown, undefined);
});

test('same-identity lock blocks same-tick reentry and generation guards reject stale or unmounted work', () => {
  const locks = new Set();
  assert.equal(acquireInvoiceCostWorkflowLock(locks, 'doc-a:3'), true);
  assert.equal(acquireInvoiceCostWorkflowLock(locks, 'doc-a:3'), false);
  assert.equal(acquireInvoiceCostWorkflowLock(locks, 'doc-b:3'), true);
  assert.equal(isInvoiceCostGenerationCurrent({ mounted: true, currentIdentity: 'doc-a:3', currentGeneration: 4,
    expectedIdentity: 'doc-a:3', expectedGeneration: 4 }), true);
  assert.equal(isInvoiceCostGenerationCurrent({ mounted: true, currentIdentity: 'doc-b:3', currentGeneration: 5,
    expectedIdentity: 'doc-a:3', expectedGeneration: 4 }), false);
  assert.equal(isInvoiceCostGenerationCurrent({ mounted: false, currentIdentity: 'doc-a:3', currentGeneration: 5,
    expectedIdentity: 'doc-a:3', expectedGeneration: 4 }), false);
});

test('cost input edits invalidate save/verify, and automatic preview cannot replace pending outcome notices', () => {
  const events = invoiceCostApprovalInvalidationEvents(document);
  assert.deepEqual(events.map(event => [event.id, event.status]), [['costSave', 'waiting'], ['costVerify', 'waiting']]);
  assert.equal(events.every(event => event.documentId === document.documentId && event.revision === document.revision), true);
  assert.equal(shouldShowInvoiceCostPreviewNotice({ pending: true, saveStatus: 'unknown', verifyStatus: 'waiting' }), false);
  assert.equal(shouldShowInvoiceCostPreviewNotice({ pending: false, saveStatus: 'passed', verifyStatus: 'passed' }), false);
  assert.equal(shouldShowInvoiceCostPreviewNotice({ pending: false, saveStatus: 'waiting', verifyStatus: 'waiting' }), true);
});

test('failed calculation blocks POST and cannot complete the workflow', async () => {
  let posts = 0;
  const events = [];
  const result = await runInvoiceCostStageRunner({
    document, approvalRequested: true, reason: 'reviewed', request: { revision: 7 }, warehouseKey: 901,
    calculate: () => ({ status: 'REVIEW_REQUIRED' }),
    post: async () => { posts += 1; return { success: true, cost: {} }; },
    readback: async () => approvedReadback(), emit: event => events.push(event),
  });
  assert.equal(posts, 0);
  assert.equal(result.blocked, true);
  assert.equal(events.some(event => event.id === 'costVerify' && event.status === 'passed'), false);
});

test('save failure does not run GET or report verification complete', async () => {
  let gets = 0;
  const result = await runInvoiceCostStageRunner({
    document, approvalRequested: true, reason: 'reviewed', request: { revision: 7 }, warehouseKey: 901,
    calculate: () => ({ status: 'APPROVED' }),
    post: async () => ({ success: false, error: 'rejected' }),
    readback: async () => { gets += 1; return approvedReadback(); },
  });
  assert.equal(gets, 0);
  assert.equal(result.saved, false);
  assert.equal(result.ok, false);
});

test('unknown POST preserves the request outcome as unresolved and does not run GET', async () => {
  let gets = 0;
  const events = [];
  const result = await runInvoiceCostStageRunner({
    document, approvalRequested: true, reason: 'reviewed', request: { revision: 7, marker: 'same-request' }, warehouseKey: 901,
    calculate: () => ({ status: 'APPROVED' }),
    post: async request => { assert.equal(request.marker, 'same-request'); const error = new Error('network lost'); error.outcomeUnknown = true; throw error; },
    readback: async () => { gets += 1; return approvedReadback(); }, emit: event => events.push(event),
  });
  assert.equal(result.saved, 'unknown');
  assert.equal(gets, 0);
  assert.equal(events.find(event => event.id === 'costSave' && event.status === 'unknown')?.documentId, document.documentId);
});

test('successful POST with failed GET retries readback only', async () => {
  let posts = 0;
  let gets = 0;
  let savedCallbackCalls = 0;
  const options = {
    document, approvalRequested: true, reason: 'reviewed', request: { revision: 7 }, warehouseKey: 901,
    calculate: () => ({ status: 'APPROVED' }),
    post: async () => { posts += 1; return { success: true, cost: { savedCostRevisionIds: [costId] } }; },
    readback: async () => { gets += 1; if (gets === 1) throw new Error('temporary read outage'); return approvedReadback(); },
    onSaved: () => { savedCallbackCalls += 1; },
  };
  const first = await runInvoiceCostStageRunner(options);
  assert.equal(first.saved, true);
  assert.equal(first.ok, false);
  assert.equal(savedCallbackCalls, 0);
  const retry = await verifyInvoiceCostReadback({
    document, warehouseKey: 901, readback: options.readback, expectedCostRevisionIds: [costId], onSaved: options.onSaved,
  });
  assert.equal(retry.ok, true);
  assert.equal(posts, 1);
  assert.equal(gets, 2);
  assert.equal(savedCallbackCalls, 1);
});

test('idempotent POST singular revision id is used to verify the current actual revision', async () => {
  let gets = 0;
  const result = await runInvoiceCostStageRunner({
    document, approvalRequested: true, reason: 'reviewed', request: { revision: 7 }, warehouseKey: 901,
    calculate: () => ({ status: 'APPROVED' }),
    post: async () => ({ success: true, cost: { ...approvedReadback().costs, idempotent: true, savedCostRevisionId: costId } }),
    readback: async () => { gets += 1; return approvedReadback(); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.savedCostRevisionIds, [costId]);
  assert.equal(gets, 1);
});

test('readback for another document or revision is blocked', async () => {
  for (const mismatch of ['documentId', 'documentRevision']) {
    let callbacks = 0;
    const wrongScope = approvedReadback();
    if (mismatch === 'documentId') {
      wrongScope.costs.documentId = '33333333-3333-4333-8333-333333333333';
      wrongScope.costs.currentActual.documentId = wrongScope.costs.documentId;
    } else {
      wrongScope.costs.documentRevision = 8;
      wrongScope.costs.currentActual.documentRevision = 8;
    }
    const result = await verifyInvoiceCostReadback({
      document, warehouseKey: 901, readback: async () => wrongScope, onSaved: () => { callbacks += 1; },
    });
    assert.equal(result.ok, false, mismatch);
    assert.equal(result.saved, true, mismatch);
    assert.equal(callbacks, 0, mismatch);
  }
});
