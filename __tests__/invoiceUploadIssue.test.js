import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUploadIssue} from '../lib/invoiceUploadIssue.js';
const base={eventId:'10000000-0000-4000-8000-000000000101',fileName:'42-1.pdf',code:'REVIEW_BLOCKED',count:1};
test('review blocker keeps actionable reason and retry identity, not caller actor or documents',()=>{
 const p=normalizeUploadIssue({...base,detail:'인보이스 1: 인쇄 날짜 확인 사유를 입력하세요.',actor:'spoof',source:{secret:'no'}});
 assert.equal(p.detail,'인보이스 1: 인쇄 날짜 확인 사유를 입력하세요.');assert.equal(p.eventId,base.eventId);assert.equal(p.actor,undefined);assert.equal(p.source,undefined);
});
test('legacy events remain valid; invalid or oversized log rejected',()=>{
 assert.equal(normalizeUploadIssue({...base,code:'MATCH_REQUIRED',count:0}).count,0);
 for(const patch of [{code:'COMMITTED'},{count:-1},{detail:{}},{detail:'x'.repeat(2001)}])assert.throws(()=>normalizeUploadIssue({...base,...patch}));
});
