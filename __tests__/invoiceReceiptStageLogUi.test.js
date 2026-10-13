import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createInvoiceReceiptStageLogClient, currentInvoiceStageHistory, invoiceStageHistorySummary, invoiceCostExportEligibility, downloadInvoiceCostExport } from '../lib/invoiceReceiptStageLogClient.js';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const doc = { documentId: '11111111-1111-4111-8111-111111111111', revision: 1, sourceHash: 'a'.repeat(64), costStatus: 'PENDING' };
const actual = { documentId: doc.documentId, documentRevision: 1, warehouseKey: 123, costRevisionId: '22222222-2222-4222-8222-222222222222', status: 'APPROVED', storedStatus: 'APPROVED', basis: 'ACTUAL', liveReceiptStatus: 'MATCH', formulaId: 'CN_AIR_WEIGHT_CBM_V1' };
const ok = (extra = {}) => ({ ok: true, status: 200, json: async () => ({ success: true, ...extra }) });
const error = (status, code) => ({ ok: false, status, json: async () => ({ success: false, error: 'fixture failure', code }) });

test('audit payload is bounded, snapshot-bound, deduplicated, and unsaved documents never log', async () => {
 const calls = [], current = { ...doc };
 const client = createInvoiceReceiptStageLogClient({ uuid: randomUUID, fetchFn: async (url, options) => { calls.push({ url, options, payload: JSON.parse(options.body) }); return ok(); } });
 assert.equal(client.enqueue({ ...doc, revision: null }, { id: 'draft', status: 'running' }), null);
 assert.equal(client.enqueue(doc, { id: 'conversion', status: 'passed' }), null);
 assert.equal(client.enqueue(doc, { id: 'receipt', status: 'waiting' }), null);
 client.enqueue(current, { id: 'cost', status: 'running', message: 'SECRET', actor: 'spoof', code: 'UNKNOWN_CODE' });
 client.enqueue(current, { id: 'cost', status: 'running' });
 client.enqueue(current, { id: 'cost', status: 'passed', code: 'COST_INPUT_REQUIRED' });
 current.revision = 2; current.sourceHash = 'b'.repeat(64);
 await client.flush(); assert.equal(calls.length, 2);
 assert.equal(calls[0].payload.documentRevision, 1); assert.equal(calls[0].payload.sourceHash, doc.sourceHash);
 assert.equal(calls[0].payload.attemptId, calls[1].payload.attemptId);
 assert.notEqual(calls[0].payload.eventId, calls[1].payload.eventId);
 assert.deepEqual(Object.keys(calls[0].payload).sort(), ['attemptId', 'documentRevision', 'eventId', 'sourceHash', 'stage', 'status'].sort());
 assert.equal(calls[1].payload.code, 'COST_INPUT_REQUIRED');
 assert.ok(calls.every(c => c.options.method === 'POST' && c.url.endsWith('/stage-events')));
 assert.doesNotMatch(JSON.stringify(calls), /SECRET|spoof/);
});

test('log-only retry keeps event IDs, serial order and cannot replay ERP operations', async () => {
 const calls = []; let fail = true, active = 0, peak = 0;
 const client = createInvoiceReceiptStageLogClient({ uuid: randomUUID, fetchFn: async (url, options) => {
   active++; peak = Math.max(peak, active); calls.push({ url, payload: JSON.parse(options.body) }); await Promise.resolve(); active--;
   return fail ? error(503, 'UNAVAILABLE') : ok();
 } });
 client.enqueue(doc, { id: 'receiptVerify', status: 'running' });
 client.enqueue(doc, { id: 'receiptVerify', status: 'passed' });
 await client.flush(); assert.equal(calls.length, 1); assert.equal(client.snapshot().pending.length, 2);
 fail = false; await client.retry(); assert.equal(calls.length, 3); assert.equal(peak, 1);
 assert.deepEqual(calls[0].payload, calls[1].payload); assert.equal(calls[2].payload.status, 'passed');
 assert.equal(client.snapshot().pending.length, 0);
 assert.ok(calls.every(c => /\/stage-events$/.test(c.url)));
});

