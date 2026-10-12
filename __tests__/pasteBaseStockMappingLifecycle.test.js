import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {textWithoutExcludedLines} from '../lib/pasteExcludeText.js';
import {resolveCachedProductMapping, isMixBoxMismatch} from '../lib/pasteLocalMapping.js';
import {getDisplayName, scoreMatch} from '../lib/displayName.js';
import {normalizeOrderUnit} from '../lib/orderUtils.js';
import {
  previousBaseStockMatches,
  confirmedBaseStockMatch,
  combinePickedBaseStockInput,
} from '../lib/pasteBaseStockMapping.js';
import {
  chooseStockProductCandidate,
  formatStockDelta,
  formatStockVector,
  isBaseStockHeaderLine,
  parseBaseStockQuantityLine,
  resolveStockProjectionIdentity,
  summarizeStockProjection,
} from '../lib/pasteStockProjection.js';
import {buildAppliedStockCopy, buildAppliedStockScope} from '../lib/pasteAppliedStockCopy.js';

const require = createRequire(import.meta.url);
const {savePasteWorkspace, loadPasteWorkspace} = require('../lib/pasteWorkspace.js');

const pageSource = fs.readFileSync('pages/orders/paste.js', 'utf8');
const prefix = pageSource
  .slice(0, pageSource.indexOf('export default function'))
  .replace(/^import .*\r?\n/gm, '');
const context = vm.createContext({
  console,
  textWithoutExcludedLines,
  resolveCachedProductMapping,
  isMixBoxMismatch,
  getDisplayName,
  scoreMatch,
  normalizeOrderUnit,
  previousBaseStockMatches,
  confirmedBaseStockMatch,
  combinePickedBaseStockInput,
  chooseStockProductCandidate,
  formatStockDelta,
  formatStockVector,
  isBaseStockHeaderLine,
  parseBaseStockQuantityLine,
  resolveStockProjectionIdentity,
  summarizeStockProjection,
  localStorage: {getItem: () => null, setItem: () => {}},
});
vm.runInContext(prefix, context);
const plain = value => JSON.parse(JSON.stringify(value));

const products = [
  {ProdKey: 101, ProdName: 'Ruscus Rosewood', DisplayName: 'Ruscus Rosewood', CounName: '이스라엘', FlowerName: '루스커스'},
  {ProdKey: 202, ProdName: 'Rose Rosewood', DisplayName: 'Rose Rosewood', CounName: '콜롬비아', FlowerName: '장미'},
];
const baseText = '기초재고\n루스커스\n로즈우드 2박스\nㅡㅡㅡㅡ\n장미\n로즈우드 3박스';
context.baseText = baseText;
context.products = products;

const parsed = vm.runInContext('parseBaseStockText(baseText)', context);
assert.deepEqual(plain(parsed.rows.map(row => [row.idx, row.name, row.matchName])), [
  [2, '로즈우드', '루스커스 로즈우드'],
  [5, '로즈우드', '장미 로즈우드'],
]);

// This is the user correction that the old stockNorm(name) object collapsed to
// the last row. The two source labels are deliberately identical.
const corrected = parsed.rows.map((row, index) => ({
  ...row,
  prodKey: products[index].ProdKey,
  prodName: products[index].ProdName,
  displayName: products[index].DisplayName,
  matchStatus: 'manual',
}));
context.baseStockMatches = corrected;
context.baseStockText = baseText;
context.pasteText = '루스커스 로즈우드 1박스 추가\n장미 로즈우드 1박스 추가';
context.remainStockText = '';
context.pasteExcludedLines = [];
context.baseStockExcludedLines = [];
context.savedStockNote = null;
context.week = '2026-41-02';

// Exercise the real favorite payload builder, then cross the JSON persistence
// boundary before rebuilding the page rows.
const payloadStart = pageSource.indexOf('  const buildStockNotePayload =');
const payloadEnd = pageSource.indexOf('  const stockNoteName =', payloadStart);
vm.runInContext(pageSource.slice(payloadStart, payloadEnd), context);
const saved = JSON.parse(JSON.stringify(vm.runInContext('buildStockNotePayload("2026-41-01")', context)));
assert.deepEqual(saved.baseStockMatches.map(row => [row.idx, row.prodKey]), [[2, 101], [5, 202]]);

// Exercise the actual workspace serializer too. It must retain row-specific
// matches without turning the two equal source names into one alias choice.
const workspaceData = new Map();
const workspaceStorage = {
  getItem: key => workspaceData.get(key) ?? null,
  setItem: (key, value) => workspaceData.set(key, String(value)),
};
savePasteWorkspace(workspaceStorage, {
  actorId: 'mapping-review',
  week: '2026-41-02',
  state: {
    pasteText: context.pasteText,
    orders: [],
    baseStockText: baseText,
    baseStockMatches: saved.baseStockMatches,
    baseStockExcludedLines: [],
  },
});
const restoredWorkspace = loadPasteWorkspace(workspaceStorage, {
  actorId: 'mapping-review',
  week: '2026-41-02',
});
assert.deepEqual(restoredWorkspace.state.baseStockMatches.map(row => [row.idx, row.prodKey]), [[2, 101], [5, 202]],
  'workspace save/load retains both corrected same-name rows');

context.savedMatches = restoredWorkspace.state.baseStockMatches;
const restored = vm.runInContext('buildBaseStockMatchRows(baseText, products, {}, savedMatches, [])', context);
assert.deepEqual(plain(restored.map(row => [row.idx, row.name, row.prodKey, row.matchStatus])), [
  [2, '로즈우드', 101, 'manual'],
  [5, '로즈우드', 202, 'manual'],
], 'favorite JSON restore and rematch retain each corrected source-row choice');

