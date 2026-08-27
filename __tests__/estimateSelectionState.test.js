import assert from 'node:assert/strict';
import {
  createEstimateSelectionScope,
  createEstimateSelectionState,
  resolveEstimateReloadSelection,
  sameEstimateSelectionScope,
  shouldReloadCapturedEstimateSelection,
} from '../lib/estimateSelectionState.js';

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function applyWhenCurrent(state, token, response, apply) {
  const value = await response;
  if (state.shouldApply(token)) apply(value);
}

const bAllDays = createEstimateSelectionScope({
  year: 2026,
  week: 34,
  selectedId: '34|202',
  selectedCustKey: 202,
  filterCustKey: null,
  includeUnfixed: false,
  weekDays: new Set(['금', '월']),
});

assert.equal(
  sameEstimateSelectionScope(bAllDays, { ...bAllDays, weekDays: ['월', '금', '월'] }),
  true,
  'weekday order/duplicates are display details, not a different request scope',
);
assert.equal(
  sameEstimateSelectionScope(bAllDays, { ...bAllDays, weekDays: '금,월' }),
  true,
  'URL-style weekday filters normalize to the same request scope',
);

const state = createEstimateSelectionState();
const oldList = deferred();
const latestList = deferred();
const visible = { shipments: null, items: null, mismatch: null, loading: true };

const listForA = state.begin('list', { ...bAllDays, selectedId: '34|101', selectedCustKey: 101 });
const listForB = state.begin('list', bAllDays);
const oldListApply = applyWhenCurrent(state, listForA, oldList.promise, (data) => { visible.shipments = data; });
const latestListApply = applyWhenCurrent(state, listForB, latestList.promise, (data) => { visible.shipments = data; });

latestList.resolve([{ CustKey: 202, CustName: 'B' }]);
await latestListApply;
oldList.resolve([{ CustKey: 101, CustName: 'A' }]);
await oldListApply;
assert.deepEqual(visible.shipments, [{ CustKey: 202, CustName: 'B' }], 'late A list cannot overwrite B');

// A save callback can run after a new render. It must be rejected before it
// starts its captured A request, rather than syncing A back into authority.
const saveCallbackScope = { ...bAllDays, selectedId: '34|101', selectedCustKey: 101 };
const currentUserScope = { ...bAllDays, year: 2025, selectedId: '34|303', selectedCustKey: 303 };
state.syncScope(saveCallbackScope);
let staleSaveStarted = false;
const staleSaveToken = state.beginIfCurrent('load', saveCallbackScope, currentUserScope);
if (staleSaveToken) staleSaveStarted = true;
assert.equal(staleSaveStarted, false, 'old save callback starts no A request after B/year selection changed');
assert.equal(state.shouldApply(state.beginIfCurrent('load', currentUserScope, currentUserScope)), true);
assert.equal(state.currentScope().year, '2025', 'rejected callback cannot restore its old year');

const explicitNullSelection = createEstimateSelectionScope({
  ...currentUserScope,
  selectedId: null,
  selectedCustKey: null,
  filterCustKey: null,
});
assert.equal(explicitNullSelection.selectedId, '', 'explicit null clears a selected group');
assert.equal(explicitNullSelection.selectedCustKey, null, 'explicit null clears a selected customer');
assert.equal(explicitNullSelection.filterCustKey, null, 'explicit null clears the top customer filter');

const defectSaveShip = { groupId: '34|101', custKey: 101, shipmentKeys: '1001,1002' };
const defectSaveScope = createEstimateSelectionScope({
  year: 2026, week: 34, selectedId: defectSaveShip.groupId,
  selectedCustKey: defectSaveShip.custKey, filterCustKey: null, weekDays: ['월', '금'],
});
const defectReloads = [];
if (shouldReloadCapturedEstimateSelection(defectSaveScope, defectSaveScope)) {
  defectReloads.push(defectSaveShip.custKey);
}
assert.deepEqual(defectReloads, [101], 'unchanged save scope reloads its captured selectedShip customer');
const userMovedToB = { ...defectSaveScope, selectedId: '34|202', selectedCustKey: 202 };
if (shouldReloadCapturedEstimateSelection(defectSaveScope, userMovedToB)) {
  defectReloads.push(defectSaveShip.custKey);
}
assert.deepEqual(defectReloads, [101], 'F-01: save completion never returns a user from B to saved A');

const topFilterB = { CustKey: 202, CustName: 'B' };
const bReloadSelection = resolveEstimateReloadSelection({
  selectedCust: topFilterB, selectedId: '34|202', selectedCustKey: 202,
});
assert.deepEqual(bReloadSelection, { groupId: '34|202', custKey: 202 },
  'top-filter B reload retains B group identity after the first successful load');
