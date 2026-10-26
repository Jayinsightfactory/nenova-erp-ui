import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeReceiptSource, readExistingReceiptSource, draftConflictMessage } from '../lib/invoiceReceiptSourceResume.js';
import { runReceiptPreparation } from '../lib/invoiceReceiptWorkflow.js';
import { normalizeReceiptDocument, toReceiptDraftPayload } from '../lib/importPackingReceiptAdapter.js';

const fresh = () => ({ documentId: '11111111-1111-4111-8111-111111111111', sourceHash: 'a'.repeat(64),
  orderYear: '2026', orderWeek: '44-01', revision: null, receiptStatus: 'DRAFT',
  reviewedMetadata: { country: 'CO', inputDate: '' }, lines: [{ lineId: 'L1', prodKey: 12, bunchQuantity: 10 }] });
const saved = () => ({ ...fresh(), revision: 3, rowVersion: '0000000000000003',
  farmKey: 99, reviewedMetadata: { country: 'CO', inputDate: '2026-10-23' } });
const preview = document => ({ document, documentRevision: document.revision, canCommit: true, issues: [], baselineDigest: 'b'.repeat(64) });

test('only a proven 404 creates a new draft; auth/network errors never become POST', async () => {
  const source = fresh();
  assert.equal(await readExistingReceiptSource(source, async () => { throw { httpStatus:404, code:'INVOICE_DOCUMENT_NOT_FOUND' }; }), null);
  for (const error of [{httpStatus:403}, {httpStatus:500}, {httpStatus:404,code:'OTHER'}, new Error('offline')]) {
    await assert.rejects(readExistingReceiptSource(source, async () => { throw error; }));
  }
});
test('re-upload resumes saved values and version without writing or dropping matching', async () => {
  const record = resumeReceiptSource(fresh(), null, saved());
  const calls = [];
  const result = await runReceiptPreparation({ record, saveDraft: async () => { throw Error('must not save'); },
    previewDraft: async document => { calls.push('preview'); return preview(document); } });
  assert.equal(result.status,'WAITING_CONFIRMATION'); assert.deepEqual(calls,['preview']);
  assert.equal(result.document.revision,3); assert.equal(result.document.farmKey,99);
  assert.equal(result.document.reviewedMetadata.inputDate,'2026-10-23');
  assert.equal(result.document.lines[0].prodKey,12);
});
test('create, next again, source refresh, edit and next use POST once then PATCH with saved revision', async () => {
  let record=resumeReceiptSource(fresh(),null,null); const methods=[];
  const prepare=()=>runReceiptPreparation({record, previewDraft:async d=>preview(d), saveDraft:async d=>{
    const payload=toReceiptDraftPayload(d); methods.push(payload.expectedRevision == null ? 'POST' : `PATCH:${payload.expectedRevision}`);
    return {...d,revision:(d.revision||0)+1,rowVersion:'0000000000000001'};
  }});
  let result=await prepare(); assert.equal(result.status,'WAITING_CONFIRMATION');
  record={...record,document:result.document,dirty:false};
  record=resumeReceiptSource(fresh(),record,saved());
  result=await prepare(); assert.equal(result.status,'WAITING_CONFIRMATION');
  record={...record,dirty:true,document:{...record.document,farmKey:88}};
  result=await prepare(); assert.equal(result.document.revision,2);
  assert.deepEqual(methods,['POST','PATCH:1']);
});
test('source updates preserve workbench edits, revision, pending operation and preview unless changed',()=>{
  const source=fresh();
  const record={document:{...saved(),lines:[{...source.lines[0],bunchQuantity:15}]},sourceDocument:source,dirty:true,pendingOperation:{operationId:'pending'},preview:{old:true}};
  const same=resumeReceiptSource(structuredClone(source),record,null);
  assert.equal(same.document,record.document); assert.equal(same.preview,record.preview);
  const incoming=structuredClone(source);incoming.lines[0].prodKey=24;
  const changed=resumeReceiptSource(incoming,record,null);
  assert.equal(changed.document.revision,3);assert.equal(changed.document.rowVersion,record.document.rowVersion);
  assert.equal(changed.document.lines[0].prodKey,24);assert.equal(changed.document.lines[0].bunchQuantity,15);
  assert.equal(changed.document.reviewedMetadata.inputDate,'2026-10-23');assert.equal(changed.preview,null);
  assert.equal(changed.pendingOperation.operationId,'pending');
});
test('saved document must have matching source/year/week; positive revision required',()=>{
  for(const change of [{orderYear:'2025'},{orderWeek:'43-01'},{sourceHash:'c'.repeat(64)},{documentId:'other'},{revision:0}]) {
    assert.throws(()=>resumeReceiptSource(fresh(),null,{...saved(),...change}),/문서·원본/);
  }
});
test('null/empty/zero revision stay unsaved; positive revision is carried into PATCH payload',()=>{
  for(const revision of [null,undefined,'',0,'0']) {
    assert.equal(normalizeReceiptDocument({...fresh(),revision}).revision,null);
    assert.equal(toReceiptDraftPayload({...fresh(),revision}).expectedRevision,undefined);
  }
  assert.equal(toReceiptDraftPayload(saved()).expectedRevision,3);
});
test('concurrent draft conflicts explain recovery and propagate code without pretending success', async()=>{
  for(const code of ['INVOICE_DOCUMENT_ALREADY_EXISTS','INVOICE_REVISION_CONFLICT','INVOICE_ROW_VERSION_CONFLICT']){
    assert.match(draftConflictMessage(code),/같은 문서 다시 불러오기/);
    const result=await runReceiptPreparation({record:{document:fresh(),dirty:true},saveDraft:async()=>{throw Object.assign(new Error(draftConflictMessage(code)),{code,httpStatus:409});}});
    assert.equal(result.status,'FAILED');assert.equal(result.code,code);assert.equal(result.document.revision,null);
  }
});