test('old scope retryable failure cannot block another document, and terminal failure cannot block new events', async () => {
 const calls = [];
 const client = createInvoiceReceiptStageLogClient({ uuid: randomUUID, fetchFn: async (_, options) => {
   const p = JSON.parse(options.body); calls.push(p);
   if (p.stage === 'receipt') return error(503, 'UNAVAILABLE');
   if (p.stage === 'validation') return error(409, 'STAGE_DOCUMENT_STALE');
   if (p.stage === 'draft') return error(400, 'STAGE_INPUT_INVALID');
   return ok();
 } });
 client.enqueue(doc, { id: 'receipt', status: 'passed' }); await client.flush();
 const next = { ...doc, revision: 2 };
 client.enqueue(next, { id: 'validation', status: 'passed' }); await client.flush();
 client.enqueue(next, { id: 'draft', status: 'passed' }); await client.flush();
 client.enqueue(next, { id: 'cost', status: 'passed' }); await client.flush();
 assert.equal(calls.at(-1).stage, 'cost');
 assert.equal(client.snapshot().pending.filter(p => p.terminal).length, 2);
 const count = calls.length; await client.retry(client.snapshot().pending.find(p => p.payload.documentRevision === 2).scope);
 assert.equal(calls.length, count, 'terminal events do not loop');
});

test('rejected proof remains visible but later verified attempt and retryable logs still progress', async () => {
 const calls = []; let rejectProof = true, failNetwork = true;
 const client = createInvoiceReceiptStageLogClient({ uuid: randomUUID, fetchFn: async (_, options) => {
   const p = JSON.parse(options.body); calls.push(p);
   if (p.stage === 'receipt' && rejectProof) return error(409, 'STAGE_RECEIPT_UNVERIFIED');
   if (p.stage === 'costSave' && failNetwork) return error(503, 'STAGE_LOG_UNAVAILABLE');
   return ok();
 } });
 client.enqueue(doc, { id: 'receipt', status: 'passed' }); await client.flush();
 rejectProof = false; client.enqueue(doc, { id: 'receipt', status: 'running' }); client.enqueue(doc, { id: 'receipt', status: 'passed' }); await client.flush();
 assert.equal(calls.length, 3); assert.notEqual(calls[0].attemptId, calls[2].attemptId);
 client.enqueue(doc, { id: 'costSave', status: 'passed' }); await client.flush();
 assert.equal(client.snapshot().pending.length, 2);
 failNetwork = false; await client.retry(client.snapshot().pending[0].scope);
 assert.equal(client.snapshot().pending.length, 1); assert.equal(client.snapshot().pending[0].terminal, true);
 assert.equal(calls.filter(p => p.eventId === calls[0].eventId).length, 1);
});

test('flat server evidence survives acknowledgment, current-revision history is chronological and Korean', () => {
 const event = { ...actual, eventId: randomUUID(), stage: 'costVerify', status: 'passed', evidence: { origin: 'SERVER_VERIFIED', erpProof: true }, historyId: '3', actor: 'tester', createdAt: '2026-10-12T03:00:00Z' };
 const scope = `${doc.documentId}:1:${doc.sourceHash}`;
 const history = currentInvoiceStageHistory({ ...doc, history: [
   { historyId: 'old', revision: 2, action: 'CREATE_DRAFT', createdAt: '2026-10-11T01:00:00Z' },
   { historyId: '1', revision: 1, action: 'APPROVE_INVOICE_COST', createdAt: '2026-10-12T01:00:00Z', actor: 'server' },
   { historyId: '2', revision: 1, action: 'WORKFLOW_STAGE', after: { stage: 'cost', status: 'passed', evidence: { origin: 'CLIENT_OBSERVED', erpProof: false } }, createdAt: '2026-10-12T02:00:00Z' },
 ] }, [{ scope, payload: { eventId: event.eventId }, serverEntry: event }]);
 assert.equal(history.length, 3); assert.equal(history[2].event.evidence.origin, 'SERVER_VERIFIED');
 assert.equal(invoiceStageHistorySummary(history[0]).title, '원가 승인');
 assert.equal(invoiceStageHistorySummary(history[1]).status, '계산 통과(화면 확인)');
 const summary = invoiceStageHistorySummary(history[2]);
 assert.equal(summary.status, '완료 확인'); assert.equal(summary.provenance, '서버 검증'); assert.equal(summary.actor, 'tester');
 assert.doesNotMatch(summary.time, /T03:00|Z$/); assert.match(summary.time, /12(?::00:00|시 0분 0초)/);
});

