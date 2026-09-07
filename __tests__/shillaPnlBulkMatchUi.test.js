const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
function compile(filename, mocks = {}) {
  const code = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = loaded.require.bind(loaded); loaded.require = request => (Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : nativeRequire(request)); loaded._compile(code, filename); return loaded.exports;
}
const search = compile(path.join(root, 'lib/shillaPnlSearch.js'));
const modal = compile(path.join(root, 'components/raum/ShillaBulkMatchModal.js'), { '../../lib/raumPnlHttp': { fetchRaumPnlJson: async () => ({ success: true, scope: { partnerCode: 'shilla', orderYear: '2026' }, groups: [], ungroupedCount: 2 }) }, '../../lib/shillaPnlSearch': search });
const groups = [
  { groupKey: 'shimmer', label: '장미 · 쉬머', unit: '단', majors: [35, 30], memberCount: 2, unmatchedCount: 1, suggestion: { status: 'unique', product: { prodKey: 2079, prodName: 'Rose Shimmer' } }, expected: { members: [{ itemKey: 1, prodKey: null }, { itemKey: 2, prodKey: 2079 }] } },
  { groupKey: 'conflict', label: '장미 · 화이트', unit: '단', majors: [35], memberCount: 2, unmatchedCount: 1, suggestion: { status: 'conflict' }, expected: { members: [] } },
  { groupKey: 'lily', label: '백합 · 화이트', unit: '단-5스팀', majors: [35], memberCount: 1, unmatchedCount: 1, suggestion: { status: 'none' }, expected: { members: [{ itemKey: 3, prodKey: null }] } },
];
const drafts = { shimmer: { prodKey: 2079, selected: true }, conflict: { prodKey: 3000, selected: true }, lily: { prodKey: 3170, selected: true } };
assert.deepEqual(modal.buildShillaBulkMatchPayload('2026', groups, drafts), { partnerCode: 'shilla', orderYear: '2026', action: 'MATCH_SELECTED_GROUPS', confirmed: true, groups: [{ groupKey: 'shimmer', prodKey: 2079, expected: groups[0].expected }, { groupKey: 'lily', prodKey: 3170, expected: groups[2].expected }] }, 'eligible checked groups create exactly one bulk payload and forward expected unchanged');
assert.deepEqual(modal.shillaBulkSelection(groups, drafts).majors, [35, 30]);
assert.equal(modal.shillaBulkSelection(groups, drafts).itemCount, 2, 'pending count excludes a conflict group');
assert.ok(modal.shillaBulkMatchPayloadBytes(modal.buildShillaBulkMatchPayload('2026', groups, drafts)) < 900 * 1024, 'ordinary selected groups remain below the nginx UI guard');
const oversizedPayload = { partnerCode: 'shilla', orderYear: '2026', action: 'MATCH_SELECTED_GROUPS', confirmed: true, groups: [{ groupKey: 'large', prodKey: 2079, expected: { members: Array.from({ length: 1100 }, (_, index) => ({ pnlKey: index + 1, itemKey: index + 1, name: '장미 · 쉬머 '.repeat(110), unit: '단', qty: 16, salePrice: 10800, saleAmount: 172800, prodKey: null, isCustom: false })) } }] };
assert.ok(modal.shillaBulkMatchPayloadBytes(oversizedPayload) > 900 * 1024, 'a realistic large source-row snapshot exceeds the nginx UI guard before POST');
const koreanUnderBound = { ...oversizedPayload, groups: [{ ...oversizedPayload.groups[0], expected: { members: [{ itemKey: 1, name: '한'.repeat(250000), unit: '단', qty: 1, salePrice: 1, saleAmount: 1, prodKey: null, isCustom: false }] } }] };
const koreanOverBound = { ...koreanUnderBound, groups: [{ ...koreanUnderBound.groups[0], expected: { members: [{ ...koreanUnderBound.groups[0].expected.members[0], name: '한'.repeat(310000) }] } }] };
assert.ok(modal.shillaBulkMatchPayloadBytes(koreanUnderBound) < 900 * 1024, 'Korean UTF-8 payload below the bound remains sendable');
assert.ok(modal.shillaBulkMatchPayloadBytes(koreanOverBound) > 900 * 1024, 'Korean UTF-8 payload over the bound is measured by bytes, not characters');
let sends = 0; const beforeDrafts = JSON.stringify(drafts);
const blocked = modal.submitShillaBulkMatchPayload(koreanOverBound, async () => { sends += 1; });
assert.equal(blocked.sent, false); assert.equal(sends, 0, 'overbound payload never invokes fetch'); assert.equal(blocked.payload, koreanOverBound); assert.equal(JSON.stringify(drafts), beforeDrafts, 'blocked submission preserves pending draft selections');
let searches = 0; const composing = { key: 'Enter', isComposing: true, currentTarget: { value: '장미' }, preventDefault() { searches += 100; } };
assert.equal(search.runShillaPnlSearchEnter(composing, () => { searches += 1; }), false); assert.equal(searches, 0, 'IME composition does not trigger candidate search');
const searchRequest = { current: 4 }; let searching = true;
modal.invalidateShillaBulkSearch(searchRequest, value => { searching = value; });
assert.equal(searchRequest.current, 5); assert.equal(searching, false, 'typing or opening a new group invalidates a late search and immediately re-enables search controls');
const html = renderToStaticMarkup(React.createElement(modal.default, { orderYear: '2026', onSaved() {}, onClose() {}, onBusyChange() {} }));
assert.match(html, /신라호텔 2026년/); assert.match(html, /전산 품목 검색/); assert.match(html, /선택 적용 확인/); assert.doesNotMatch(html, /Layout/);
const source = fs.readFileSync(path.join(root, 'components/raum/ShillaBulkMatchModal.js'), 'utf8');
assert.match(source, /ungroupedCount/); assert.match(source, /품목명 또는 단위가 없어 묶지 못한/); assert.match(source, /묶지 못한 원본 행이 남아 있습니다/); assert.match(source, /900KB를 넘습니다/); assert.match(source, /submitShillaBulkMatchPayload/); assert.match(source, /다시 불러오기/); assert.match(source, /maxHeight: '60vh'/); assert.match(source, /position: 'sticky'/); assert.match(source, /<colgroup>/); assert.match(source, /aria-label=\{`\$\{group\.label\}/); assert.match(source, /counName \?\? product\.CounName/); assert.match(source, /savingRef\.current/); assert.match(source, /\/api\/raum\/shilla-bulk-mapping/); assert.doesNotMatch(source, /\/api\/raum\/shilla-item-mapping/);
const pnl = fs.readFileSync(path.join(root, 'pages/raum/pnl.js'), 'utf8');
assert.match(pnl, /detail\?\.unsaved \|\| bulkPreview/); assert.match(pnl, /shillaBulkMatchOpen/); assert.match(pnl, /refreshAfterShillaBulkMatch/); assert.match(pnl, /ShillaBulkMatchModal/);
console.log('Shilla bulk unmatched UI tests passed');
