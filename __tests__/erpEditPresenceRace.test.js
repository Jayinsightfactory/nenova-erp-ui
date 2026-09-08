const assert = require('node:assert/strict');

async function main() {
  const {
    createErpPresenceRequestCoordinator,
    isErpOwnSaveSettlement,
    mergeCurrentErpEditPresenceResponse,
  } = await import('../hooks/useErpEditPresence.js');

  const scope = { orderYear: '2026', orderWeek: '34', custKey: 7 };
  const scopeKey = '2026/34/7';
  const response = ({ digest, revision, stale = false, token = 'mine', responseScope = scope }) => ({
    digest,
    stale,
    scope: responseScope,
    lease: { active: true, ownedByMe: true, token, revision, pageCode: 'estimate' },
  });
  const coordinator = createErpPresenceRequestCoordinator();
  coordinator.setScope(scopeKey);

  let state = {
    scopeKey,
    token: 'mine',
    revision: 1,
    digest: 'A',
    stale: false,
  };

  // A poll/heartbeat that started before the save must not overwrite the
  // transaction-advanced own-save baseline when its response arrives late.
  const preSaveRequest = coordinator.begin({ token: state.token, savingCount: 0 });
  coordinator.invalidateForSave();
  const duringSaveRequest = coordinator.begin({ token: state.token, savingCount: 1 });
  const endSavingRequest = coordinator.begin({ token: state.token, savingCount: 1 });
  const ownSave = response({ digest: 'B', revision: 2 });
  assert.equal(coordinator.canApply(endSavingRequest, state, ownSave, { allowDuringSave: true }), true);
  coordinator.markApplied(endSavingRequest);
  state = mergeCurrentErpEditPresenceResponse(state, ownSave);
  assert.equal(state.digest, 'B');
  assert.equal(state.stale, false);
  assert.equal(coordinator.canApply(preSaveRequest, state, response({ digest: 'A', revision: 1 })), false);
  assert.equal(coordinator.canApply(duringSaveRequest, state, response({ digest: 'A', revision: 1 })), false);

  // If the authoritative endSaving heartbeat response is lost, a coherent
  // poll may settle the own write only with the same token, ownedByMe=true,
  // stale=false and a strictly newer server revision.
  assert.equal(isErpOwnSaveSettlement({ ...state, digest: 'A', revision: 1 }, ownSave), true);
  assert.equal(isErpOwnSaveSettlement(state, ownSave), false, 'equal revision is not an own-save settlement');
  assert.equal(isErpOwnSaveSettlement({ ...state, revision: 1 }, response({ digest: 'B', revision: 2, stale: true })), false);
  assert.equal(isErpOwnSaveSettlement({ ...state, revision: 1 }, response({ digest: 'B', revision: 2, token: 'other' })), false);
  assert.equal(isErpOwnSaveSettlement({ ...state, revision: 1 }, {
    ...ownSave,
    lease: { ...ownSave.lease, ownedByMe: false },
  }), false);

  // Equal-revision requests are ordered by request start. An older response
  // cannot land after a newer one merely because the network completed late.
  const older = coordinator.begin({ token: state.token, savingCount: 0 });
  const newer = coordinator.begin({ token: state.token, savingCount: 0 });
  assert.equal(coordinator.canApply(newer, state, ownSave), true);
  coordinator.markApplied(newer);
  assert.equal(coordinator.canApply(older, state, ownSave), false);

  // A genuine EXE edit remains sticky at the same lease revision. Only an
  // explicit refresh or a newer server transaction revision may clear it.
  const externalRequest = coordinator.begin({ token: state.token, savingCount: 0 });
  const external = response({ digest: 'C', revision: 2, stale: true });
  assert.equal(coordinator.canApply(externalRequest, state, external), true);
  coordinator.markApplied(externalRequest);
  state = mergeCurrentErpEditPresenceResponse(state, external);
  assert.equal(state.stale, true);
  const lateCleanRequest = coordinator.begin({ token: state.token, savingCount: 0 });
  const lateClean = response({ digest: 'B', revision: 2, stale: false });
  assert.equal(coordinator.canApply(lateCleanRequest, state, lateClean), true);
  coordinator.markApplied(lateCleanRequest);
  state = mergeCurrentErpEditPresenceResponse(state, lateClean);
  assert.equal(state.stale, true, 'automatic equal-revision response must not clear external stale');
  const explicitRefresh = response({ digest: 'C', revision: 3, stale: false });
  state = mergeCurrentErpEditPresenceResponse(state, explicitRefresh, { allowStaleClear: true });
  assert.equal(state.stale, false);
  assert.equal(state.revision, 3);

  // Scope changes and a newly started save invalidate an old endSaving result
  // or error immediately, before React effect cleanup runs.
  coordinator.invalidateForSave();
  const lateEndForOldScope = coordinator.begin({ token: state.token, savingCount: 1 });
  coordinator.setScope('2026/34/8');
  assert.equal(coordinator.canApply(lateEndForOldScope, state, {} , { allowDuringSave: true }), false);

  coordinator.setScope(scopeKey);
  coordinator.invalidateForSave();
  const lateEndForOldSave = coordinator.begin({ token: state.token, savingCount: 1 });
  coordinator.invalidateForSave();
  assert.equal(coordinator.canApply(lateEndForOldSave, state, {}, { allowDuringSave: true }), false);

  // A lower server revision is rejected even when it belongs to a freshly
  // started request in the current epoch.
  const currentState = { ...state, scopeKey, revision: 3 };
  const regressedRevision = coordinator.begin({ token: currentState.token, savingCount: 0 });
  assert.equal(coordinator.canApply(regressedRevision, currentState, response({ digest: 'B', revision: 2 })), false);

  console.log('ERP edit presence request race tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
