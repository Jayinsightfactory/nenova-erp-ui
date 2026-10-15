import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseBaseStockQuantityLine,isBaseStockHeaderLine} from '../lib/pasteStockProjection.js';
import {previousBaseStockMatches,confirmedBaseStockMatch,combinePickedBaseStockInput} from '../lib/pasteBaseStockMapping.js';
import {textWithoutExcludedLines} from '../lib/pasteExcludeText.js';
import {buildStockNoteChangeEntry} from '../lib/pasteStockNote.js';

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
const prefix = page.slice(0, page.indexOf('export default function')).replace(/^import .*\r?\n/gm, '');
const invokingButton={name:'stock-note-save'};
const context = vm.createContext({document:{activeElement:invokingButton},parseBaseStockQuantityLine,isBaseStockHeaderLine,previousBaseStockMatches,confirmedBaseStockMatch,combinePickedBaseStockInput, textWithoutExcludedLines, buildStockNoteChangeEntry, formatWeekDisplay: value => value});
vm.runInContext(prefix, context);
const products = [{ProdKey: 11, ProdName: 'Novia'}, {ProdKey: 22, ProdName: 'Blue'}];
const text = '카네이션\n노비아 0박스\n블루 1+15스팀';
const parsed = context.parseBaseStockText(text);
const matched = parsed.rows.map((row, idx) => ({...row, prodKey: products[idx].ProdKey, prodName: products[idx].ProdName}));
assert.equal(context.stockNoteMatchReview(text, [], matched, products).ready, true, 'zero and mixed quantities are valid');
assert.equal(context.parseBaseStockText('2026-41-01\n노비아 2').rows.length, 1, 'full-year week header is not a stock row');
const unitless = context.parseBaseStockText('노비아 2').rows[0];
assert.equal(context.stockNoteMatchReview('노비아 2', [], [{...unitless, unit: '박스', prodKey: 11}], products).ready, true, 'saved inferred unit is retained for source without explicit unit');
assert.equal(context.stockNoteMatchReview(text, [], matched.slice(0, 1), products).ready, false, 'missing row never passes 100% gate');
assert.equal(context.stockNoteMatchReview(text, [], matched.map(row => ({...row, prodKey: 999})), products).ready, false, 'removed product blocks save');
assert.equal(context.stockNoteMatchReview(text, [], matched.map(row => ({...row, qty: 9})), products).ready, false, 'stale quantities block save');
const invalid = text + '\n화이트 수량확인';
assert.equal(context.stockNoteMatchReview(invalid, [], matched, products).ready, false, 'silently unparsed line must block');
assert.equal(context.stockNoteMatchReview(invalid, [3], matched, products).ready, true, 'explicit line exclusion permits save');
assert.equal(context.stockNoteMatchReview('노비아 -1', [], [{...context.parseBaseStockText('노비아 -1').rows[0], prodKey: 11}], products).ready, false, 'negative stock quantity blocks save');
const input = {baseStockText: text, baseWeek: '2026-41-01', week: '2026-41-02', baseStockExcludedLines: [], pasteText: '', pasteExcludedLines: [], remainStockText: ''};
assert.notEqual(context.stockNoteSaveFingerprint(input), context.stockNoteSaveFingerprint({...input, baseWeek: '2025-41-01'}), 'cross-year pending intent is distinct');
assert.notEqual(context.stockNoteSaveFingerprint(input), context.stockNoteSaveFingerprint({...input, baseStockExcludedLines: [1]}), 'exclusion change invalidates intent');