context.changedBaseText = baseText.replace('로즈우드 2박스', '로즈우드 4박스');
context.restoredMatches = restored;
const quantityEdited = vm.runInContext(
  'buildBaseStockMatchRows(changedBaseText, products, {}, restoredMatches, [])',
  context,
);
assert.deepEqual(plain(quantityEdited.map(row => [row.qty, row.prodKey])), [[4, 101], [3, 202]],
  'a quantity edit updates the row quantity without discarding its manual product');

// Exercise the real favorite load function and assert the corrected argument
// positions that previously sent exclusion arrays as orders/matches.
const loadStart = pageSource.indexOf('  const loadStockNote =');
const loadEnd = pageSource.indexOf('  // 시작재고 여러 개', loadStart);
const refreshCalls = [];
Object.assign(context, {
  allProducts: products,
  mappingCache: {},
  parseStockNoteFavorite: favorite => ({...favorite, data: JSON.parse(favorite.FilterData || '{}')}),
  apiGet: async () => ({favorites: [{FavoriteKey: 77, FilterData: JSON.stringify(saved)}]}),
  setStockNoteLoading: () => {},
  setSavedStockNote: () => {},
  setPasteText: () => {},
  setBaseStockText: () => {},
  setRemainStockText: () => {},
  setPasteExcludedLines: () => {},
  setBaseStockExcludedLines: () => {},
  selectStockBaseWeek: () => {},
  setBaseStockMatches: rows => { context.loadedMatches = rows; },
  setOrders: () => {},
  setParseError: () => {},
  setQueueIdx: () => {},
  setStockDraft: () => {},
  setStockNoteStatus: () => {},
  setPendingParseAfterLoad: () => {},
  refreshStockDraft: (...args) => refreshCalls.push(args),
  formatWeekDisplay: value => value,
});
vm.runInContext(pageSource.slice(loadStart, loadEnd), context);
await vm.runInContext('loadStockNote("2026-41-01", {apply: true})', context);
assert.deepEqual(plain(context.loadedMatches.map(row => row.prodKey)), [101, 202]);
assert.equal(refreshCalls.length, 1);
assert.deepEqual(plain(refreshCalls[0][5]), [], 'favorite restore clears analysis orders instead of passing exclusions as orders');
assert.deepEqual(plain(refreshCalls[0][6].map(row => row.prodKey)), [101, 202], 'rebuilt row matches occupy the match argument');
assert.deepEqual(plain(refreshCalls[0][7]), {pasteExcludedLineNos: [], baseExcludedLineNos: []});

// Projection consumes the order item's confirmed ProdKey, so the two identical
// input labels do not meet again through the lossy Rosewood/Ruscus alias map.
context.draftArgs = {
  text: context.pasteText,
  baseText,
  remainText: '',
  selectedWeek: '2026-41-02',
  stockBaseWeek: '2026-41-01',
  products,
  resolvedMatches: vm.runInContext('buildResolvedMatchMap([], products, loadedMatches)', context),
  analysisOrders: [{
    id: 'same-name-order',
    custMatch: {CustName: '테스트'},
    items: [
      {idx: 0, inputName: '로즈우드', prodKey: 101, qty: 1, unit: '박스', action: '추가'},
      {idx: 1, inputName: '로즈우드', prodKey: 202, qty: 1, unit: '박스', action: '추가'},
    ],
  }],
  baseStockMatches: context.loadedMatches,
  pasteExcludedLineNos: [],
  baseExcludedLineNos: [],
};
const draft = vm.runInContext('buildKakaoStockDraft(draftArgs)', context);
assert.deepEqual(plain(draft.historyRows.map(row => [row.identityKey, row.baseStart, row.calcRemain])), [
  ['prod:101', 2, 1],
  ['prod:202', 3, 2],
], 'projection applies each same-name order row to its own confirmed product');
assert.equal(draft.confirmRows.some(row => /기초재고 없음|품목 매칭/.test(row)), false);

const copyScope = buildAppliedStockScope({
  week: '2026-41-02',
  baseText,
  pasteText: context.pasteText,
  baseWeek: '2026-41-01',
  matches: context.loadedMatches,
});
const result = {
  orderId: 'ALL', verified: true, okCount: 2, failCount: 0, stockCopyScope: copyScope,
  details: [
    {entryId: 'a', ok: true, verified: true, type: 'ADD', orderYear: '2026', orderWeek: '41-02', prodKey: 101, custKey: 1, qty: 1, unit: '박스', outQtyBefore: 0, outQtyAfter: 1},
    {entryId: 'b', ok: true, verified: true, type: 'ADD', orderYear: '2026', orderWeek: '41-02', prodKey: 202, custKey: 1, qty: 1, unit: '박스', outQtyBefore: 0, outQtyAfter: 1},
  ],
};
const copy = buildAppliedStockCopy({
  ...draft.appliedCopySource,
  result,
  currentScope: copyScope,
});
assert.equal(copy.ready, true, copy.warnings.join(' '));
assert.deepEqual(copy.changeRows.map(row => [row.prodKey, row.name, row.applied.main]), [
  [202, '로즈우드', 2],
  [101, '로즈우드', 1],
], 'copy retains both same-name rows and subtracts from their distinct products');
assert.equal((copy.text.match(/로즈우드/g) || []).length, 2);

console.log('base stock mapping lifecycle: manual correction, favorite save/load, rematch, projection and copy passed');
