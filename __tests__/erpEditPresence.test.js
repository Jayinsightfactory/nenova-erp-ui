const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const presence = await import('../lib/erpEditPresence.js');
  const { normalizeErpEditClientWeek, mergeErpEditPresenceError, mergeErpEditPresenceResponse, shouldBlockErpDigestTransition } = await import('../hooks/useErpEditPresence.js');
  assert.equal(normalizeErpEditClientWeek('34-01'), '34');
  assert.equal(normalizeErpEditClientWeek('34-02'), '34');
  assert.equal(normalizeErpEditClientWeek('2026-34-02'), '34');
  const clientBeforeSave = { digest: 'a'.repeat(64), token: 'mine', stale: false, scopeKey: '2026/34/7' };
  const clientAfterOwnSave = mergeErpEditPresenceResponse(clientBeforeSave, {
    digest: 'b'.repeat(64), stale: false,
    scope: { orderYear: '2026', orderWeek: '34', custKey: 7 },
    lease: { active: true, ownedByMe: true, token: 'mine', pageCode: 'estimate' },
  });
  assert.equal(clientAfterOwnSave.digest, 'b'.repeat(64), '본인 저장 뒤 서버 heartbeat 기준값은 화면 기준으로 반영해야 합니다.');
  assert.equal(clientAfterOwnSave.stale, false, '본인 저장은 외부 변경 경고가 아니어야 합니다.');
  const clientAfterExternalSave = mergeErpEditPresenceResponse(clientAfterOwnSave, {
    digest: 'c'.repeat(64), stale: true,
    scope: { orderYear: '2026', orderWeek: '34', custKey: 7 },
    lease: { active: true, ownedByMe: true, token: 'mine', pageCode: 'estimate' },
  });
  assert.equal(clientAfterExternalSave.stale, true, '본인 저장 이후의 EXE/다른 화면 변경 경고는 유지해야 합니다.');
  assert.equal(shouldBlockErpDigestTransition({ previousDigest: 'old', nextDigest: 'exe-fixed' }), true, '자동 확인은 EXE 확정 변경을 차단해야 합니다.');
  assert.equal(shouldBlockErpDigestTransition({ force: true, previousDigest: 'old', nextDigest: 'exe-fixed' }), false, '사용자가 최신 현황을 명시적으로 다시 불러오면 새 확정 기준을 받아들여야 합니다.');
  assert.equal(shouldBlockErpDigestTransition({ savingCount: 1, previousDigest: 'old', nextDigest: 'web-save' }), false, '본인 저장 정산 중 digest 변화는 외부 변경으로 오인하지 않아야 합니다.');
  assert.deepEqual(presence.normalizeEditScope({ orderYear: '2026', orderWeek: '32-01', custKey: 9 }), { orderYear: '2026', orderWeek: '32', custKey: 9 });
  assert.deepEqual(presence.normalizeEditScope({ orderYear: '2026', week: '32-02', custKey: 9 }), { orderYear: '2026', orderWeek: '32', custKey: 9 });
  assert.throws(() => presence.normalizeEditScope({ orderWeek: '32', custKey: 9 }), /선택 연도와 차수/);
  assert.throws(() => presence.normalizeEditScope({ orderYear: '2026', week: '32-01', custKey: 0 }), /선택 업체/);
  assert.equal(presence.EDIT_LEASE_SECONDS, 90);
  assert.equal(presence.EDIT_HEARTBEAT_SECONDS, 20);

  const lease = new Map();
  const seenSql = [];
  let erpRevision = 0;
  let shipmentFix = 0;
  const keyOf = (params) => `${params.yr.value}/${params.wk.value}/${params.ck.value}`;
  const fakeQuery = async (statement, params = {}) => {
    seenSql.push(statement);
    const key = keyOf(params);
    if (/FROM WebErpEditLease/.test(statement)) {
      const row = lease.get(key);
      const activeOnly = /ExpiresAt > SYSUTCDATETIME/.test(statement);
      return { recordset: [row].filter((value) => value && (!activeOnly || new Date(value.ExpiresAt).getTime() > Date.now())) };
    }
    if (/INSERT INTO WebErpEditLease/.test(statement)) {
      lease.set(key, { OrderYear: params.yr.value, OrderWeek: params.wk.value, CustKey: params.ck.value,
        LeaseToken: params.token.value, OwnerUserId: params.uid.value, OwnerName: params.name.value,
        ClientId: params.clientId.value, PageCode: params.pageCode.value, BaselineDigest: params.baseline.value,
        Revision: params.revision.value, AcquiredAt: new Date(), HeartbeatAt: new Date(), ExpiresAt: new Date(Date.now() + 90000) });
      return { recordset: [] };
    }
    if (/UPDATE WebErpEditLease/.test(statement)) {
      const row = lease.get(key);
      if (row) {
        if (params.uid) Object.assign(row, {
          LeaseToken: params.token.value, OwnerUserId: params.uid.value, OwnerName: params.name.value,
          ClientId: params.clientId.value, PageCode: params.pageCode.value,
          BaselineDigest: params.baseline?.value || row.BaselineDigest, Revision: params.revision?.value ?? row.Revision,
        });
        if (params.baseline && !params.uid) {
          row.BaselineDigest = params.baseline.value;
          row.Revision = Number(row.Revision || 0) + 1;
        }
        row.HeartbeatAt = new Date();
        row.ExpiresAt = /DATEADD\(second, -1/.test(statement) ? new Date(Date.now() - 1000) : new Date(Date.now() + 90000);
      }
      return { recordset: [] };
    }
    if (/AS MasterFix/.test(statement)) {
      return { recordset: [{
        ShipmentKey: 11, SdetailKey: 12, ProdKey: 9,
        MasterFix: shipmentFix, DetailFix: shipmentFix, MasterDeleted: 0,
        BoxQuantity: 0, BunchQuantity: 1, SteamQuantity: 0, OutQuantity: 1,
        EstQuantity: 1, Cost: 1000, Amount: 909, Vat: 91, ShipmentDtm: new Date('2026-08-28T00:00:00Z'),
      }] };
    }
    if (/FROM OrderMaster/.test(statement)) {
      return { recordset: [{ OrderMasterKey: 1, OrderDetailKey: 1, ProdKey: 9, OutQuantity: erpRevision, BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 0, DetailDeleted: 0, MasterDeleted: 0 }] };
    }
    return { recordset: [] };
  };
  const alice = { userId: 'alice', userName: '앨리스' };
  const bob = { userId: 'bob', userName: '밥' };
  const scope = { orderYear: '2026', orderWeek: '32-01', custKey: 7 };
  const beforeFixOnly = await presence.readErpEditSnapshot(fakeQuery, scope);
  shipmentFix = 1;
  const afterFixOnly = await presence.readErpEditSnapshot(fakeQuery, scope);
  assert.equal(afterFixOnly.digest, beforeFixOnly.digest, 'EXE 확정상태만 바뀌면 견적 내용 충돌 지문은 유지해야 합니다.');
  assert.notEqual(afterFixOnly.fixStatusDigest, beforeFixOnly.fixStatusDigest, 'EXE 확정상태 변경은 상태 전용 지문으로 감지해야 합니다.');
  shipmentFix = 0;
  const priorYear = await presence.acquireErpEditLease(fakeQuery, { ...scope, orderYear: '2025' }, alice, { clientId: 'YEAR-2025', pageCode: 'estimate' });
  assert.equal(priorYear.scope.orderYear, '2025');
  const beforeNewLease = await presence.readErpEditSnapshot(fakeQuery, { orderYear: '2026', orderWeek: '31-01', custKey: 8 });
  erpRevision += 1;
  await assert.rejects(
    () => presence.acquireErpEditLease(fakeQuery, { orderYear: '2026', orderWeek: '31-01', custKey: 8 }, alice, { clientId: 'A2', pageCode: 'paste', expectedDigest: beforeNewLease.digest }),
    { code: 'ERP_EDIT_STALE' },
  );
  erpRevision = 0;
  const mine = await presence.acquireErpEditLease(fakeQuery, scope, alice, { clientId: 'A', pageCode: 'estimate' });
  assert.equal(mine.scope.orderWeek, '32');
  assert.notEqual(mine.lease.leaseToken, priorYear.lease.leaseToken, '2025/2026 동일 차수·업체는 서로 다른 작업권이어야 합니다.');
  erpRevision += 1;
  let sameClientStale;
  try {
    await presence.acquireErpEditLease(fakeQuery, scope, alice, { clientId: 'A', pageCode: 'estimate' });
  } catch (error) {
    sameClientStale = error;
  }
  assert.equal(sameClientStale?.code, 'ERP_EDIT_STALE');
  assert.equal(sameClientStale.lease.ownedByMe, true, '같은 브라우저의 오래된 작업권은 본인 소유로 표시해야 합니다.');
  assert.equal(sameClientStale.lease.token, mine.lease.leaseToken, '명시적 최신화에 필요한 토큰은 같은 사용자·같은 브라우저에만 돌려줘야 합니다.');
  const staleResponse = presence.editErrorResponse(sameClientStale).body;
  const recoveredClientState = mergeErpEditPresenceError({}, { code: staleResponse.code, data: staleResponse }, scope);
  assert.equal(recoveredClientState.stale, true, '최신값 확인 전에는 저장 차단을 유지해야 합니다.');
  assert.equal(recoveredClientState.ownedByMe, true);
  assert.equal(recoveredClientState.token, mine.lease.leaseToken, '화면 새로고침 뒤에도 본인 토큰을 복구해야 합니다.');
  assert.equal(recoveredClientState.scopeKey, '2026/32/7');
  await presence.refreshErpEditLease(fakeQuery, scope, alice, {
    leaseToken: recoveredClientState.token,
    clientId: 'A',
  });
  erpRevision = 0;
  await presence.refreshErpEditLease(fakeQuery, scope, alice, {
    leaseToken: recoveredClientState.token,
    clientId: 'A',
  });
  let otherUserBlocked;
  try {
    await presence.acquireErpEditLease(fakeQuery, { ...scope, orderWeek: '32-02' }, bob, { clientId: 'B', pageCode: 'paste' });
  } catch (error) {
    otherUserBlocked = error;
  }
  assert.equal(otherUserBlocked?.code, 'ERP_EDIT_LOCKED');
  assert.equal(otherUserBlocked.lease?.token, undefined, '다른 사용자에게 기존 작업권 토큰을 노출하면 안 됩니다.');
  let sameUserBlocked;
  try {
    await presence.acquireErpEditLease(fakeQuery, { ...scope, orderWeek: '32-02' }, alice, { clientId: 'A-OTHER', pageCode: 'estimate' });
  } catch (error) {
    sameUserBlocked = error;
  }
  assert.equal(sameUserBlocked?.code, 'ERP_EDIT_LOCKED');
  assert.equal(sameUserBlocked.lease.ownedBySameUser, true, '같은 계정의 다른 창임을 구분해야 합니다.');
  assert.equal(sameUserBlocked.lease.token, undefined, '같은 계정이어도 다른 브라우저 창에는 기존 토큰을 노출하면 안 됩니다.');
  const oldMineToken = mine.lease.leaseToken;
  // A stale baseline left by an interrupted tab must not be carried into an
  // explicit same-user takeover; the new tab starts from its lock-bound read.
  erpRevision += 1;
  const takenBySameUser = await presence.acquireErpEditLease(fakeQuery, scope, alice, { clientId: 'A-OTHER', pageCode: 'estimate', takeover: true });
  assert.notEqual(takenBySameUser.lease.leaseToken, oldMineToken, '넘겨받기는 기존 창 토큰을 무효화해야 합니다.');
  assert.equal(lease.get('2026/32/7').BaselineDigest, takenBySameUser.snapshot.digest, '같은 사용자 takeover는 이전 stale 기준값이 아니라 새 탭이 읽은 스냅샷을 기준으로 해야 합니다.');
  await assert.rejects(
    () => presence.releaseErpEditLease(fakeQuery, scope, alice, { leaseToken: oldMineToken, clientId: 'A' }),
    { code: 'ERP_EDIT_LOCKED' },
  );
  await presence.releaseErpEditLease(fakeQuery, scope, alice, { leaseToken: takenBySameUser.lease.leaseToken, clientId: 'A-OTHER' });
  const reacquired = await presence.acquireErpEditLease(fakeQuery, scope, alice, { clientId: 'A', pageCode: 'estimate' });
  await assert.rejects(() => presence.assertErpEditGuard(fakeQuery, scope, alice, { editGuard: { leaseToken: 'forged', clientId: 'A', expectedDigest: reacquired.snapshot.digest } }), { code: 'ERP_EDIT_LOCKED' });
  const oldExpiry = lease.get('2026/32/7'); oldExpiry.ExpiresAt = new Date(Date.now() - 1);
  const taken = await presence.acquireErpEditLease(fakeQuery, scope, bob, { clientId: 'B', pageCode: 'paste' });
  assert.equal(taken.lease.ownerUserId, 'bob');
  const beforeHeartbeat = new Date(taken.lease.expiresAt).getTime();
  const heart = await presence.heartbeatErpEditLease(fakeQuery, scope, bob, { leaseToken: taken.lease.leaseToken, clientId: 'B' });
  assert.ok(new Date(heart.lease.expiresAt).getTime() >= beforeHeartbeat);
  assert.equal(heart.stale, false);
  // The browser's old digest is informational: consecutive writes by the
  // current owner are allowed only after the server advances its baseline.
  const guard = { editGuard: { leaseToken: taken.lease.leaseToken, clientId: 'B', expectedDigest: 'stale' } };
  await presence.assertErpEditGuard(fakeQuery, scope, bob, guard);
  erpRevision += 1; // simulates the first successful web ERP write.
  await presence.advanceErpEditGuard(fakeQuery, scope, bob, guard);
  const ownSaveHeartbeat = await presence.heartbeatErpEditLease(fakeQuery, scope, bob, { leaseToken: taken.lease.leaseToken, clientId: 'B' });
  assert.equal(ownSaveHeartbeat.stale, false, 'transaction-advanced own write must settle without a false external-change warning');
  assert.equal(ownSaveHeartbeat.snapshot.digest, lease.get('2026/32/7').BaselineDigest, 'own-write heartbeat must return the exact server baseline');
  await presence.assertErpEditGuard(fakeQuery, scope, bob, guard);
  erpRevision += 1; // nenova.exe changes an ERP row between web saves.
  const staleHeartbeat = await presence.heartbeatErpEditLease(fakeQuery, scope, bob, { leaseToken: taken.lease.leaseToken, clientId: 'B' });
  assert.equal(staleHeartbeat.stale, true, 'heartbeat must keep the EXE-change warning visible');
  await assert.rejects(() => presence.assertErpEditGuard(fakeQuery, scope, bob, guard), { code: 'ERP_EDIT_STALE' });
  const refreshed = await presence.refreshErpEditLease(fakeQuery, scope, bob, guard.editGuard);
  assert.equal(refreshed.snapshot.digest, await presence.readErpEditSnapshot(fakeQuery, scope).then((x) => x.digest));
  await presence.assertErpEditGuard(fakeQuery, scope, bob, guard);
  seenSql.length = 0;
  await presence.getErpEditStatus(fakeQuery, scope, { userId: 'bob', clientId: 'B' });
  assert.ok(seenSql.every((statement) => !/UPDLOCK|HOLDLOCK/.test(statement)), 'GET/status digest must be lock-free');

  const handoffScope = { orderYear:'2026', orderWeek:'36-01', custKey:13 };
  const firstOwner = await presence.acquireErpEditLease(fakeQuery, handoffScope, alice, {clientId:'OLD',pageCode:'estimate'});
  const observer = {userId:'admin', clientId:'NEW'};
  const stamp = presence.editPresencePayload(firstOwner, observer).lease.leaseStamp;
  assert.match(stamp, /^[a-f0-9]{64}$/);
  assert.equal(presence.editPresencePayload(firstOwner, observer).lease.token, undefined);
  const transfer = {clientId:'NEW',pageCode:'estimate',forceTakeover:true,confirmed:true,expectedLeaseStamp:stamp};
  const admin = {userId:'admin',authority:1,userName:'관리자'};
  for (const user of [bob, {...admin,authority:9}]) {
    await assert.rejects(()=>presence.acquireErpEditLease(fakeQuery,handoffScope,user,transfer), {code:'ERP_EDIT_TAKEOVER_FORBIDDEN'});
  }
  for (const change of [{confirmed:false},{confirmed:undefined},{pageCode:'paste'}]) {
    await assert.rejects(()=>presence.acquireErpEditLease(fakeQuery,handoffScope,admin,{...transfer,...change}), {code:'ERP_EDIT_TAKEOVER_FORBIDDEN'});
  }
  for (const expectedLeaseStamp of ['',undefined,'outdated']) {
    await assert.rejects(()=>presence.acquireErpEditLease(fakeQuery,handoffScope,admin,{...transfer,expectedLeaseStamp}), {code:'ERP_EDIT_TAKEOVER_CHANGED'});
  }
  await assert.rejects(()=>presence.acquireErpEditLease(fakeQuery,{...handoffScope,orderYear:'2025'},admin,transfer), {code:'ERP_EDIT_TAKEOVER_CHANGED'});
  const firstGuard = {leaseToken:firstOwner.lease.leaseToken,clientId:'OLD'};
  const renewed = await presence.heartbeatErpEditLease(fakeQuery,handoffScope,alice,firstGuard);
  assert.equal(presence.editPresencePayload(renewed,observer).lease.leaseStamp,stamp,'heartbeat must not invalidate confirmation');
  await presence.advanceErpEditGuard(fakeQuery,handoffScope,alice,{editGuard:firstGuard});
  await assert.rejects(()=>presence.acquireErpEditLease(fakeQuery,handoffScope,admin,transfer), {code:'ERP_EDIT_TAKEOVER_CHANGED'});
  const live = await presence.getErpEditStatus(fakeQuery,handoffScope,observer);
  seenSql.length = 0;
  const moved = await presence.acquireErpEditLease(fakeQuery,handoffScope,admin,{...transfer,expectedLeaseStamp:presence.editPresencePayload(live,observer).lease.leaseStamp});
  assert.notEqual(moved.lease.leaseToken,firstOwner.lease.leaseToken);
  assert.equal(moved.lease.ownerUserId,'admin');
  assert.equal(moved.lease.baselineDigest,moved.snapshot.digest);
  assert.ok(seenSql.filter(s=>/UPDATE|INSERT|DELETE/.test(s)).every(s=>/UPDATE WebErpEditLease/.test(s)), 'handoff must only write sidecar');
  await assert.rejects(()=>presence.releaseErpEditLease(fakeQuery,handoffScope,alice,firstGuard), {code:'ERP_EDIT_LOCKED'});
  await assert.rejects(()=>presence.heartbeatErpEditLease(fakeQuery,handoffScope,alice,firstGuard), {code:'ERP_EDIT_LOCKED'});
  await assert.rejects(()=>presence.assertErpEditGuard(fakeQuery,handoffScope,alice,{editGuard:firstGuard}), {code:'ERP_EDIT_LOCKED'});

  const statusScope = { orderYear: '2026', orderWeek: '44-01', custKey: 44 };
  const statusSnapshotQuery = (revision) => async (statement) => {
    if (/FROM OrderMaster/.test(statement)) {
      return { recordset: [{
        OrderMasterKey: 44, OrderDetailKey: 44, ProdKey: 9, OutQuantity: revision,
        BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 0, DetailDeleted: 0, MasterDeleted: 0,
      }] };
    }
    return { recordset: [] };
  };
  const oldSnapshot = await presence.readErpEditSnapshot(statusSnapshotQuery(1), statusScope);
  const newSnapshot = await presence.readErpEditSnapshot(statusSnapshotQuery(2), statusScope);
  const statusLease = (overrides = {}) => ({
    OrderYear: '2026', OrderWeek: '44', CustKey: 44,
    LeaseToken: 'status-token', OwnerUserId: 'alice', OwnerName: '앨리스', ClientId: 'status-client', PageCode: 'estimate',
    BaselineDigest: newSnapshot.digest, Revision: 2,
    AcquiredAt: new Date(), HeartbeatAt: new Date(), ExpiresAt: new Date(Date.now() + 90_000),
    ...overrides,
  });
  const makeStatusQuery = (leaseAtRead, snapshotRevision = 2) => {
    let leaseReads = 0;
    let snapshotReads = 0;
    const queries = [];
    return {
      queries,
      counts: () => ({ leaseReads, snapshotReads }),
      query: async (statement, params = {}) => {
        queries.push(statement);
        if (/FROM WebErpEditLease/.test(statement)) {
          const row = leaseAtRead(leaseReads, params);
          leaseReads += 1;
          return { recordset: row ? [row] : [] };
        }
        snapshotReads += 1;
        return statusSnapshotQuery(snapshotRevision)(statement, params);
      },
    };
  };
  const oldLease = statusLease({ LeaseToken: 'old-token', BaselineDigest: oldSnapshot.digest, Revision: 1 });
  const newLease = statusLease();
  const mixedRead = makeStatusQuery((read) => (read === 0 ? oldLease : newLease));
  const coherent = await presence.getErpEditStatus(mixedRead.query, statusScope);
  assert.equal(coherent.lease.leaseToken, 'status-token', 'old lease/new snapshot 조합은 반환하지 않고 안정된 재조회 결과를 사용해야 합니다.');
  assert.equal(coherent.stale, false, '새 기준값과 새 snapshot이 일치하면 다른 사용자 변경으로 오인하면 안 됩니다.');
  assert.deepEqual(mixedRead.counts(), { leaseReads: 4, snapshotReads: 10 }, 'lease 변경 시 한 번만 재시도하고 각 snapshot은 다섯 lock-free 조회여야 합니다.');
  assert.ok(mixedRead.queries.every((statement) => !/UPDLOCK|HOLDLOCK/.test(statement)), 'coherent GET도 잠금을 획득하면 안 됩니다.');

  const externalStale = makeStatusQuery(() => statusLease({ BaselineDigest: oldSnapshot.digest }));
  const stableExternal = await presence.getErpEditStatus(externalStale.query, statusScope);
  assert.equal(stableExternal.stale, true, '안정된 lease와 실제 외부 ERP 변경은 계속 stale로 반환해야 합니다.');
  assert.deepEqual(externalStale.counts(), { leaseReads: 2, snapshotReads: 5 }, '안정된 상태는 재시도하지 않아야 합니다.');

  const continuouslyChanging = makeStatusQuery((read) => statusLease({
    LeaseToken: `changing-${read}`, Revision: read, BaselineDigest: read % 2 ? oldSnapshot.digest : newSnapshot.digest,
  }));
  await assert.rejects(
    () => presence.getErpEditStatus(continuouslyChanging.query, statusScope),
    (error) => error.code === 'ERP_EDIT_STATUS_CHECKING'
      && error.statusCode === 503
      && error.message === '다른 작업의 저장이 끝나는지 확인 중입니다. 잠시 후 자동으로 다시 확인합니다.',
  );
  assert.deepEqual(continuouslyChanging.counts(), { leaseReads: 6, snapshotReads: 15 }, '계속 바뀌면 최대 세 번만 lock-free 상태를 읽어야 합니다.');

  const isolationReads = [];
  const isolated = makeStatusQuery((read, params) => {
    isolationReads.push(`${params.yr.value}/${params.wk.value}/${params.ck.value}`);
    return statusLease();
  });
  const isolatedStatus = await presence.getErpEditStatus(isolated.query, statusScope);
  assert.deepEqual(isolatedStatus.scope, { orderYear: '2026', orderWeek: '44', custKey: 44 });
  assert.deepEqual(isolationReads, ['2026/44/44', '2026/44/44'], '상태 조회는 다른 연도 또는 업체의 lease를 섞지 않아야 합니다.');

  const renewalSequence = [];
  let renewalCommitted = false;
  const renewedLease = statusLease({ LeaseToken: 'renewed-token', Revision: 3 });
  const postRenewStatus = makeStatusQuery(() => renewedLease);
  const renewalDependencies = {
    withTransaction: async (work) => {
      renewalSequence.push('transaction:start');
      const result = await work(async (statement, params = {}) => {
        renewalSequence.push(/WebErpEditLease/.test(statement) ? 'transaction:lease' : 'transaction:erp');
        assert.match(statement, /WebErpEditLease/, 'renew-only transaction must not read ERP snapshot tables');
        if (/FROM WebErpEditLease/.test(statement)) return { recordset: [renewedLease] };
        return { recordset: [] };
      });
      renewalCommitted = true;
      renewalSequence.push('transaction:commit');
      return result;
    },
    query: async (statement, params = {}) => {
      assert.equal(renewalCommitted, true, 'coherent status GET must begin only after lease transaction commits');
      renewalSequence.push('status:get');
      return postRenewStatus.query(statement, params);
    },
  };
  const renewedStatus = await presence.renewThenReadErpEditStatus(
    renewalDependencies,
    statusScope,
    { userId: 'alice', userName: '앨리스' },
    { leaseToken: 'renewed-token', clientId: 'status-client' },
  );
  assert.equal(renewedStatus.lease.leaseToken, 'renewed-token');
  assert.ok(renewalSequence.indexOf('transaction:commit') < renewalSequence.indexOf('status:get'), 'renewal commit must precede status reads');
  assert.ok(!renewalSequence.includes('transaction:erp'), 'renew-only heartbeat must not query ERP snapshot rows in its transaction');

  const handoffStatus = makeStatusQuery(() => statusLease({
    LeaseToken: 'other-tab-token', OwnerUserId: 'bob', OwnerName: '밥', ClientId: 'other-tab',
  }));
  const handoffResult = await presence.renewThenReadErpEditStatus({
    withTransaction: async (work) => work(async (statement) => (/FROM WebErpEditLease/.test(statement)
      ? { recordset: [renewedLease] } : { recordset: [] })),
    query: handoffStatus.query,
  }, statusScope, { userId: 'alice', userName: '앨리스' }, { leaseToken: 'renewed-token', clientId: 'status-client' });
  const handoffPayload = presence.editPresencePayload(handoffResult, { userId: 'alice', clientId: 'status-client' });
  assert.equal(handoffPayload.lease.ownedByMe, false, 'renew 뒤 작업권이 바뀌면 이전 탭 토큰을 다시 노출하면 안 됩니다.');
  assert.equal(handoffPayload.lease.token, undefined);
  assert.equal(handoffPayload.lease.ownerName, '밥');

  let checkingCommitted = false;
  let checkingError;
  try {
    await presence.renewThenReadErpEditStatus({
      withTransaction: async (work) => {
        const result = await work(async (statement) => (/FROM WebErpEditLease/.test(statement)
          ? { recordset: [renewedLease] } : { recordset: [] }));
        checkingCommitted = true;
        return result;
      },
      query: continuouslyChanging.query,
    }, statusScope, { userId: 'alice', userName: '앨리스' }, { leaseToken: 'renewed-token', clientId: 'status-client' });
  } catch (error) {
    checkingError = error;
  }
  assert.equal(checkingCommitted, true, 'status checking failure must occur after the successful lease renewal commits');
  assert.equal(checkingError?.code, 'ERP_EDIT_STATUS_CHECKING');
  assert.equal(presence.editErrorResponse(checkingError).statusCode, 503, 'post-renew unstable status remains a safe transient response');
  seenSql.length = 0;
  await presence.assertErpEditGuard(fakeQuery, scope, bob, guard);
  assert.ok(seenSql.some((statement) => /UPDLOCK, HOLDLOCK/.test(statement)), 'write assert digest must lock ERP rows');

  const source = fs.readFileSync('lib/erpEditPresence.js', 'utf8');
  assert.match(source, /OrderWeek LIKE @wkLike/g);
  assert.match(source, /readErpEditSnapshot\(tQ, scope, \{ lock: true \}\)/);
  assert.match(source, /const lockHint = lock \? ' WITH \(UPDLOCK, HOLDLOCK\)' : ''/);
  const getStatusSource = source.slice(source.indexOf('export async function getErpEditStatus'), source.indexOf('export async function acquireErpEditLease'));
  assert.doesNotMatch(getStatusSource, /Promise\.all/, '상태 조회는 lease와 snapshot을 병렬 조합하면 안 됩니다.');
  assert.match(getStatusSource, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/, '상태 조회는 최대 세 번만 일관성을 재확인해야 합니다.');
  assert.match(getStatusSource, /ERP_EDIT_STATUS_CHECKING/, '계속 변하면 다른 사용자 변경 대신 일시 상태를 반환해야 합니다.');
  assert.match(source, /renewThenReadErpEditStatus[\s\S]*withTransaction[\s\S]*heartbeatErpEditLease[\s\S]*renewOnly: true[\s\S]*getErpEditStatus/, 'heartbeat orchestration must commit lease renewal before lock-free status read');
  assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|DROP TABLE/);

  const api = fs.readFileSync('pages/api/erp/edit-presence.js', 'utf8');
  assert.match(api, /editPresencePayload/);
  assert.match(api, /action === 'refresh'/);
  assert.match(api, /refreshErpEditLease/);
  assert.match(api, /action === 'heartbeat'[\s\S]*renewThenReadErpEditStatus/, 'API heartbeat must use the renew-only orchestration path');
  assert.doesNotMatch(api, /action === 'heartbeat'[\s\S]{0,180}heartbeatErpEditLease/, 'API heartbeat must not retain the lease while reading ERP rows');
  assert.match(api, /setHeader\('Cache-Control', 'private, no-store, max-age=0'\)/, '편집 상태 응답은 stale 상태를 캐시에서 재사용하면 안 됩니다.');
  const migration = fs.readFileSync('docs/migrations/2026-08-25_web_erp_edit_presence.sql', 'utf8');
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /COMMIT TRANSACTION/);
  assert.match(migration, /BaselineDigest CHAR\(64\) NOT NULL/);
  assert.match(migration, /Revision INT NOT NULL/);

  for (const file of [
    'pages/api/estimate/update-quantity.js', 'pages/api/estimate/update-date-quantity.js',
    'pages/api/estimate/update-cost.js', 'pages/api/estimate/update-entry.js',
    'pages/api/estimate/index.js', 'pages/api/shipment/adjust.js',
    'pages/api/shipment/distribute.js', 'pages/api/shipment/fix.js', 'pages/api/orders/index.js',
  ]) {
    const sourceText = fs.readFileSync(file, 'utf8');
    assert.match(sourceText, /assertErpEditGuard/, `${file} must enforce edit guard`);
    assert.match(sourceText, /advanceErpEditGuard|advanceOptionalFixEditGuard/, `${file} must advance the server baseline after success`);
  }
  const fixApi = fs.readFileSync('pages/api/shipment/fix.js', 'utf8');
  assert.match(fixApi, /editErrorResponse\(err\)/, '확정·확정취소도 편집 충돌을 409로 반환해야 합니다.');
  const orderApi = fs.readFileSync('pages/api/orders/index.js', 'utf8');
  assert.match(orderApi, /code: err\.code/, '붙여넣기 주문등록은 잠금/외부변경 오류 코드를 화면에 전달해야 합니다.');
  const estimateEntryApi = fs.readFileSync('pages/api/estimate/update-entry.js', 'utf8');
  assert.match(estimateEntryApi, /advanceErpEditGuard\(tQ, \{ \.\.\.writeScope, orderWeek: row\.OrderWeek \}/, '기존 견적 행 저장 뒤에도 실제 차수 기준으로 작업 지문을 갱신해야 합니다.');
  assert.match(estimateEntryApi, /expectedProdKey[\s\S]*expectedUnit[\s\S]*expectedDescr/, '기존 견적의 품목·단위·적요 낙관적 검증을 보존해야 합니다.');
  console.log('ERP edit presence contract tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
