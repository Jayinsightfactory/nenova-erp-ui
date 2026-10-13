import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  buildAppliedStockCopy,
  buildAppliedStockScope,
} from '../lib/pasteAppliedStockCopy.js';

const lines = Array(51).fill('');
lines[9] = 'Hydrangea Albari Kogane 5박스';
lines[22] = '믹스박스 2박스';
lines[36] = '믹스박스 3박스';
lines[42] = '연핑크 4박스';
lines[50] = '두바이 6박스';

const baseText = lines.join('\n');
const pasteText = 'Hydrangea Albari Kogane 1박스 추가';
const week = '2026-41-02';
const baseWeek = '2026-41-01';
const products = [
  {ProdKey: 101, ProdName: 'Mix Box Rose'},
  {ProdKey: 102, ProdName: 'Mix Box Tulip'},
  {ProdKey: 103, ProdName: 'Hydrangea Pink'},
  {ProdKey: 104, ProdName: 'Alstroemeria Dubai'},
  {ProdKey: 105, ProdName: 'Hydrangea Albari Kogane'},
  {ProdKey: 106, ProdName: 'Other Albari'},
];
const match = (idx, name, qty, prodKey) => ({
  idx, name, matchName: name, flowerContext: '', qty, unit: '박스', prodKey,
});

const correctedMatches = [
  match(9, 'Hydrangea Albari Kogane', 5, 105),
  match(22, '믹스박스', 2, 101),
  match(36, '믹스박스', 3, 102),
  match(42, '연핑크', 4, 103),
  match(50, '두바이', 6, 104),
];
const staleDraftMatches = [
  match(9, 'Hydrangea Albari Kogane', 5, 106),
  match(22, '믹스박스', 2, 101),
  match(36, '믹스박스', 3, 101),
  match(42, '연핑크', 4, 103),
  match(50, '두바이', 6, 103),
];

const scopeFor = matches => buildAppliedStockScope({
  week, baseText, pasteText, baseWeek, matches,
});
const correctedScope = scopeFor(correctedMatches);
const staleScope = scopeFor(staleDraftMatches);
const resultFor = scope => ({
  orderId: 'ALL',
  verified: true,
  okCount: 1,
  failCount: 0,
  stockCopyScope: scope,
  details: [{
    entryId: 'albari-add', ok: true, verified: true, type: 'ADD',
    orderYear: '2026', orderWeek: '41-02', custKey: 1, prodKey: 105,
    inputName: 'Hydrangea Albari Kogane', qty: 1, unit: '박스',
    outQtyBefore: 0, outQtyAfter: 1,
  }],
});
const copyWith = ({matches, resultScope, currentScope = resultScope}) => buildAppliedStockCopy({
  baseText,
  pasteText,
  week,
  products,
  baseStockMatches: matches,
  result: resultFor(resultScope),
  currentScope,
});

// Reproduce the exact warning combination reported from a coherent old draft.
// This is evidence for the stale source contents; the corrected page must never
// inject these rows into a result authorized by correctedScope.
const reported = copyWith({matches: staleDraftMatches, resultScope: staleScope});
assert.equal(reported.ready, false);
assert(reported.warnings.includes('23줄 믹스박스 / 37줄 믹스박스: 기초재고에 같은 전산 품목이 중복되어 있습니다.'));
assert(reported.warnings.includes('43줄 연핑크 / 51줄 두바이: 기초재고에 같은 전산 품목이 중복되어 있습니다.'));
assert(reported.warnings.includes('Hydrangea Albari Kogane: 기초재고에 없는 처리 품목입니다.'));

const current = copyWith({matches: correctedMatches, resultScope: correctedScope});
assert.equal(current.ready, true, current.warnings.join(' '));
assert.equal(current.changeRows.find(row => row.prodKey === 105)?.applied.main, 4);

const injectedStale = copyWith({
  matches: staleDraftMatches,
  resultScope: correctedScope,
  currentScope: correctedScope,
});
assert.equal(injectedStale.ready, false, 'a stale draft source cannot be paired with the corrected current scope');
assert(injectedStale.warnings.some(warning => /매칭|일치/.test(warning)));

const genuineDuplicateScope = scopeFor(staleDraftMatches);
const genuineDuplicate = copyWith({
  matches: staleDraftMatches,
  resultScope: genuineDuplicateScope,
  currentScope: genuineDuplicateScope,
});
assert(genuineDuplicate.warnings.some(warning => warning.includes('23줄 믹스박스 / 37줄 믹스박스')),
  'a duplicate in the currently authorized source must remain blocked');

