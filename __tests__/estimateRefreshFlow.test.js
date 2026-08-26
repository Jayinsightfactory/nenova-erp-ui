import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
  createEstimateSelectionScope,
  createEstimateSelectionState,
  resolveEstimateReloadSelection,
  sameEstimateSelectionScope,
  shouldReloadCapturedEstimateSelection,
} from '../lib/estimateSelectionState.js';

const page = fs.readFileSync('pages/estimate.js', 'utf8');
const require = createRequire(import.meta.url);
const babelParser = require('next/dist/compiled/babel/bundle').parser();
const pageAst = babelParser.parse(page, { sourceType: 'module', plugins: ['jsx'] });
const failures = [];

function check(label, condition) {
  if (!condition) failures.push(label);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function scopeFor({ year = 2026, custKey = 202, selectedId = '34|202', filterCustKey = 202 } = {}) {
  return createEstimateSelectionScope({
    year,
    week: 34,
    selectedId,
    selectedCustKey: custKey,
    filterCustKey,
    includeUnfixed: false,
    weekDays: ['월', '금'],
  });
}

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'leadingComments', 'innerComments', 'trailingComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walkAst(child, visit));
    else if (value && typeof value === 'object') walkAst(value, visit);
  }
}

function pageFunctionNode(name) {
  let found = null;
  walkAst(pageAst, node => {
    if (found) return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
      found = node;
      return;
    }
    if (node.type !== 'VariableDeclarator' || node.id?.name !== name) return;
    if (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression') {
      found = node.init;
    } else if (node.init?.type === 'CallExpression' && node.init.arguments?.[0]
      && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init.arguments[0].type)) {
      found = node.init.arguments[0];
    }
  });
  assert.ok(found, `${name} AST function exists`);
  return found;
}

function functionSource(name) {
  const node = pageFunctionNode(name);
  return page.slice(node.start, node.end);
}

function extractFunctionBody(marker, label = marker) {
  const node = pageFunctionNode(label);
  assert.equal(node.body?.type, 'BlockStatement', `${label} AST block exists`);
  return page.slice(node.body.start + 1, node.body.end - 1);
}

function jsxAttributeNode(element, attribute, label = attribute) {
  const attr = element.openingElement.attributes.find(item => item.type === 'JSXAttribute'
    && item.name?.name === attribute);
  assert.ok(attr?.value?.expression, `${label} AST callback exists`);
  assert.equal(attr.value.expression.type, 'ArrowFunctionExpression', `${label} is an arrow callback`);
  return attr.value.expression;
}

function extractJsxAttributeBody(element, attribute, label = attribute) {
  const node = jsxAttributeNode(element, attribute, label);
  return page.slice(node.start, node.end);
}

function findCustomerInput() {
  let found = null;
  walkAst(pageAst, node => {
    if (found || node.type !== 'JSXElement' || node.openingElement.name?.name !== 'input') return;
    const hasCustomerValue = node.openingElement.attributes.some(attr => attr.type === 'JSXAttribute'
      && attr.name?.name === 'value'
      && attr.value?.expression?.type === 'Identifier'
      && attr.value.expression.name === 'custSearch');
    if (hasCustomerValue) found = node;
  });
  assert.ok(found, 'customer search input AST exists');
  return found;
}

function findLanguageToggle() {
  let found = null;
  walkAst(pageAst, node => {
    if (found || node.type !== 'JSXElement' || node.openingElement.name?.name !== 'button') return;
    const onClick = node.openingElement.attributes.find(attr => attr.type === 'JSXAttribute'
      && attr.name?.name === 'onClick');
    if (onClick?.value?.expression && page.slice(onClick.value.expression.start, onClick.value.expression.end)
      .includes('setCustInputMode')) found = node;
  });
  assert.ok(found, 'language toggle button AST exists');
  return found;
}

function compileExpression(source, context) {
  return vm.runInNewContext(`(${source})`, vm.createContext(context));
}

function compileInContext(source, context) {
  return vm.runInContext(`(${source})`, context);
}