const bFilterScope = createEstimateSelectionScope({
  year: 2026, week: 34, selectedId: bReloadSelection.groupId,
  selectedCustKey: bReloadSelection.custKey, filterCustKey: topFilterB.CustKey,
  includeUnfixed: false, weekDays: ['월', '금'],
});
const reloadState = createEstimateSelectionState();
const firstFilteredReload = reloadState.beginIfCurrent('load', bFilterScope, bFilterScope);
assert.ok(firstFilteredReload, 'filtered B can reload after its first selection');
const weekdayChangedB = { ...bFilterScope, weekDays: ['수'] };
const weekdayReload = reloadState.beginIfCurrent('load', weekdayChangedB, weekdayChangedB);
assert.ok(weekdayReload, 'weekday toggle keeps the B group identity and starts reload');
const priceSaveReload = reloadState.beginIfCurrent('load', weekdayChangedB, weekdayChangedB);
assert.ok(priceSaveReload, 'price-save reload starts for the same selected B group');
assert.equal(resolveEstimateReloadSelection({
  selectedCust: topFilterB, selectedId: '34|101', selectedCustKey: 101,
}).groupId, undefined, 'a different left row never inherits the top-filter B group identity');

// The all-customer list endpoint can return A items even while B is selected.
// A separate B detail request is the only permitted source for the right pane.
const wrongServerItems = deferred();
const verifiedBItems = deferred();
const listToken = state.begin('list', bAllDays);
const detailToken = state.begin('detail', bAllDays);
const detailItemsApply = applyWhenCurrent(state, detailToken, verifiedBItems.promise, (items) => { visible.items = items; });
verifiedBItems.resolve([{ CustKey: 202, ProdKey: 2 }]);
await detailItemsApply;
wrongServerItems.resolve([{ CustKey: 101, ProdKey: 1 }]);
const listPayload = await wrongServerItems.promise;
assert.equal(state.shouldApply(listToken), true, 'the list itself remains current while B detail loads');
assert.equal(listPayload[0].CustKey, 101, 'fixture proves the list payload is first-customer A data');
assert.deepEqual(visible.items, [{ CustKey: 202, ProdKey: 2 }], 'B detail survives a first-customer A list payload');

// Detail and mismatch have independent channels, but both must still belong to B's scope.
const detailForB = state.begin('detail', bAllDays);
const mismatchForB = state.begin('mismatch', bAllDays);
assert.equal(state.shouldApply(detailForB), true);
assert.equal(state.shouldApply(mismatchForB), true);
const filteredWeekDays = { ...bAllDays, weekDays: ['수'] };
state.syncScope(filteredWeekDays);
assert.equal(state.shouldApply(detailForB), false, 'weekday filter change invalidates detail');
assert.equal(state.shouldApply(mismatchForB), false, 'weekday filter change invalidates mismatch');

const beforeYearChange = state.begin('detail', filteredWeekDays);
state.syncScope({ ...filteredWeekDays, year: 2025 });
assert.equal(state.shouldApply(beforeYearChange), false, '2026 response cannot apply after switching to 2025 same week/customer');

const beforeFilterChange = state.begin('mismatch', { ...filteredWeekDays, year: 2025, filterCustKey: 202 });
state.syncScope({ ...filteredWeekDays, year: 2025, filterCustKey: 303 });
assert.equal(state.shouldApply(beforeFilterChange), false, 'top customer filter change invalidates same-week/customer diagnostics');

const finalScope = { ...filteredWeekDays, year: 2025, filterCustKey: 303 };
const latestDetail = state.begin('detail', finalScope);
const staleFinally = state.begin('loading', finalScope);
const newestFinally = state.begin('loading', finalScope);
if (state.shouldApply(staleFinally)) visible.loading = false;
assert.equal(visible.loading, true, 'an older finally cannot clear newer loading state');
if (state.shouldApply(newestFinally)) visible.loading = false;
assert.equal(visible.loading, false);
assert.equal(state.shouldApply(latestDetail), true, 'a same-scope detail remains valid after a loading-channel replacement');

const noRowsSelection = resolveEstimateReloadSelection({
  selectedCust: null,
  selectedId: null,
  selectedCustKey: null,
});
assert.equal(noRowsSelection, null, 'an empty result has no customer fallback selection');

const explicitFilterCleared = createEstimateSelectionScope({
  ...bAllDays,
  selectedId: null,
  selectedCustKey: null,
  filterCustKey: null,
});
assert.equal(explicitFilterCleared.selectedId, '', 'explicit filter clear removes the selected group');
assert.equal(explicitFilterCleared.filterCustKey, null, 'explicit filter clear removes the customer filter');

const selectedAgainB = resolveEstimateReloadSelection({
  selectedCust: { CustKey: 202, CustName: 'B' },
  selectedId: '34|202',
  selectedCustKey: 202,
});
assert.deepEqual(selectedAgainB, { groupId: '34|202', custKey: 202 },
  'explicit B selection is restored as B, never as the first list row');

console.log('estimate selection state tests passed');