const withoutAlbari = correctedMatches.filter(row => row.prodKey !== 105);
const genuineMissingScope = scopeFor(withoutAlbari);
const genuineMissing = copyWith({
  matches: withoutAlbari,
  resultScope: genuineMissingScope,
  currentScope: genuineMissingScope,
});
assert(genuineMissing.warnings.some(warning => warning.includes('Hydrangea Albari Kogane: 기초재고에 없는 처리 품목입니다.')),
  'a genuinely missing processed product must remain blocked');

const changedAfterCommit = correctedMatches.map((row, index) => index === 0 ? {...row, prodKey: 106} : row);
const changedScope = scopeFor(changedAfterCommit);
const postCommitChange = copyWith({
  matches: changedAfterCommit,
  resultScope: correctedScope,
  currentScope: changedScope,
});
assert.equal(postCommitChange.ready, false, 'manual changes after commit require a newly authorized result scope');
assert(postCommitChange.warnings.some(warning => warning.includes('현재 기초재고')));

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.match(page, /<AppliedStockCopyPanel\s+source=\{\{/,
  'the page must pass the current source directly instead of a cached stock draft');
assert.doesNotMatch(page, /buildAppliedStockCopy\(\{\.\.\.draft\?\.appliedCopySource/,
  'the applied-stock panel must not calculate from cached draft source');
assert.match(page, /baseStockMatchesRef\.current/,
  'deferred rematching must read the latest row choices at callback execution');

// Execute the real nested page handlers and effect body. A 350ms rematch that
// was scheduled before a manual choice must observe the bumped revision and do
// nothing; it must not rebuild from the render's former row array.
const rematchStart = page.indexOf('  const rematchBaseStock =');
const rematchEnd = page.indexOf('  const handleBaseStockTextChange =', rematchStart);
const applyStart = page.indexOf('  const applyBaseStockProduct =', rematchEnd);
const applyEnd = page.indexOf('  const selectStockBaseWeek =', applyStart);
const copyDraftStart = page.indexOf('  const copyStockDraft =', applyEnd);
const effectStart = page.indexOf('  useEffect(() => {', copyDraftStart);
const effectEnd = page.indexOf('  const handleParse =', effectStart);
assert([rematchStart, rematchEnd, applyStart, applyEnd, effectStart, effectEnd].every(index => index >= 0),
  'actual page rematch/manual/effect functions must remain extractable');

const scheduled = [];
const refreshes = [];
const timerContext = vm.createContext({
  baseStockText: '믹스박스 2박스',
  baseStockExcludedLines: [],
  allProducts: products,
  baseStockMatchesRef: {current: [match(0, '믹스박스', 2, 101)]},
  baseStockRematchRevisionRef: {current: 0},
  mappingCache: {},
  pasteText,
  week,
  remainStockText: '',
  stockBaseWeek: baseWeek,
  orders: [],
  rematchCalls: 0,
  loadCache: () => ({}),
  buildBaseStockMatchRows: (_text, _products, _cache, previous) => {
    timerContext.rematchCalls += 1;
    return previous;
  },
  setBaseStockMatches: value => { timerContext.renderedMatches = value; },
  refreshStockDraft: (...args) => refreshes.push(args),
  setStockCopied: () => {},
  setBaseStockMatchEditIdx: () => {},
  learnItemMapping: () => Promise.resolve(),
  setTimeout: callback => { scheduled.push(callback); return scheduled.length; },
  clearTimeout: () => {},
  useEffect: callback => callback(),
});
vm.runInContext(page.slice(rematchStart, rematchEnd) + page.slice(applyStart, applyEnd), timerContext);
vm.runInContext(page.slice(effectStart, effectEnd), timerContext);
assert.equal(scheduled.length, 1, 'base text change schedules one deferred rematch');
timerContext.manualProduct = products.find(product => product.ProdKey === 102);
vm.runInContext('applyBaseStockProduct(0, manualProduct, false)', timerContext);
assert.equal(timerContext.baseStockMatchesRef.current[0].prodKey, 102);
scheduled[0]();
assert.equal(timerContext.rematchCalls, 0, 'the older 350ms callback is cancelled by the manual-choice revision');
assert.equal(timerContext.baseStockMatchesRef.current[0].prodKey, 102, 'the pending callback cannot restore the old product');
assert.equal(refreshes.at(-1)[6][0].prodKey, 102, 'manual choice refreshes the draft from the same current row array');

console.log('applied stock current source: reported stale warnings reproduced, current source authorized, stale injection and unsafe current data blocked');