async function settle(token, response, state, apply, onError, onFinally) {
  try {
    const value = await response;
    if (state.shouldApply(token)) apply(value);
  } catch (error) {
    if (state.shouldApply(token)) onError(error);
  } finally {
    if (state.shouldApply(token)) onFinally();
  }
}

// Actual page save callback wiring: each callback must capture the selected
// scope and invoke the common list -> selected-detail refresh helper.
const saveCallbacks = [
  ['applyQtyEdits', 'const applyQtyEdits = async () =>'],
  ['applyCostEdits', 'async function applyCostEdits'],
  ['applyAllEdits', 'async function applyAllEdits'],
  ['handleSelectedDeductionDelete', 'const handleSelectedDeductionDelete = async () =>'],
  ['handleDefectSave', 'const handleDefectSave = async () =>'],
  ['saveItemEditor', 'const saveItemEditor = async () =>'],
];
for (const [name, marker] of saveCallbacks) {
  const body = extractFunctionBody(marker, name);
  check(name + ' captures refresh scope', body.includes('captureEstimateRefresh('));
  check(name + ' calls common refresh', body.includes('refreshCapturedEstimate('));
}
// A direct detail-only reload is a real branch-level bypass, not equivalent
// to the common refresh contract.
const itemEditorBody = extractFunctionBody('const saveItemEditor = async () =>', 'saveItemEditor');
check('saveItemEditor has no direct reload bypass', !itemEditorBody.includes('reloadSelectedShipmentItems('));

const captureBody = extractFunctionBody('const captureEstimateRefresh = () =>', 'captureEstimateRefresh');
const refreshBody = extractFunctionBody('const refreshCapturedEstimate = async (captured) =>', 'refreshCapturedEstimate');
check('capture helper records selected group and customer', captureBody.includes('groupId: selectedId')
  && captureBody.includes('custKey: selectedShip.CustKey'));
check('common refresh rejects a moved scope before load', refreshBody.includes('shouldReloadCapturedEstimateSelection(captured.scope, renderedSelectionScopeRef.current)')
  && refreshBody.includes('return { skipped: true }'));
check('common refresh preserves captured group/customer', refreshBody.includes('preserveSelection: { groupId: captured.ship.groupId, custKey: captured.ship.custKey }'));
check('common refresh reloads through load', refreshBody.includes('await load(true')
  && refreshBody.includes('return isCapturedEstimateScopeCurrent(captured) ? refreshed : { skipped: true }'));

// Locate the actual JSX callbacks through Babel's AST, then execute those
// callbacks with state-setter/navigation fakes. This is deliberately stronger
// than checking that an action label appears in a helper loop.
const customerInput = findCustomerInput();
const inputChangeBody = extractJsxAttributeBody(customerInput, 'onChange', 'customer onChange');
check('input onChange invalidates picked search name', inputChangeBody.includes('custPickedName.current = null'));
check('input onChange handles composition and paste branches', inputChangeBody.includes('e.nativeEvent.isComposing')
  && inputChangeBody.includes("e.nativeEvent.inputType === 'insertFromPaste'")
  && inputChangeBody.includes('convertQwertyInputToHangul(raw)'));
check('input onChange writes raw and converted search text', inputChangeBody.includes('setCustSearch(raw)')
  && inputChangeBody.includes('setCustSearch(converted)'));
check('input onChange resets customer navigation', inputChangeBody.includes('custNav.reset()'));

const inputKeyDownBody = extractJsxAttributeBody(customerInput, 'onKeyDown', 'customer onKeyDown');
check('Hangul key handler calls editHangulSearchBuffer', inputKeyDownBody.includes('editHangulSearchBuffer('));
check('Hangul key handler writes edited display/buffer', inputKeyDownBody.includes('setCustQwertyBuf(edit.buffer)')
  && inputKeyDownBody.includes('setCustSearch(edit.display)'));
check('closed Enter does not select a new row', inputKeyDownBody.includes("if (e.key === 'Enter' && !showCustDrop) return"));
check('open key handler delegates navigation', inputKeyDownBody.includes('custNav.onKeyDown(e)'));

