const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const presence = await import('../lib/erpEditPresence.js');
  const { normalizeErpEditClientWeek, mergeErpEditPresenceResponse } = await import('../hooks/useErpEditPresence.js');
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
  assert.deepEqual(presence.normalizeEditScope({ orderYear: '2026', orderWeek: '32-01', custKey: 9 }), { orderYear: '2026', orderWeek: '32', custKey: 9 });
  assert.deepEqual(presence.normalizeEditScope({ orderYear: '2026', week: '32-02', custKey: 9 }), { orderYear: '2026', orderWeek: '32', custKey: 9 });
  assert.throws(() => presence.normalizeEditScope({ orderWeek: '32', custKey: 9 }), /선택 연도와 차수/);
  assert.throws(() => presence.normalizeEditScope({ orderYear: '2026', week: '32-01', custKey: 0 }), /선택 업체/);
  assert.equal(presence.EDIT_LEASE_SECONDS, 90);
  assert.equal(presence.EDIT_HEARTBEAT_SECONDS, 20);

  const lease = new Map();
  const seenSql = [];
  let erpRevision = 0;
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
    if (/FROM OrderMaster/.test(statement)) {
      return { recordset: [{ OrderMasterKey: 1, OrderDetailKey: 1, ProdKey: 9, OutQuantity: erpRevision, BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 0, DetailDeleted: 0, MasterDeleted: 0 }] };
    }
    return { recordset: [] };
  };
  const alice = { userId: 'alice', userName: '앨리스' };
  const bob = { userId: 'bob', userName: '밥' };
  const scope = { orderYear: '2026', orderWeek: '32-01', custKey: 7 };
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
  await assert.rejects(() => presence.acquireErpEditLease(fakeQuery, { ...scope, orderWeek: '32-02' }, bob, { clientId: 'B', pageCode: 'paste' }), { code: 'ERP_EDIT_LOCKED' });
  let sameUserBlocked;
  try {
    await presence.acquireErpEditLease(fakeQuery, { ...scope, orderWeek: '32-02' }, alice, { clientId: 'A-OTHER', pageCode: 'estimate' });
  } catch (error) {
    sameUserBlocked = error;
  }
  assert.equal(sameUserBlocked?.code, 'ERP_EDIT_LOCKED');
  assert.equal(sameUserBlocked.lease.ownedBySameUser, true, '같은 계정의 다른 창임을 구분해야 합니다.');
  const oldMineToken = mine.lease.leaseToken;
  const takenBySameUser = await presence.acquireErpEditLease(fakeQuery, scope, alice, { clientId: 'A-OTHER', pageCode: 'estimate', takeover: true });
  assert.notEqual(takenBySameUser.lease.leaseToken, oldMineToken, '넘겨받기는 기존 창 토큰을 무효화해야 합니다.');
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
  seenSql.length = 0;
  await presence.assertErpEditGuard(fakeQuery, scope, bob, guard);
  assert.ok(seenSql.some((statement) => /UPDLOCK, HOLDLOCK/.test(statement)), 'write assert digest must lock ERP rows');

  const source = fs.readFileSync('lib/erpEditPresence.js', 'utf8');
  assert.match(source, /OrderWeek LIKE @wkLike/g);
  assert.match(source, /readErpEditSnapshot\(tQ, scope, \{ lock: true \}\)/);
  assert.match(source, /const lockHint = lock \? ' WITH \(UPDLOCK, HOLDLOCK\)' : ''/);
  assert.match(source, /Promise\.all\(\[\s*selectLease/);
  assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE|DROP TABLE/);

  const api = fs.readFileSync('pages/api/erp/edit-presence.js', 'utf8');
  assert.match(api, /editPresencePayload/);
  assert.match(api, /action === 'refresh'/);
  assert.match(api, /refreshErpEditLease/);
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
