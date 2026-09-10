const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ChecklistStoreError,
  MAX_MEMO_LENGTH,
  createDistributionChecklistStore,
} = require('../lib/distributionChecklistStore');

const user = { userId: 'reviewer-1', userName: '검토자' };
const sourceIdentity = 'source/message: 영업방-0001';

function payload(overrides = {}) {
  return {
    year: '2026', week: '37-01', sourceIdentity, status: 'PENDING', memo: '',
    requestId: '550e8400-e29b-41d4-a716-446655440000', ...overrides,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof ChecklistStoreError && error.code === code);
}

async function main() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'distribution-checklist-store-'));
  try {
    const store = createDistributionChecklistStore({ directory, now: () => new Date('2026-09-10T01:02:03.000Z') });
    const first = await store.recordReview(payload({ sourceIdentity: '  exact/source identity  ' }), user);
    assert.equal(first.sourceIdentity, '  exact/source identity  ', 'source identity is retained verbatim');
    assert.equal(first.status, 'PENDING');
    assert.equal(first.advisoryOnly, true);
    assert.equal(first.erpAction, 'NONE');
    assert.deepEqual(first.author, { userId: user.userId, userName: user.userName });

    const second = await store.recordReview(payload({ status: 'REVIEWED', memo: '수동 검토 완료', requestId: '550e8400-e29b-41d4-a716-446655440001' }), user);
    await store.recordReview(payload({ sourceIdentity: 'source/other', status: 'NOT_NEEDED', requestId: '550e8400-e29b-41d4-a716-446655440007' }), user);
    const reviews = await store.listReviews({ year: '2026', week: '37-01' });
    assert.equal(reviews.length, 3, 'different identities each retain their latest manual event');
    assert.equal(reviews.find(review => review.sourceIdentity === sourceIdentity).status, 'REVIEWED');
    assert.equal(reviews.find(review => review.sourceIdentity === sourceIdentity).memo, '수동 검토 완료');
    assert.equal(reviews.find(review => review.sourceIdentity === 'source/other').status, 'NOT_NEEDED');

    const retry = await store.recordReview(payload({ status: 'REVIEWED', memo: '수동 검토 완료', requestId: '550e8400-e29b-41d4-a716-446655440001' }), user);
    assert.deepEqual(retry, second, 'same request is idempotent');
    await expectCode(store.recordReview(payload({ status: 'LATER', requestId: '550e8400-e29b-41d4-a716-446655440001' }), user), 'REQUEST_ID_CONFLICT');

    await store.recordReview(payload({ year: '2025', status: 'LATER', requestId: '550e8400-e29b-41d4-a716-446655440002' }), user);
    assert.equal((await store.listReviews({ year: '2026', week: '37-01' })).some(review => review.status === 'LATER'), false, 'cross-year records never leak into the selected year');
    await expectCode(store.recordReview(payload({ status: 'DONE', requestId: '550e8400-e29b-41d4-a716-446655440003' }), user), 'INVALID_STATUS');
    await expectCode(store.recordReview(payload({ memo: 'x'.repeat(MAX_MEMO_LENGTH + 1), requestId: '550e8400-e29b-41d4-a716-446655440004' }), user), 'INVALID_MEMO');
    await expectCode(store.recordReview(payload({ sourceIdentity: '../unsafe', requestId: '550e8400-e29b-41d4-a716-446655440005' }), user), 'INVALID_SOURCE_IDENTITY');
    await expectCode(store.recordReview(payload({ week: '37', requestId: '550e8400-e29b-41d4-a716-446655440006' }), user), 'INVALID_WEEK');

    const persisted = JSON.parse(await fs.promises.readFile(path.join(directory, `${first.eventId}.json`), 'utf8'));
    assert.equal('machineFinding' in persisted, false, 'manual event never overwrites or stores a machine finding');
    assert.equal(persisted.author.userId, user.userId, 'event author is server supplied');
    const restarted = createDistributionChecklistStore({ directory });
    assert.equal((await restarted.listReviews({ year: '2026', week: '37-01' })).find(review => review.sourceIdentity === sourceIdentity).status, 'REVIEWED');
    console.log('distribution checklist store tests passed');
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