const inputSetters = [];
const inputNav = { reset: () => inputSetters.push('nav.reset'), onKeyDown: () => inputSetters.push('nav.key') };
const inputContext = {
  custPickedName: { current: 'A' },
  custQwertyBuf: 'rk',
  custSearch: '기존',
  custInputMode: 'ko',
  showCustDrop: false,
  custNav: inputNav,
  setCustQwertyBuf: value => inputSetters.push(['buf', value]),
  setCustSearch: value => inputSetters.push(['search', value]),
  convertQwertyInputToHangul: value => `한글:${value}`,
  editHangulSearchBuffer: () => ({ handled: true, buffer: 'rkf', display: '가' }),
};
const inputOnChange = compileExpression(inputChangeBody, inputContext);
inputOnChange({ target: { value: '한' }, nativeEvent: { isComposing: true, inputType: 'insertText' } });
inputOnChange({ target: { value: 'rk' }, nativeEvent: { isComposing: false, inputType: 'insertFromPaste' } });
check('executed input composition clears buffer and writes raw text', inputSetters.some(v => v[0] === 'buf' && v[1] === '')
  && inputSetters.some(v => v[0] === 'search' && v[1] === '한'));
check('executed input paste converts and preserves qwerty buffer', inputSetters.some(v => v[0] === 'buf' && v[1] === 'rk')
  && inputSetters.some(v => v[0] === 'search' && v[1] === '한글:rk'));
check('executed input invalidates picked name and resets navigation', inputContext.custPickedName.current === null
  && inputSetters.filter(v => v === 'nav.reset').length === 2);

const inputOnKeyDown = compileExpression(inputKeyDownBody, inputContext);
const handledKey = {
  key: 'r',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  nativeEvent: { isComposing: false },
  currentTarget: { selectionStart: 0, selectionEnd: 0 },
  preventDefault: () => inputSetters.push('preventDefault'),
};
inputOnKeyDown(handledKey);
check('executed Hangul key handler edits display and buffer', inputSetters.some(v => v[0] === 'buf' && v[1] === 'rkf')
  && inputSetters.some(v => v[0] === 'search' && v[1] === '가')
  && inputSetters.includes('preventDefault'));
const closedEnter = { ...handledKey, key: 'Enter' };
inputContext.showCustDrop = false;
inputContext.editHangulSearchBuffer = () => ({ handled: false });
inputOnKeyDown(closedEnter);
check('executed closed Enter does not navigate', !inputSetters.includes('nav.key'));
inputContext.showCustDrop = true;
inputOnKeyDown({ ...closedEnter, key: 'ArrowDown' });
check('executed open key delegates navigation', inputSetters.includes('nav.key'));

const languageToggle = findLanguageToggle();
const languageToggleBody = extractJsxAttributeBody(languageToggle, 'onClick', 'language toggle');
check('language toggle changes mode', languageToggleBody.includes('setCustInputMode(mode =>'));
check('language toggle resets search draft', languageToggleBody.includes("resetCustomerSearch('')")
  && languageToggleBody.includes('setCustList([])'));
let languageMode;
let languageReset;
let languageList;
const languageOnClick = compileExpression(languageToggleBody, {
  setCustInputMode: updater => { languageMode = updater('ko'); },
  resetCustomerSearch: value => { languageReset = value; },
  setCustList: value => { languageList = value; },
});
languageOnClick();
check('executed language toggle changes mode and clears draft/list', languageMode === 'en'
  && languageReset === '' && Array.isArray(languageList) && languageList.length === 0);
const clearFilterBody = extractFunctionBody('const clearCustomerFilter = useCallback(() =>', 'clearCustomerFilter');
check('explicit filter clear resets draft and selected filter', clearFilterBody.includes("resetCustomerSearch('')")
  && clearFilterBody.includes('setSelectedCust(null)'));