let writes = 0, reads = 0, failRead = false, favorites = [];
Object.assign(context, {
  baseStockText: text, baseStockExcludedLines: [], pasteText: '', pasteExcludedLines: [], remainStockText: '',
  stockBaseWeek: '2026-41-01', week: '2026-41-02', allProducts: products, productCatalogReady: products.length > 0, baseStockMatches: matched.slice(0, 1),
  savedStockNote: null, stockNoteReview: null, stockNoteSaving: false, orders: [],
  stockNoteReviewAttemptRef: {current: false}, stockNoteCurrentFingerprintRef: {current: ''}, stockNoteWriteReceiptRef: {current: null},
  alert: value => {throw Error(value);}, setStockNoteSaving: value => {context.stockNoteSaving = value;},
  setStockNoteReview: value => {context.stockNoteReview = typeof value === 'function' ? value(context.stockNoteReview) : value;},
  setSavedStockNote: value => {context.savedStockNote = value;}, setStockNoteStatus: value => {context.notice = value;},
  setBaseStockMatchEditIdx: () => {}, rematchBaseStock: () => {}, refreshStockDraft: () => {},
  apiPost: async (url, data) => {assert.equal(url, '/api/favorites'); writes++; const favorite = {FavoriteKey: writes, FilterData: data.filterData}; favorites.push(favorite); return {favoriteKey: writes};},
  apiPut: async () => {throw Error('unexpected overwrite');},
  apiGet: async url => {assert.equal(url, '/api/favorites'); reads++; if (failRead) throw Error('offline'); return {favorites};},
  setTimeout: callback => {context.timer = callback; return 1;}, clearTimeout: () => {context.timer = null;}, useEffect: callback => {context.effect = callback;},
});
const payloadStart = page.indexOf('  const buildStockNotePayload =');
const persistEnd = page.indexOf('  const currentStockNoteFingerprint =', payloadStart);
vm.runInContext(page.slice(payloadStart, persistEnd), context);
const saveStart = page.indexOf('  const saveStockNote =', persistEnd);
const effectStart = page.indexOf('  useEffect(() => {', saveStart);
vm.runInContext(page.slice(saveStart, effectStart), context);
const effectEnd = page.indexOf('  const deleteStockNote =', effectStart);
const effectSource = page.slice(effectStart, effectEnd);
function render() {
  context.currentStockNoteFingerprint = context.stockNoteSaveFingerprint({baseStockText: context.baseStockText, baseWeek: context.stockBaseWeek || context.week, week: context.week, baseStockExcludedLines: context.baseStockExcludedLines, pasteText: context.pasteText, pasteExcludedLines: context.pasteExcludedLines, remainStockText: context.remainStockText});
  context.stockNoteCurrentFingerprintRef.current = context.currentStockNoteFingerprint;
  context.stockNoteReviewProgress = context.stockNoteMatchReview(context.baseStockText, context.baseStockExcludedLines, context.baseStockMatches, products);
  vm.runInContext(effectSource, context);
  return context.effect();
}
render();
vm.runInContext('saveStockNote({forceCreate: true})', context);
assert.equal(context.stockNoteReview.forceCreate, true);
assert.equal(context.stockNoteReview.returnFocus,invokingButton,'capture invoking control before child autofocus mounts');
assert.equal(writes, 0, 'click opens review without favorites mutation');
render(); assert.equal(context.timer, undefined, 'partial mapping does not schedule save');
context.setStockNoteReview(null); render(); assert.equal(writes, 0, 'cancel writes nothing');
vm.runInContext('saveStockNote({forceCreate: true})', context);
context.baseStockMatches = matched; render(); assert.equal(typeof context.timer, 'function', '100% mapping schedules one save after paint');
context.stockBaseWeek = '2025-41-01'; render(); assert.equal(context.stockNoteReview, null, 'scope changes cancel pending intent');
assert.equal(writes, 0);
await vm.runInContext('persistStockNote({forceCreate:true,fingerprint:"stale"})', context);
assert.equal(writes, 0, 'transaction rechecks stale fingerprint');
context.stockBaseWeek = '2026-41-01'; render();
vm.runInContext('saveStockNote({forceCreate: true})', context); render();
failRead = true;
context.timer();
await new Promise(resolve => setImmediate(resolve));
render();
assert.equal(context.stockNoteReviewAttemptRef.current, true, 'automatic ready save is attempted once');
assert.equal(writes, 1); assert.match(context.stockNoteReview.error, /offline/);
assert.equal(context.baseStockMatches.length, 2, 'failed save retains every mapping');
failRead = false;
await vm.runInContext('persistStockNote({forceCreate:true,fingerprint:stockNoteReview.fingerprint})', context);
assert.equal(writes, 1, 'readback retry verifies receipt without duplicate create');
assert.equal(context.stockNoteReview, null);
const data = JSON.parse(favorites[0].FilterData);
assert.equal(data.baseStockMatches.length, 2, 'saved snapshot includes all mapped items');
assert.equal(data.baseStockText, text); assert.equal(data.baseWeek, '2026-41-01'); assert.equal(reads, 2);
console.log('stock note review: full coverage, zero/mixed/invalid, stale scope, cancel, matching gate, retained failures and receipt retry passed');
