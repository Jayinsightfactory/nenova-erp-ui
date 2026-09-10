const assert = require('node:assert/strict');
const { EPSILON, compareDistributionChanges } = require('../lib/distributionChangeCompare');

const year = '2026';
const week = '37-01';
const sourceAt = '2026-09-10T09:00:00+09:00';

function request(overrides = {}) {
  return {
    id: 'request-1', sourceIdentity: 'source-1', year, week, custKey: 10, prodKey: 20,
    action: 'ADD', qty: 3, unit: 'BOX', sourceAt, shipmentDate: '2026-09-11', mappingConfirmed: true,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    eventId: 'event-1', year, week, custKey: 10, prodKey: 20, changeAt: '2026-09-10T09:00:00+09:00',
    shipmentDate: '2026-09-11', unit: 'BOX', before: 4, after: 7, ...overrides,
  };
}

function compare(requests, history, extra = {}) {
  return compareDistributionChanges({ year, weeks: [week], requests, history, currentRows: [], historyComplete: true, ...extra });
}

const [matching] = compare([request()], [event({ after: 7 + EPSILON / 2 })]);
assert.equal(matching.status, 'MATCHING_HISTORY');
assert.equal(matching.advisoryOnly, true);
assert.equal(matching.expectedDelta, 3);
assert.match(matching.reasonKorean, /완료를 뜻하지 않습니다/);

const [priorYear] = compare([request()], [event({ year: '2025' })]);
assert.equal(priorYear.status, 'NO_MATCHING_HISTORY', 'prior-year same week never matches');

const twoCustomers = compare([
  request({ id: 'add-customer', sourceIdentity: 'source-add', custKey: 10, qty: 3 }),
  request({ id: 'cancel-customer', sourceIdentity: 'source-cancel', custKey: 11, action: 'CANCEL', qty: 2 }),
], [
  event({ eventId: 'event-add', custKey: 10, before: 4, after: 7 }),
  event({ eventId: 'event-cancel', custKey: 11, before: 8, after: 6 }),
]);
assert.deepEqual(twoCustomers.map(result => result.status), ['MATCHING_HISTORY', 'MATCHING_HISTORY']);

const [unitMismatch] = compare([request()], [event({ unit: 'BUNCH' })]);
assert.equal(unitMismatch.status, 'NO_MATCHING_HISTORY', 'units must match explicitly');

const [invalidTimestamp] = compare([request({ sourceAt: '2026-09-10T09:00:00' })], [event()]);
assert.equal(invalidTimestamp.status, 'NEEDS_REVIEW');
const [approximateTimestamp] = compare([request({ timestamp_approximate: true })], [event()]);
assert.equal(approximateTimestamp.status, 'NEEDS_REVIEW');
assert.match(approximateTimestamp.reasonKorean, /근사값/);
const [invalidHistoryTimestamp] = compare([request()], [event({ changeAt: '2026-09-10T09:00:00' })]);
assert.equal(invalidHistoryTimestamp.status, 'NO_MATCHING_HISTORY');
const [afterAsOf] = compare([request()], [event({ changeAt: '2026-09-10T11:00:00+09:00' })], { asOf: '2026-09-10T10:00:00+09:00' });
assert.equal(afterAsOf.status, 'NO_MATCHING_HISTORY');

const [partial] = compare([request({ qty: 5 })], [event({ after: 6 })]);
assert.equal(partial.status, 'PARTIAL_HISTORY');

const [incomplete] = compare([request()], [], { historyComplete: false });
assert.equal(incomplete.status, 'NEEDS_REVIEW');
assert.match(incomplete.reasonKorean, /완전하다고 확인되지/);
const [currentOnly] = compare([request()], [], {
  currentRows: [{ year, week, custKey: 10, prodKey: 20, qty: 3, unit: 'BOX', shipmentDate: '2026-09-11' }],
});
assert.equal(currentOnly.status, 'NO_MATCHING_HISTORY', 'current rows alone never prove a history event');