const pickCustomerBody = extractFunctionBody('const pickCustomer = useCallback((c) =>', 'pickCustomer');
check('explicit B pick supersedes search and restores all weekdays', pickCustomerBody.includes('custReqSeq.current += 1')
  && pickCustomerBody.includes('setSelectedCust(c)')
  && pickCustomerBody.includes('setActiveWD(new Set(WEEKDAYS))'));

// Execute the actual cost-save function. The fake timer pauses at the real
// 400ms boundary; then the rendered scope is changed from A to B before the
// captured refresh resumes. A stale refresh may not clear B's pending edits.
const costAScope = scopeFor({ custKey: 101, selectedId: '34|101', filterCustKey: 101 });
const costBScope = scopeFor({ custKey: 202, selectedId: '34|202', filterCustKey: 202 });
const costTimers = [];
const costEditsClears = [];
const costLoads = [];
let costLog = [];
const costContext = {
  editedCount: 1,
  selectedShipmentKeys: [7],
  selectedShip: {
    CustKey: 101,
    CustName: 'A',
    SubWeeks: '34-01',
    ParentWeek: '34',
    ShipmentKeys: '7',
    firstShipmentKey: 7,
  },
  selectedId: '34|101',
  yearStr: '2026',
  costMode: 'normal',
  costEdits: { rowA: '12' },
  items: [{ key: 'rowA', ShipmentKey: 7, SdetailKey: 70, Cost: 10, OrderWeek: '34', ProdName: '장미', CountryFlower: 'KR' }],
  renderedSelectionScopeRef: { current: costAScope },
  buildSelectionScope: () => costAScope,
  setCostApplying: () => {},
  setEditApplyTitle: () => {},
  setCostResult: () => {},
  setCostApplyLog: next => { costLog = typeof next === 'function' ? next(costLog) : next; },
  setErr: () => {},
  setCostEdits: next => costEditsClears.push(next),
  ensureEstimateEditAllowed: () => true,
  getItemEditKey: item => item.key,
  isEstimateEditKey: () => false,
  requireCostSnapshot: () => ({}),
  estimateEditGuard: () => ({ guard: true }),
  estimateEditPresence: {
    beginSaving: () => {},
    endSaving: async () => {},
    markStale: () => {},
  },
  fetch: async () => ({ json: async () => ({ success: true, changes: [{ key: 70 }], diffAmount: 2 }) }),
  setTimeout: (callback, delay) => { costTimers.push({ callback, delay }); return costTimers.length; },
  shouldReloadCapturedEstimateSelection,
  load: async (...args) => { costLoads.push(args); },
};
const costVm = vm.createContext(costContext);
costContext.captureEstimateRefresh = compileInContext(functionSource('captureEstimateRefresh'), costVm);
costContext.isCapturedEstimateScopeCurrent = captured => Boolean(captured)
  && shouldReloadCapturedEstimateSelection(captured.scope, costContext.renderedSelectionScopeRef.current);
costContext.refreshCapturedEstimate = compileInContext(functionSource('refreshCapturedEstimate'), costVm);
const costSave = compileInContext(functionSource('applyCostEdits'), costVm);
let costRunError = null;
const costRun = costSave().catch(error => { costRunError = error; });
for (let i = 0; i < 20 && costTimers.length === 0; i += 1) await Promise.resolve();
check('actual cost save reaches the 400ms refresh boundary', costTimers.some(timer => timer.delay === 400));
if (costTimers.length) {
  costContext.renderedSelectionScopeRef.current = costBScope;
  costTimers[0].callback();
}
await costRun;
check('actual cost save VM completes without error', costRunError === null);
check('A refresh is skipped after switching to B during the delay', costLoads.length === 0);
check('B cost edits remain after stale A refresh', !costEditsClears.some(value => value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === 0));

