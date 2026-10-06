import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDutchWorkPayload, restoreDutchWorkSnapshot, DUTCH_WORK_CLIENT_MAX_BYTES } from '../lib/dutchVolumeWorkClient.js';

const workbook = { SheetNames: ['원본'], Sheets: { 원본: { A1: { v: '품목' } } } };
const entries = [{ id: '원본!A2', product: '장미', customer: '업체', quantity: 0, unit: '송이', custKey: 533, prodKey: 2231 }];
const prices = { 'uniform:prod:2231': 0, '원본!A2': '' };
const bulkPriceConfig = { version: 1, enabled: true, excludedCustomers: ['name:주광농원|cl2'] };

const payload = buildDutchWorkPayload({
  name: '2026년 40-01 작업', sourceMode: 'LIVE', fileName: '40-01.xlsx', year: 2026, week: '40-01',
  workbook, entries, prices, bulkPriceConfig, sourceIdentity: 'live:2026:40-01',
  planToken: 'must-not-save', ackQtyWarnings: true, results: [{ success: true }],
});
assert.equal(payload.orderYear, 2026);
assert.equal(payload.orderWeek, '40-01');
assert.deepEqual(payload.entries, entries, 'zero quantity and manual keys remain intact');
assert.deepEqual(payload.prices, prices, 'zero and blank prices remain distinguishable');
assert.deepEqual(payload.bulkPriceConfig, bulkPriceConfig, '일괄 단가 업체 선택을 저장본에 보존한다.');
for (const forbidden of ['planToken', 'ackQtyWarnings', 'results', 'jobId', 'preview', 'applyResult']) {
  assert.equal(Object.hasOwn(payload, forbidden), false, `${forbidden} is never persisted in a work archive`);
}

const restored = restoreDutchWorkSnapshot({
  id: '0f43b19d-3a34-4f02-8f67-8d5d6ea4a540', name: payload.name, sourceMode: 'LIVE', fileName: payload.fileName,
  orderYear: 2025, orderWeek: '40-01', workbook, entries, prices, bulkPriceConfig,
  planToken: 'stale', preview: { success: true }, results: [{ success: true }],
});
assert.equal(restored.year, 2025, 'saved year wins over current UI year');
assert.equal(restored.week, '40-01');
assert.equal(restored.baseIdentity, 'saved:0f43b19d-3a34-4f02-8f67-8d5d6ea4a540');
assert.match(restored.identity, /^saved:0f43b19d-3a34-4f02-8f67-8d5d6ea4a540:/);
assert.equal(restored.prices['uniform:prod:2231'], 0);
assert.equal(restored.prices['원본!A2'], '');
assert.deepEqual(restored.bulkPriceConfig, bulkPriceConfig, '저장본 복원은 당시 일괄 업체 설정을 되살린다.');
assert.equal(restored.planToken, undefined, 'restore result cannot revive a stale plan token');
assert.throws(() => restoreDutchWorkSnapshot({ ...payload, id: '' }), /저장본/);
assert.throws(() => restoreDutchWorkSnapshot({ ...payload, id: 'x', orderWeek: '40' }), /연도·차수/);

assert.equal(DUTCH_WORK_CLIENT_MAX_BYTES, 900 * 1024);