test('only current APPROVED ACTUAL MATCH CN AIR can export; lagging document status is not false-negative', () => {
 assert.equal(invoiceCostExportEligibility(doc, actual).allowed, true);
 for (const patch of [{ status: 'STALE' }, { storedStatus: 'STALE' }, { basis: 'EXPECTED_95' }, { liveReceiptStatus: 'MISMATCH' }, { documentRevision: 2 }, { costRevisionId: '' }]) assert.equal(invoiceCostExportEligibility(doc, { ...actual, ...patch }).allowed, false);
 assert.equal(invoiceCostExportEligibility({ ...doc, costStatus: 'STALE' }, actual).allowed, false);
 for (const formulaId of ['NL_AMOUNT_V1', 'CN_SEA_ACTUAL_V1']) {
   assert.equal(invoiceCostExportEligibility(doc, { ...actual, formulaId }).allowed, true);
 }
 assert.match(invoiceCostExportEligibility(doc, { ...actual, formulaId: 'UNVERIFIED_FORMULA' }).message, /양식 준비 중.*승인은 유효/);
});

test('download uses authenticated GET identifiers only; JSON/HTML errors never become spreadsheets', async () => {
 let request, saved;
 await downloadInvoiceCostExport(actual, { fetchFn: async (url, options) => {
   request = { url, options }; return { ok: true, headers: new Headers({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': "attachment; filename*=UTF-8''%EB%8F%84%EC%B0%A9.xlsx" }), blob: async () => new Blob(['fixture']) };
 }, saveBlob: async (blob, name) => { saved = { size: blob.size, name }; } });
 assert.match(request.url, /warehouseKey=123&costRevisionId=/); assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.body, undefined); assert.equal(request.options.method, undefined);
 assert.equal(saved.name, '도착.xlsx');
 for (const response of [{ ok: false, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => ({ error: 'STALE 재조회 필요' }) }, { ok: true, headers: new Headers({ 'Content-Type': 'text/html' }) }]) {
   await assert.rejects(downloadInvoiceCostExport(actual, { fetchFn: async () => response, saveBlob: () => assert.fail('must not download') }));
 }
 await downloadInvoiceCostExport(actual, { fetchFn: async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/octet-stream' }), blob: async () => new Blob(['stale']) }), isCurrent: () => false, saveBlob: () => assert.fail('old scope must not download') });
});

test('bounded UI compiles, history stays collapsed and download gates are explicit', () => {
 for (const name of ['InvoiceReceiptWorkbench', 'InvoiceReceiptCostReview', 'InvoiceArrivalCostPanel']) {
   const source = fs.readFileSync(new URL(`../components/import-tools/${name}.js`, import.meta.url), 'utf8');
   babel.transformSync(source, { filename: name+'.js', presets: [require('next/dist/compiled/babel/preset-react')], configFile: false, babelrc: false });
   if (name === 'InvoiceReceiptWorkbench') { assert.match(source, /<details><summary>처리 로그/); assert.doesNotMatch(source, /<details open>/); assert.match(source, /pendingStageLogs\.every\(item => item\.terminal\)/); }
   else { assert.match(source, /도착원가 양식 다운로드/); assert.match(source, /invoiceCostExportEligibility/); }
 }
});