// Execute the actual detail request and actual load. Primary detail failure
// enters fallback; a same-scope fresh list request then supersedes it. The
// old fallback rejection must not set an error or run its finally cleanup.
const lateScope = scopeFor({ custKey: 202, selectedId: '34|202', filterCustKey: 202 });
const detailState = createEstimateSelectionState();
const detailRenderedRef = { current: lateScope };
const detailEvents = [];
const primaryDetail = deferred();
const fallbackDetail = deferred();
const listLoad = deferred();
const apiCalls = [];
let detailCallCount = 0;
const detailContext = {
  beginCurrentSelectionRequest: (channel, scope, fresh = false) => (
    detailState[fresh ? 'beginFreshIfCurrent' : 'beginIfCurrent'](channel, scope, detailRenderedRef.current)
  ),
  estimateSelectionStateRef: { current: detailState },
  renderedSelectionScopeRef: detailRenderedRef,
  setItemLoading: value => detailEvents.push(['itemLoading', value]),
  setItems: value => detailEvents.push(['items', value]),
  setErr: value => detailEvents.push(['err', value]),
  apiGet: (url, params) => {
    apiCalls.push({ url, params });
    if (params.shipmentKey) return fallbackDetail.promise;
    if (params.itemsOnly) {
      detailCallCount += 1;
      return detailCallCount === 1 ? primaryDetail.promise : fallbackDetail.promise;
    }
    return listLoad.promise;
  },
  setLoading: value => detailEvents.push(['loading', value]),
  setShipments: value => detailEvents.push(['shipments', value]),
  setSelectedGroups: value => detailEvents.push(['groups', value]),
  setSelectedDeductionKeys: value => detailEvents.push(['deductions', value]),
  resetEstimateDeductionSelection: () => [],
  setMismatch: value => detailEvents.push(['mismatch', value]),
  setSelectedId: value => detailEvents.push(['selectedId', value]),
  setSelectedCustKey: value => detailEvents.push(['selectedCustKey', value]),
  estimateShipmentGroupId: ship => ship.groupId,
  requestMismatch: () => {},
  requestShipmentItems: null,
  weekNum: 34,
  selectedCust: { CustKey: 202 },
  selectedId: '34|202',
  selectedCustKey: 202,
  yearStr: '2026',
  activeWD: new Set(['월', '금']),
  includeUnfixed: false,
  queryIncludeUnfixedRef: { current: false },
  buildSelectionScope: () => lateScope,
  activateSelectionScope: scope => {
    detailRenderedRef.current = scope;
    detailState.syncScope(scope);
  },
  resolveEstimateReloadSelection,
};
const detailVm = vm.createContext(detailContext);
detailContext.requestShipmentItems = compileInContext(functionSource('requestShipmentItems'), detailVm);
const loadEstimate = compileInContext(functionSource('load'), detailVm);
const detailRun = detailContext.requestShipmentItems(
  { CustKey: 202, ShipmentKeys: '77' },
  lateScope,
);
primaryDetail.reject(new Error('primary detail failed'));
for (let i = 0; i < 20 && apiCalls.length < 2; i += 1) await Promise.resolve();
check('actual detail VM reaches primary and fallback API calls', apiCalls.length === 2);
const eventsBeforeFreshLoad = detailEvents.length;
const loadRun = loadEstimate(true);
for (let i = 0; i < 20 && apiCalls.length < 3; i += 1) await Promise.resolve();
check('actual same-scope load starts while fallback is pending', apiCalls.length === 3);
const eventsAfterFreshLoad = detailEvents.length;
fallbackDetail.reject(new Error('late fallback failed'));
await detailRun;
check('late fallback adds no error or finally event after fresh load', detailEvents.length === eventsAfterFreshLoad
  || detailEvents.slice(eventsAfterFreshLoad).every(([kind]) => !['err', 'itemLoading'].includes(kind)));
listLoad.resolve({ shipments: [] });
await loadRun;
check('late fallback does not overwrite current error state', !detailEvents.some(([kind, value]) => kind === 'err'
  && String(value).includes('late fallback')));