const [missingDate] = compare([request({ shipmentDate: null })], [
  event({ eventId: 'date-1', shipmentDate: '2026-09-11' }),
  event({ eventId: 'date-2', shipmentDate: '2026-09-12' }),
]);
assert.equal(missingDate.status, 'NEEDS_REVIEW');
assert.equal(missingDate.reasonKorean, '출고일 지정이 없어 같은 수량 이력만 참고');
assert.deepEqual(missingDate.candidateEventIds, ['date-1', 'date-2']);
const [singleCandidateWithoutDate] = compare([request({ shipmentDate: null })], [event({ eventId: 'date-reference' })]);
assert.equal(singleCandidateWithoutDate.status, 'NEEDS_REVIEW');
assert.equal(singleCandidateWithoutDate.reasonKorean, '출고일 지정이 없어 같은 수량 이력만 참고');
assert.deepEqual(singleCandidateWithoutDate.candidateEventIds, ['date-reference']);
const [multipleCandidates] = compare([request()], [event({ eventId: 'same-date-1' }), event({ eventId: 'same-date-2' })]);
assert.equal(multipleCandidates.status, 'AMBIGUOUS', 'multiple evidence rows are never summed');

const duplicateInput = compare([
  request({ id: 'duplicate', sourceIdentity: 'first-source', prodKey: 20 }),
  request({ id: 'duplicate', sourceIdentity: 'second-source', prodKey: 21 }),
], [event({ eventId: 'duplicate-event-1', prodKey: 20 }), event({ eventId: 'duplicate-event-2', prodKey: 21 })]);
assert.deepEqual(duplicateInput.map(result => result.status), ['AMBIGUOUS', 'AMBIGUOUS']);
const duplicateSource = compare([
  request({ id: 'source-duplicate-1', sourceIdentity: 'same-source', prodKey: 20 }),
  request({ id: 'source-duplicate-2', sourceIdentity: 'same-source', prodKey: 21 }),
], [event({ eventId: 'source-event-1', prodKey: 20 }), event({ eventId: 'source-event-2', prodKey: 21 })]);
assert.deepEqual(duplicateSource.map(result => result.status), ['MATCHING_HISTORY', 'MATCHING_HISTORY'], 'one source message may contain distinct legitimate request items');

const subweek99 = compare(
  [request({ id: 'subweek-99', week: '37-99' })],
  [event({ eventId: 'subweek-99-event', week: '37-99' })],
  { weeks: ['37-99'] },
);
assert.equal(subweek99[0].status, 'MATCHING_HISTORY');

const combined0102 = compare([
  request({ id: 'combined-01', sourceIdentity: 'combined-source', week: '37-01', prodKey: 20 }),
  request({ id: 'combined-02', sourceIdentity: 'combined-source', week: '37-02', prodKey: 21 }),
], [
  event({ eventId: 'combined-event-01', week: '37-01', prodKey: 20 }),
  event({ eventId: 'combined-event-02', week: '37-02', prodKey: 21 }),
], { weeks: ['37-01', '37-02'] });
assert.deepEqual(combined0102.map(result => result.status), ['MATCHING_HISTORY', 'MATCHING_HISTORY']);

const repeatedClaims = compare([
  request({ id: 'claim-1', sourceIdentity: 'claim-source-1' }),
  request({ id: 'claim-2', sourceIdentity: 'claim-source-2' }),
], [event({ eventId: 'shared-event' })]);
assert.deepEqual(repeatedClaims.map(result => result.status), ['AMBIGUOUS', 'AMBIGUOUS']);
assert.ok(repeatedClaims.every(result => result.candidateEventIds.includes('shared-event')));

for (const result of compare([request({ mappingConfirmed: false })], [event()])) {
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.advisoryOnly, true);
  assert.equal('canSave' in result, false);
  assert.equal('blocker' in result, false);
}

const [unmapped] = compare([request({ prodKey: null, mappingConfirmed: false })], [event()]);
assert.equal(unmapped.reasonKorean, '업체와 품목을 먼저 연결해야 변경 이력을 비교할 수 있습니다.');

console.log('distribution change compare tests passed');
