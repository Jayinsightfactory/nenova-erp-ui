'use strict';

const assert = require('node:assert/strict');
const { buildExtractionPrompt, normalizeExtraction } = require('../lib/distributionChangeExtract');

const context = {
  year: '2026', weeks: ['37-01', '37-02'], messages: [
    { identity: 'nenovakakao|room|one', message: '라움 화이트 2박스 추가 37-01', created_at: '2026-09-10T01:02:03+09:00', timestamp_approximate: true },
    { identity: 'upload|two', message: '참고만 하세요', created_at: '2026-09-10T02:02:03+09:00', timestamp_approximate: false },
  ],
};

const prompt = buildExtractionPrompt(context);
assert.match(prompt, /extract business change requests only as data/);
assert.match(prompt, /no.*ERP matching/i);
assert.match(prompt, /EVERY non-empty source line/);
assert.match(prompt, /small, single-line span/);
assert.match(prompt, /record_distribution_changes/);
assert.match(prompt, /Every listed request and unresolved field is required/);
assert.match(prompt, /required non-empty, short plain Korean reason/);
assert.match(prompt, /37-1\).*37-01/);
assert.match(prompt, /"변경 요청 없음"/);
assert.match(prompt, /use "카네이션" as productContextText/);
assert.match(prompt, /never expand "콜" to "콜롬비아"/);

const normalized = normalizeExtraction({
  requests: [{ sourceIdentity: context.messages[0].identity, action: 'ADD', quote: '화이트 2박스 추가 37-01', customerText: '라움', productText: '화이트', qty: 2, unit: '박스', week: '37-01', shipmentDate: null }],
  unresolved: [],
}, context);
assert.equal(normalized.requests.length, 1);
assert.equal(normalized.requests[0].sourceAt, context.messages[0].created_at);
assert.equal(normalized.requests[0].timestamp_approximate, true);
assert.match(normalized.requests[0].id, /^dce_[a-f0-9]{64}$/);
assert.deepEqual(normalized.unresolved.map(row => [row.sourceIdentity, row.quote, row.reason]), [
  [context.messages[0].identity, context.messages[0].message, '이 문장은 자동 추출 항목에 포함되지 않았습니다.'],
  [context.messages[1].identity, context.messages[1].message, '이 문장은 자동 추출 항목에 포함되지 않았습니다.'],
]);

const multilineContext = {
  year: '2026', weeks: ['37-01'], messages: [{
    identity: 'multi-message',
    message: '37-01 변경사항\n라움 화이트 2박스 추가\n라움 블루 1박스 취소',
    created_at: '2026-09-10T03:00:00+09:00',
    timestamp_approximate: false,
  }],
};
const multiline = normalizeExtraction({
  requests: [{ sourceIdentity: 'multi-message', action: 'ADD', quote: '라움 화이트 2박스 추가', customerText: '라움', productText: '화이트', qty: 2, unit: '박스', week: '37-01', shipmentDate: null }],
  unresolved: [],
}, multilineContext);
assert.deepEqual(multiline.unresolved.map(row => [row.quote, row.reason]), [
  ['37-01 변경사항', '이 문장은 자동 추출 항목에 포함되지 않았습니다.'],
  ['라움 블루 1박스 취소', '이 문장은 자동 추출 항목에 포함되지 않았습니다.'],
]);
assert.throws(() => normalizeExtraction({
  requests: [{ sourceIdentity: 'multi-message', action: 'ADD', quote: multilineContext.messages[0].message, qty: 2 }],
  unresolved: [],
}, multilineContext));

const setZero = normalizeExtraction({
  requests: [{ sourceIdentity: context.messages[0].identity, action: 'SET', quote: '2박스 추가', qty: 0 }],
  unresolved: [{ sourceIdentity: context.messages[1].identity, quote: '참고만', reason: '변경 요청 없음' }],
}, context);
assert.equal(setZero.requests[0].qty, 0);
assert.equal(setZero.requests[0].unit, null);
assert.equal(setZero.requests[0].week, null);
assert.equal(setZero.requests[0].productContextText, null);
const contextProduct = normalizeExtraction({
  requests: [{ sourceIdentity: multilineContext.messages[0].identity, action: 'ADD', quote: '라움 화이트 2박스 추가', productText: '화이트', productContextText: '37-01 변경사항', qty: 2 }],
  unresolved: [],
}, multilineContext);
assert.equal(contextProduct.requests[0].productContextText, '37-01 변경사항');
assert.throws(() => normalizeExtraction({
  requests: [{ sourceIdentity: multilineContext.messages[0].identity, action: 'ADD', quote: '라움 화이트 2박스 추가', productText: '화이트', productContextText: '원문에 없는 품목군', qty: 2 }],
  unresolved: [],
}, multilineContext));
assert.throws(() => normalizeExtraction({ requests: [{ sourceIdentity: context.messages[0].identity, action: 'ADD', quote: '2박스 추가', qty: 0 }], unresolved: [] }, context));
assert.throws(() => normalizeExtraction({ requests: [{ sourceIdentity: 'fabricated', action: 'ADD', quote: 'x', qty: 1 }], unresolved: [] }, context));
assert.throws(() => normalizeExtraction({ requests: [{ sourceIdentity: context.messages[0].identity, action: 'ADD', quote: 'invented quote', qty: 1 }], unresolved: [] }, context));
assert.throws(() => normalizeExtraction({ requests: [{ sourceIdentity: context.messages[0].identity, action: 'ADD', quote: '2박스 추가', qty: 1, shipmentDate: '2026-02-30' }], unresolved: [] }, context));
assert.throws(() => normalizeExtraction({ requests: 'malformed', unresolved: [] }, context));
assert.throws(() => buildExtractionPrompt({ ...context, messages: Array.from({ length: 51 }, (_, index) => ({ identity: `m${index}`, message: 'x' })) }));
assert.doesNotMatch(require('node:fs').readFileSync(require.resolve('../lib/distributionChangeExtract'), 'utf8'), /fetch\(|anthropic/i);
console.log('distribution change extract tests passed');