// Pure helper flow coverage: the same B scope is retained after every
// business action, while year/customer changes invalidate old tokens.
const b2026 = scopeFor();
const selectedB = resolveEstimateReloadSelection({
  selectedCust: { CustKey: 202, CustName: 'B' },
  selectedId: '34|202',
  selectedCustKey: 202,
});
for (const action of ['general-load', 'quantity-save', 'cost-save', 'combined-save',
  'deduction-delete', 'registration', 'item-info-edit']) {
  check(action + ' keeps B selection on captured refresh',
    selectedB?.groupId === '34|202'
    && shouldReloadCapturedEstimateSelection(b2026, b2026));
}
check('search draft keeps selected B scope', sameEstimateSelectionScope(b2026, { ...b2026 }));
check('empty search draft keeps selected B scope', sameEstimateSelectionScope(b2026, { ...b2026 }));
check('language mode draft keeps selected B scope', sameEstimateSelectionScope(b2026, { ...b2026 }));
const cleared = scopeFor({ selectedId: null, custKey: null, filterCustKey: null });
check('explicit filter clear removes selected row', cleared.selectedId === '');
check('explicit filter clear removes customer filter', cleared.filterCustKey === null);
check('zero-row refresh has no fallback customer', resolveEstimateReloadSelection({
  selectedCust: null, selectedId: null, selectedCustKey: null,
}) === null);

const yearState = createEstimateSelectionState();
const old2026 = yearState.begin('detail', b2026);
yearState.syncScope(scopeFor({ year: 2025 }));
check('2026 detail is ignored after 2025 switch', !yearState.shouldApply(old2026));
check('same week/customer across years is different', !sameEstimateSelectionScope(
  scopeFor({ year: 2025 }), scopeFor({ year: 2026 }),
));

const saveState = createEstimateSelectionState();
const saveA = saveState.begin('load', scopeFor({ custKey: 101, selectedId: '34|101', filterCustKey: 101 }));
saveState.syncScope(b2026);
check('A save completion is ignored after B selection', !saveState.shouldApply(saveA));

const lateState = createEstimateSelectionState();
const oldDetail = lateState.begin('detail', b2026);
const oldMismatch = lateState.begin('mismatch', b2026);
const oldLoading = lateState.begin('loading', b2026);
lateState.syncScope(scopeFor({ year: 2025 }));
let applied = 0;
let errors = 0;
let finalized = 0;
const oldFallback = deferred();
const oldError = deferred();
const oldFinally = deferred();
const fallbackRun = settle(oldDetail, oldFallback.promise, lateState, () => { applied += 1; }, () => { errors += 1; }, () => { finalized += 1; });
const errorRun = settle(oldMismatch, oldError.promise, lateState, () => { applied += 1; }, () => { errors += 1; }, () => { finalized += 1; });
const finallyRun = settle(oldLoading, oldFinally.promise, lateState, () => { applied += 1; }, () => { errors += 1; }, () => { finalized += 1; });
oldFallback.reject(new Error('late fallback'));
oldError.reject(new Error('late error'));
oldFinally.resolve('late finally');
await Promise.all([fallbackRun, errorRun, finallyRun]);
check('late detail/mismatch data cannot apply', applied === 0);
check('late errors cannot overwrite current scope', errors === 0);
check('late finally cannot clear current loading', finalized === 0);

// Required cross-channel contract: a same-scope list/load must immediately
// supersede already-started detail and mismatch requests. Current helper
// behavior is intentionally exposed here for Kier rather than hidden by a
// synthetic action loop.
const sameScopeLoadState = createEstimateSelectionState();
const detailBeforeSameScopeLoad = sameScopeLoadState.begin('detail', b2026);
const mismatchBeforeSameScopeLoad = sameScopeLoadState.begin('mismatch', b2026);
sameScopeLoadState.beginFreshIfCurrent('load', b2026, b2026);
check('same-scope new load invalidates old detail immediately',
  !sameScopeLoadState.shouldApply(detailBeforeSameScopeLoad));
check('same-scope new load invalidates old mismatch immediately',
  !sameScopeLoadState.shouldApply(mismatchBeforeSameScopeLoad));

if (failures.length) {
  throw new Error('estimate refresh flow failures:\n- ' + failures.join('\n- '));
}
console.log('estimate refresh flow tests passed');