const page = readFileSync(new URL('../pages/stats/dutch-volume-board.js', import.meta.url), 'utf8');
const restoreStart = page.indexOf('async function restoreWork(id) {');
const restoreEnd = page.indexOf('\n  async function reviewForUpload()', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'restoreWork can be isolated for contract checks');
const restoreFunctionSource = page.slice(restoreStart, restoreEnd);
assert.doesNotMatch(restoreFunctionSource, /acceptSource\(/, 'saved work restoration bypasses localStorage-backed acceptSource');
assert.doesNotMatch(restoreFunctionSource, /localStorage/, 'saved work restoration does not read or rewrite browser drafts');
assert.doesNotMatch(restoreFunctionSource, /dutch-volume-apply|method:\s*['"]POST['"]/, 'restoring a work archive never posts to ERP');
for (const resetCall of ['setMatchCache({})', 'setProductOptions([])', 'setCustomerOptions([])', 'setApplyResult(null)', "setActiveJobId('')", "setLegacyCurrency('')", 'setDraftReset(false)', "setRematchNotice('')", "setQuery('')", "setActiveTab('sheet')", "setActiveEntryId('')"]) {
  assert.match(restoreFunctionSource, new RegExp(resetCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `restore clears ${resetCall}`);
}
assert.match(restoreFunctionSource, /setYear\(restored\.year\); setWeek\(restored\.week\)/);
assert.match(restoreFunctionSource, /setStorageKey\(restored\.identity\)/);

const persistStart = page.indexOf('async function persistWork(');
const applyStart = page.indexOf('async function applyPreview()');
const erpPost = page.indexOf("fetch('/api/shipment/dutch-volume-apply'", applyStart);
assert.ok(persistStart >= 0 && applyStart > persistStart && erpPost > applyStart);
assert.ok(page.indexOf('await persistWork(workName ||', applyStart) < erpPost, 'saved archive is created before ERP apply POST');
assert.match(page.slice(applyStart, erpPost), /작업 저장 응답을 확인하지 못했습니다|ERP 적용 요청은 보내지 않았습니다/);
assert.match(page.slice(applyStart, erpPost), /return;/, 'failed archive prevents ERP apply request');
assert.match(page.slice(applyStart, erpPost), /window\.confirm\(summary\)/, 'ERP apply remains explicit manual review');
assert.match(page, /planToken: preview\.planToken/);

// Execute the real page functions with side-effect stubs: archive failure must
// stop before ERP, while a successful archive permits exactly one ERP POST.
const applyEnd = page.indexOf('\n  return <>', applyStart);
const applySource = page.slice(applyStart, applyEnd).replace(/\bfetch\(/g, 'requestFetch(');
const applyNames = ['previewCurrent', 'ackReplacement', 'warningRows', 'ackQtyWarnings', 'applyingRef', 'workBusyRef', 'window', 'year', 'week', 'preview', 'changedRows', 'missingRows', 'blockedRows', 'workName', 'fileName', 'persistWork', 'setWorkError', 'setWorkBusy', 'setApplying', 'setActiveJobId', 'setError', 'setApplyResult', 'previewRows', 'crypto', 'setInterval', 'requestHeaders', 'requestFetch', 'recoverJob', 'invalidate', 'clearInterval'];
const makeApply = ({ persist, fetchImpl, busy = false, applying = false }) => {
  const state = { fetches: [], errors: [], busyCalls: [], applyCalls: [], resultCalls: [], invalidated: 0 };
  const values = {
    previewCurrent: true, ackReplacement: true, warningRows: [], ackQtyWarnings: true,
    applyingRef: { current: applying }, workBusyRef: { current: busy }, window: { confirm: () => true },
    year: 2026, week: '40-01', preview: { planToken: 'fresh-plan', replacementCategories: [] }, changedRows: [], missingRows: [], blockedRows: [],
    workName: 'saved-work', fileName: '40-01.xlsx', persistWork: persist,
    setWorkError: value => state.errors.push(value), setWorkBusy: value => state.busyCalls.push(value), setApplying: value => state.applyCalls.push(value),
    setActiveJobId: () => {}, setError: value => state.errors.push(value), setApplyResult: value => state.resultCalls.push(value), previewRows: [],
    crypto: { randomUUID: () => 'job-id' }, setInterval: () => 1, requestHeaders: { 'Content-Type': 'application/json' }, clearInterval: () => {},
    requestFetch: async (...args) => { state.fetches.push(args); return fetchImpl(...args); }, recoverJob: async () => ({ success: false }), invalidate: () => { state.invalidated += 1; },
  };
  const fn = new Function(...applyNames, `${applySource}\nreturn applyPreview;`)(...applyNames.map(name => values[name]));
  return { fn, state };
};
const failedApply = makeApply({ persist: async () => { throw new Error('archive failed'); }, fetchImpl: async () => ({ status: 200, json: async () => ({ success: true }) }) });
await failedApply.fn();
assert.equal(failedApply.state.fetches.length, 0, 'archive failure makes no ERP request');
assert(failedApply.state.errors.some(value => String(value).includes('ERP 적용 요청은 보내지 않았습니다')), 'archive error explains that ERP apply was not requested');
const successfulApply = makeApply({ persist: async () => ({ id: 'saved' }), fetchImpl: async () => ({ status: 200, json: async () => ({ success: true, jobId: 'job-id' }) }) });
await successfulApply.fn();
assert.equal(successfulApply.state.fetches.length, 1, 'successful archive sends one ERP request');
assert.equal(successfulApply.state.fetches[0][0], '/api/shipment/dutch-volume-apply');
const duplicateApply = makeApply({ persist: async () => ({ id: 'unexpected' }), busy: true, fetchImpl: async () => ({ status: 200, json: async () => ({ success: true }) }) });
await duplicateApply.fn();
assert.equal(duplicateApply.state.fetches.length, 0, 'busy guard blocks duplicate apply');

// Execute restoreWork and verify saved scope replaces the current scope and
// invalidates all preview/acknowledgement state without an ERP call.
const restoreSource = page.slice(restoreStart, restoreEnd);
const restoreState = { setters: [], fetches: [], invalidated: 0 };
const setter = name => value => restoreState.setters.push([name, value]);
const restoredSnapshot = { id: '0f43b19d-3a34-4f02-8f67-8d5d6ea4a540', name: '저장본', fileName: 'saved.xlsx', orderYear: 2025, orderWeek: '39-02', workbook, entries, prices };
const restoreValues = {
  workBusyRef: { current: false }, applyingRef: { current: false }, loading: false, window: { confirm: () => true }, setWorkBusy: setter('busy'), setWorkError: setter('error'), setWorkNotice: setter('notice'),
  loadRequestRef: { current: 0 }, invalidate: () => { restoreState.invalidated += 1; }, fetch: async (...args) => { restoreState.fetches.push(args); return { ok: true, json: async () => ({ success: true, snapshot: restoredSnapshot }) }; },
  restoreDutchWorkSnapshot, sourceModeRef: {}, sourceRef: {}, sourceBaseRef: {}, yearRef: {}, weekRef: {}, setYear: setter('year'), setWeek: setter('week'), setSourceMode: setter('sourceMode'), setStorageKey: setter('storageKey'),
  setWorkbook: setter('workbook'), setEntries: setter('entries'), setPrices: setter('prices'), setBulkPriceConfig: setter('bulkPriceConfig'), setBulkPriceSettingsDraft: setter('bulkPriceSettingsDraft'), setBulkPriceSettingsOpen: setter('bulkPriceSettingsOpen'), setDayEdits: setter('dayEdits'), setFileName: setter('fileName'), setWorkName: setter('workName'), setMatchCache: setter('matchCache'), setProductOptions: setter('products'), setCustomerOptions: setter('customers'), setApplyResult: setter('applyResult'), setActiveJobId: setter('jobId'), setLegacyCurrency: setter('currency'), setDraftReset: setter('draftReset'), setRematchNotice: setter('rematch'), setQuery: setter('query'), setActiveTab: setter('tab'), setActiveEntryId: setter('entry'), setError: setter('pageError'),
  normalizeDutchBulkPriceConfig: config => config || { version: 1, enabled: true, excludedCustomers: [] },
};
const restoreNames = Object.keys(restoreValues);
const restoreFn = new Function(...restoreNames, `${restoreFunctionSource}\nreturn restoreWork;`)(...restoreNames.map(name => restoreValues[name]));
await restoreFn('saved-id');
assert.equal(restoreState.invalidated, 1);
assert.equal(restoreState.fetches.length, 1);
assert.deepEqual(restoreState.setters.find(([name]) => name === 'year'), ['year', 2025]);
assert.deepEqual(restoreState.setters.find(([name]) => name === 'week'), ['week', '39-02']);
for (const name of ['dayEdits', 'bulkPriceConfig', 'bulkPriceSettingsDraft', 'bulkPriceSettingsOpen', 'matchCache', 'products', 'customers', 'applyResult', 'jobId', 'currency', 'draftReset', 'rematch', 'query', 'tab', 'entry']) assert(restoreState.setters.some(([key]) => key === name), `restore clears/restores ${name}`);

console.log('dutch volume work client tests passed');
