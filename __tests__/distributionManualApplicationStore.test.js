const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualApplicationStoreError, createDistributionManualApplicationStore } = require('../lib/distributionManualApplicationStore');

const user = { userId: 'manual-user', userName: '수동 표시자' };
const identity = 'nenovakakao/chat-1/message-5214';
const request = (overrides = {}) => ({ year: '2026', week: '37-99', sourceIdentity: identity, status: 'MANUALLY_APPLIED', memo: '반영 확인', requestId: '550e8400-e29b-41d4-a716-446655440000', expectedCurrentEventId: null, ...overrides });
async function expectCode(promise, code) { await assert.rejects(promise, error => error instanceof ManualApplicationStoreError && error.code === code); }

(async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'distribution-manual-application-'));
  try {
    const store = createDistributionManualApplicationStore({ directory, now: () => new Date('2026-09-11T00:30:00.000Z') });
    const first = await store.recordApplication(request(), user);
    assert.equal(first.status, 'MANUALLY_APPLIED');
    assert.equal(first.sourceIdentity, identity);
    assert.equal(first.expectedCurrentEventId, null);
    assert.equal(first.advisoryOnly, true); assert.equal(first.erpAction, 'NONE');
    assert.deepEqual(first.author, { userId: 'manual-user', userName: '수동 표시자' });

    const retry = await store.recordApplication(request(), user);
    assert.deepEqual(retry, first, 'same UUID/payload retries without creating another event');
    await expectCode(store.recordApplication(request({ memo: 'changed' }), user), 'REQUEST_ID_CONFLICT');
    await expectCode(store.recordApplication(request({ requestId: '550e8400-e29b-41d4-a716-446655440001', expectedCurrentEventId: null }), user), 'CURRENT_EVENT_CONFLICT');

    const clear = await store.recordApplication(request({ status: 'CLEAR', memo: '표시 해제도 새 원장 이벤트', expectedCurrentEventId: first.eventId, requestId: '550e8400-e29b-41d4-a716-446655440002' }), user);
    assert.equal(clear.status, 'CLEAR');
    assert.equal((await store.listApplications({ year: '2026', week: '37-99' }))[0].eventId, clear.eventId, 'CLEAR is the latest event, not deletion');
    assert.equal((await fs.promises.readdir(path.join(directory, '2026', '37-99', 'transitions'))).filter(name => name.endsWith('.json')).length, 2, 'events stay append-only in the scoped transition ledger');

    await store.recordApplication(request({ year: '2025', expectedCurrentEventId: null, requestId: '550e8400-e29b-41d4-a716-446655440003' }), user);
    assert.equal((await store.listApplications({ year: '2026', week: '37-99' })).length, 1, 'cross-year event never leaks');
    await expectCode(store.recordApplication(request({ week: '37-00', requestId: '550e8400-e29b-41d4-a716-446655440004' }), user), 'INVALID_WEEK');
    await expectCode(store.recordApplication(request({ status: 'REVIEWED', requestId: '550e8400-e29b-41d4-a716-446655440005' }), user), 'INVALID_STATUS');
    await expectCode(store.recordApplication(request({ expectedCurrentEventId: 'not-an-event', requestId: '550e8400-e29b-41d4-a716-446655440006' }), user), 'INVALID_EXPECTED_EVENT');
    const missingExpected = request({ requestId: '550e8400-e29b-41d4-a716-446655440008' }); delete missingExpected.expectedCurrentEventId;
    await expectCode(store.recordApplication(missingExpected, user), 'MISSING_EXPECTED_EVENT');

    const restarted = createDistributionManualApplicationStore({ directory, now: () => new Date('2026-09-11T00:30:00.000Z') });
    const later = await restarted.recordApplication(request({ sourceIdentity: 'same-frozen-time', requestId: '550e8400-e29b-41d4-a716-446655440009', expectedCurrentEventId: null }), user);
    const restartedAgain = createDistributionManualApplicationStore({ directory, now: () => new Date('2026-09-11T00:30:00.000Z') });
    const latest = await restartedAgain.recordApplication(request({ sourceIdentity: 'same-frozen-time', status: 'MANUALLY_NOT_APPLIED', requestId: '550e8400-e29b-41d4-a716-446655440010', expectedCurrentEventId: later.eventId }), user);
    assert.equal((await restartedAgain.listApplications({ year: '2026', week: '37-99' })).find(row => row.sourceIdentity === 'same-frozen-time').eventId, latest.eventId, 'restart at the same frozen time still advances event ordering');

    const firstRace = request({ sourceIdentity: 'race', requestId: '550e8400-e29b-41d4-a716-446655440007', expectedCurrentEventId: null });
    const secondRace = request({ sourceIdentity: 'race', status: 'MANUALLY_NOT_APPLIED', requestId: '550e8400-e29b-41d4-a716-446655440011', expectedCurrentEventId: null });
    const race = await Promise.allSettled([store.recordApplication(firstRace, user), store.recordApplication(secondRace, user)]);
    assert.equal(race.filter(item => item.status === 'fulfilled').length, 1, 'exclusive transition claim admits only one root transition');
    assert.equal(race.filter(item => item.status === 'rejected')[0].reason.code, 'CURRENT_EVENT_CONFLICT');
    const sameUuidA = request({ sourceIdentity: 'same-uuid-race', requestId: '550e8400-e29b-41d4-a716-446655440012', expectedCurrentEventId: null });
    const sameUuidB = request({ sourceIdentity: 'same-uuid-race', status: 'MANUALLY_NOT_APPLIED', requestId: '550e8400-e29b-41d4-a716-446655440012', expectedCurrentEventId: null });
    const sameUuidRace = await Promise.allSettled([store.recordApplication(sameUuidA, user), store.recordApplication(sameUuidB, user)]);
    assert.equal(sameUuidRace.filter(item => item.status === 'fulfilled').length, 1, 'one immutable receipt wins same UUID contention');
    assert.equal(sameUuidRace.filter(item => item.status === 'rejected')[0].reason.code, 'REQUEST_ID_CONFLICT');
    const orphan = request({ sourceIdentity: 'orphan-retry', requestId: '550e8400-e29b-41d4-a716-446655440013', expectedCurrentEventId: null });
    await store.recordApplication(orphan, user);
    const orphanTransition = crypto.createHash('sha256').update('orphan-retry\n<root>').digest('hex');
    await fs.promises.unlink(path.join(directory, '2026', '37-99', 'transitions', `${orphanTransition}.json`));
    await store.recordApplication(request({ sourceIdentity: 'orphan-retry', status: 'MANUALLY_NOT_APPLIED', requestId: '550e8400-e29b-41d4-a716-446655440014', expectedCurrentEventId: null }), user);
    await expectCode(store.recordApplication(orphan, user), 'CURRENT_EVENT_CONFLICT');
    const misplacedName = (await fs.promises.readdir(path.join(directory, '2025', '37-99', 'transitions'))).find(name => name.endsWith('.json'));
    const emptyScopeTransitions = path.join(directory, '2026', '38-99', 'transitions'); await fs.promises.mkdir(emptyScopeTransitions, { recursive: true });
    await fs.promises.link(path.join(directory, '2025', '37-99', 'transitions', misplacedName), path.join(emptyScopeTransitions, misplacedName));
    await expectCode(store.listApplications({ year: '2026', week: '38-99' }), 'APPLICATION_STORAGE_CORRUPT');
    console.log('distribution manual application store tests passed');
  } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
