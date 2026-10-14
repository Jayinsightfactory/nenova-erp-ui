const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const babel = require('next/dist/compiled/babel/core');

const sourcePath = path.join(__dirname, '../components/import-tools/PackingResults.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../styles/ImportPacking.module.css'), 'utf8');
const code = babel.transformSync(source, {
  filename: sourcePath,
  presets: [require('next/dist/compiled/babel/preset-react')],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
  configFile: false,
  babelrc: false,
}).code;

const state = [];
let cursor = 0;
let effects = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  },
  useMemo: fn => { cursor++; return fn(); },
  useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
  useEffect(effect) { cursor++; effects.push(effect); },
};
const css = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
const moduleUnderTest = { exports: {} };
let packingMatchReview;
test.before(async () => { ({ packingMatchReview } = await import('../lib/packingMatchReview.js')); });
new Function('require', 'module', 'exports', code)(key => {
  if (key === 'react') return React;
  if (key === '../../styles/ImportPacking.module.css') return css;
  if (key === '../../lib/packingMatchReview') return { packingMatchReview: (...args) => packingMatchReview(...args) };
  throw new Error('Unexpected dependency: ' + key);
}, moduleUnderTest, moduleUnderTest.exports);

const PackingResults = moduleUnderTest.exports.default;
const { buildIssueSummary } = moduleUnderTest.exports;
const flatten = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';

function render(props) {
  cursor = 0;
  effects = [];
  return PackingResults(props);
}

test('renders every result row with optional China columns and stable smoke selectors', () => {
  state.length = 0;
  const products = Array.from({ length: 101 }, (_, index) => ({
    sourceName: `원문 ${index + 1}`,
    name: `매칭 ${index + 1}`,
    stemLength: index === 0 ? '60cm' : '',
    boxes: index === 0 ? 0 : 1,
    qty: index === 1 ? null : index,
    stems: index * 10,
    unitPrice: index === 0 ? 0 : 1.25,
    lineAmount: index === 0 ? 0 : 12.5,
    unmatched: index === 2,
    viaAlias: index === 3,
  }));
  const excel = {
    name: 'china.xlsx', label: 'China invoice', products,
    grossWeight: null, chargeableWeight: 0,
  };
  const matches = [];
  const tree = render({
    excels: [excel], country: 'CN', blocked: item => item === excel, onDownload() {},
    erpProducts: products.map((product, index) => ({ ProdKey: index + 1, ProdName: product.name, country: 'CN' })),
    onMatch: (...args) => matches.push(args),
  });
  const nodes = flatten(tree);

  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results')?.type, 'section');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-table')?.type, 'table');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-issues'), undefined, 'row issue cards are not duplicated beside the table');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-copy-open')?.type, 'button');
  assert.equal(nodes.filter(node => node.type === 'tr').length, 102, 'header plus all 101 product rows');
  for (const heading of ['원문품목', '길이', 'DB 매칭·확인사항', '박스', '단수', '송이', '단가', '금액']) {
    assert.ok(text(tree).includes(heading), `missing optional column ${heading}`);
  }
  const header = nodes.filter(node => node.type === 'th').map(text);
  assert.deepEqual(header, ['No.', '원문품목', '길이', 'DB 매칭·확인사항', '박스', '단수', '송이', '단가', '금액']);
  assert.ok(text(tree).includes('GW 미확인'));
  assert.ok(text(tree).includes('CW 0kg'));
  assert.ok(text(tree).includes('매칭 101'));
  assert.ok(text(tree).includes('—'), 'unknown values stay unknown instead of becoming zero');
  const download = nodes.find(node => node.type === 'button' && text(node).includes('다운로드 차단'));
  assert.equal(download.props.disabled, true, 'existing blocked callback owns the download gate');
  const matchButtons = nodes.filter(node => node.props?.['data-testid'] === 'packing-product-match');
  assert.equal(matchButtons.length, 101, 'every row owns one original-product match button');
  assert.equal(text(matchButtons[0]), '원문 1');
  assert.equal(matchButtons[0].props.title, '원문 1');
  assert.equal(matchButtons[0].props.disabled, false);
  matchButtons[0].props.onClick();
  assert.deepEqual(matches[0], [products[0], excel, 0]);
  assert.match(text(tree), /DB 미매칭/);
});

test('default review list, ALL toggle, summaries and callbacks preserve original full-array identity', () => {
  state.length = 0;
  const products = [
    { sourceName: 'EXACT', name: 'EXACT', qty: 10 },
    { sourceName: 'MANUAL SOURCE', name: 'MANUAL TARGET', qty: 20, viaAlias: true, erpMatch: { type: 'MANUAL', confirmed: true, prodKey: 2, sourceDescription: 'MANUAL SOURCE', matchedName: 'MANUAL TARGET' } },
    { sourceName: 'SIMILAR SOURCE', name: 'SIMILAR TARGET', qty: 30, score: 100, similarity: 1 },
    { sourceName: 'UNKNOWN', name: 'UNKNOWN', qty: 40, unmatched: true },
  ];
  const erpProducts = ['EXACT', 'MANUAL TARGET', 'SIMILAR TARGET'].map((ProdName, index) => ({ ProdKey: index + 1, ProdName, country: 'CN' }));
  const excel = { name: 'review.xlsx', products };
  const matches = [], downloads = [];
  const props = { excels: [excel], country: 'CN', erpProducts, blocked: () => false, onDownload: name => downloads.push(name), onMatch: (...args) => matches.push(args) };
  let tree = render(props);
  let nodes = flatten(tree);
  let buttons = nodes.filter(node => node.props?.['data-testid'] === 'packing-product-match');
  assert.deepEqual(buttons.map(text), ['SIMILAR SOURCE', 'UNKNOWN']);
  assert.match(text(tree), /정확 1 · 수동 1 · 유사 1 · 미매칭 1/);
  assert.match(text(tree), /단수 합계 100단/);
  assert.match(text(tree), /유사 매칭 · 확인 필요/);
  assert.doesNotMatch(text(tree), /100%|자동 매칭/);
  let focused = '';
  buttons[0].props.ref({ disabled: false, focus() { focused = 'SIMILAR SOURCE'; } });
  buttons[1].props.ref({ disabled: false, focus() { focused = 'UNKNOWN'; } });
  buttons[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(focused, 'UNKNOWN', 'arrow navigation skips hidden completed rows');
  buttons[0].props.onClick();
  assert.deepEqual(matches[0], [products[2], excel, 2]);
  nodes.find(node => node.type === 'button' && text(node).includes('⬇ 다운로드')).props.onClick();
  assert.deepEqual(downloads, ['review.xlsx']);
  assert.equal(buildIssueSummary([excel], 'CN', {}, false, erpProducts).issueCount, 2);
  nodes.find(node => node.props?.['data-testid'] === 'packing-results-view-toggle').props.onClick();
  tree = render(props); nodes = flatten(tree);
  buttons = nodes.filter(node => node.props?.['data-testid'] === 'packing-product-match');
  assert.equal(buttons.length, 4);
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-view-toggle').props['aria-pressed'], true);
  buttons[1].props.onClick(); assert.deepEqual(matches[1], [products[1], excel, 1]);
  nodes.find(node => node.props?.['data-testid'] === 'packing-results-view-toggle').props.onClick();
  assert.equal(flatten(render(props)).filter(node => node.props?.['data-testid'] === 'packing-product-match').length, 2);
});

test('successful parent rebuild removes a review row safely, failed/no rebuild retains it, and all-clear remains qualified', () => {
  state.length = 0;
  const excel = { name: 'focus.xlsx', products: [{ sourceName: 'A', name: 'TARGET', qty: 1 }, { sourceName: 'B', name: 'B', qty: 2, unmatched: true }] };
  const props = { excels: [excel], country: 'CN', erpProducts: [{ ProdKey: 1, ProdName: 'TARGET' }, { ProdKey: 2, ProdName: 'B' }], blocked: () => false, onDownload() {}, onMatch() {} };
  let tree = render(props);
  let buttons = flatten(tree).filter(node => node.props?.['data-testid'] === 'packing-product-match');
  let focused = '';
  buttons[1].props.ref({ disabled: false, focus() { focused = 'B'; } });
  buttons[0].props.onFocus(); buttons[0].props.onClick();
  assert.equal(flatten(render(props)).filter(node => node.props?.['data-testid'] === 'packing-product-match').length, 2, 'click alone never hides a row before save success');
  excel.products[0] = { ...excel.products[0], sourceName: 'TARGET' };
  const oldDocument = global.document;
  const body = {}; global.document = { body, activeElement: body };
  try {
    tree = render(props); effects.forEach(effect => effect());
    assert.equal(focused, 'B');
    buttons = flatten(tree).filter(node => node.props?.['data-testid'] === 'packing-product-match');
    assert.deepEqual(buttons.map(text), ['B']);
    excel.products[1] = { ...excel.products[1], unmatched: false };
    tree = render(props);
    assert.equal(flatten(tree).filter(node => node.props?.['data-testid'] === 'packing-product-match').length, 0);
    assert.match(text(tree), /품목 매칭 완료 \(수량·중량은 별도 확인\)/);
    assert.match(text(tree), /단수 합계 3단/);
  } finally { global.document = oldDocument; }
});

test('shows the explicit original and resolved database product in separate columns', () => {
  state.length = 0;
  const tree = render({
    excels: [{
      name: 'match.xlsx',
      products: [
        { sourceName: 'SAME', name: 'same', qty: 1 },
        { sourceName: 'SOURCE ONLY', matchingDescription: 'SOURCE ONLY 60', name: 'ERP TARGET', qty: 2 },
      ],
    }],
    country: 'CN', blocked: () => false, onDownload() {}, onMatch() {},
    erpProducts: [{ ProdKey: 1, ProdName: 'same', country: 'CN' }, { ProdKey: 2, ProdName: 'ERP TARGET', country: 'CN' }],
  });
  const rows = flatten(tree).filter(node => node.type === 'tr').slice(1);

  const rowCells = row => flatten(row).filter(node => node.type === 'td');
  assert.equal(text(rowCells(rows[0])[1]), 'SAME', 'source remains in the original column');
  assert.match(text(rowCells(rows[0]).find(node => node.props.className === 'matchCell')), /^same/, 'database name is rendered even when case-only equal');
  assert.equal(text(rowCells(rows[1])[1]), 'SOURCE ONLY', 'source remains in its own column');
  assert.match(text(rowCells(rows[1]).find(node => node.props.className === 'matchCell')), /ERP TARGET/, 'DB name comes from the resolved database product');
  assert.match(text(rows[1]), /ERP TARGET/);
  const buttons = flatten(tree).filter(node => node.props?.['data-testid'] === 'packing-product-match');
  assert.equal(buttons[1].props.title, 'SOURCE ONLY', 'sourceName remains the visible baseline');
});

test('DB-missing and similar-review status buttons invoke the existing match callback with the original row identity', () => {
  state.length = 0;
  const products = [
    { source_row: 10, sourceName: 'SIMILAR SOURCE', name: 'DB TARGET', qty: 1, matchScore: 0.91 },
    { source_row: 11, sourceName: 'UNMATCHED SOURCE', name: 'UNMATCHED SOURCE', unmatched: true, qty: 2 },
  ];
  const excel = { name: 'status-actions.xlsx', products };
  const calls = [];
  const tree = render({ excels: [excel], country: 'CN', erpProducts: [{ ProdKey: 7, ProdName: 'DB TARGET', country: 'CN' }],
    blocked: () => false, onDownload() {}, onMatch: (...args) => calls.push(args) });
  const nodes = flatten(tree);
  const statusActions = nodes.filter(node => node.props?.['data-testid'] === 'packing-result-status-match');
  assert.equal(statusActions.length, 2);
  assert.ok(statusActions.every(node => node.type === 'button'), 'status actions use native buttons');
  assert.match(text(statusActions[0]), /유사 매칭/);
  assert.equal(text(statusActions[1]), 'DB 미매칭');
  statusActions[0].props.onClick();
  statusActions[1].props.onClick();
  assert.deepEqual(calls, [[products[0], excel, 0], [products[1], excel, 1]]);

  const sourceButton = nodes.find(node => node.props?.['data-testid'] === 'packing-product-match');
  sourceButton.props.onClick();
  assert.deepEqual(calls[2], [products[0], excel, 0], 'the original source-name action remains available');
});

test('disables matching without a parent callback or while mapping is disabled', () => {
  state.length = 0;
  const excel = { name: 'disabled.xlsx', products: [{ sourceName: 'ROSE', name: 'ROSE', qty: 1 }] };
  const withoutCallback = render({ excels: [excel], country: 'CN', blocked: () => false, onDownload() {} });
  assert.equal(flatten(withoutCallback).find(node => node.props?.['data-testid'] === 'packing-product-match').props.disabled, true);

  state.length = 0;
  const mappingDisabled = render({ excels: [excel], country: 'CN', blocked: () => false, onDownload() {}, onMatch() {}, mappingDisabled: true });
  assert.equal(flatten(mappingDisabled).find(node => node.props?.['data-testid'] === 'packing-product-match').props.disabled, true);

  state.length = 0;
  const statusDisabled = render({ excels: [{ name: 'unmatched.xlsx', products: [{ sourceName: 'UNKNOWN', unmatched: true }] }],
    country: 'CN', blocked: () => false, onDownload() {}, onMatch() {}, mappingDisabled: true });
  assert.equal(flatten(statusDisabled).find(node => node.props?.['data-testid'] === 'packing-result-status-match').props.disabled, true);
});

test('preview-only rows never expose download and source issues join the default review filter', () => {
  state.length = 0;
  const products = [
    { source_row: 1, sourceName: 'TARGET', name: 'TARGET', qty: null,
      sourceReview: { required: true, reasons: ['PRICE_OR_AMOUNT_MISSING'] } },
    { source_row: 2, sourceName: 'TARGET', name: 'TARGET', qty: 15,
      sourceReview: { required: false, reasons: [] } },
  ];
  const excel = { name: 'preview-only', label: 'Invoice preview', products, previewOnly: true };
  const reviews = [];
  const tree = render({ excels: [excel], country: 'CN', previewOnly: true, erpProducts: [{ ProdKey: 3, ProdName: 'TARGET', country: 'CN' }],
    blocked: () => true, onDownload() {}, onMatch() {}, onReviewSource: (...args) => reviews.push(args) });
  let nodes = flatten(tree);
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-table').props['data-result-name'], 'preview-only');
  assert.equal(nodes.filter(node => node.props?.['data-testid'] === 'packing-product-match').length, 1,
    'the exact DB match still appears when the source itself needs review');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-view-toggle').props['aria-pressed'], false);
  assert.match(text(tree), /원문 확인 1건/);
  assert.match(text(tree), /미리보기 · 다운로드 생성 안 됨/);
  assert.equal(nodes.some(node => node.type === 'button' && text(node).includes('다운로드')), false);
  const sourceIssue = nodes.find(node => node.props?.['data-testid'] === 'packing-result-source-review');
  assert.ok(sourceIssue);
  assert.match(text(sourceIssue), /단가·금액 미확인/);
  sourceIssue.props.onClick();
  assert.deepEqual(reviews[0], [products[0], excel, 0]);

  nodes.find(node => node.props?.['data-testid'] === 'packing-results-view-toggle').props.onClick();
  nodes = flatten(render({ excels: [excel], country: 'CN', previewOnly: true, erpProducts: [{ ProdKey: 3, ProdName: 'TARGET', country: 'CN' }],
    blocked: () => true, onDownload() {}, onMatch() {}, onReviewSource() {} }));
  assert.equal(nodes.filter(node => node.props?.['data-testid'] === 'packing-product-match').length, 2,
    '전체 보기 restores completed rows alongside the retained source review issue');
});

test('arrow keys move focus between row match buttons', () => {
  state.length = 0;
  const tree = render({
    excels: [{ name: 'keys.xlsx', products: [{ sourceName: 'A', qty: 1 }, { sourceName: 'B', qty: 2 }] }],
    country: 'CN', blocked: () => false, onDownload() {}, onMatch() {},
  });
  const buttons = flatten(tree).filter(node => node.props?.['data-testid'] === 'packing-product-match');
  let focused = '';
  buttons[0].props.ref({ disabled: false, focus() { focused = 'A'; } });
  buttons[1].props.ref({ disabled: false, focus() { focused = 'B'; } });
  let prevented = false;
  buttons[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focused, 'B');
  buttons[1].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(focused, 'A', 'navigation wraps to the first row');
});

test('keeps invoice and truncation notices without the duplicate unmatched sidebar cards', () => {
  state.length = 0;
  const tree = render({
    excels: [{
      name: 'notice.xlsx',
      products: [{ sourceName: 'UNKNOWN', qty: 1, unmatched: true }],
      totalMismatch: { computed: 8, expected: 10 },
    }],
    country: 'CN', blocked: () => false, onDownload() {}, onMatch() {}, truncated: true,
  });
  const issues = flatten(tree).filter(node => node.props?.['data-testid'] === 'packing-results-issues');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'div');
  assert.match(text(issues[0]), /인보이스 합계 불일치/);
  assert.match(text(issues[0]), /분석 결과 잘림/);
  assert.equal(flatten(tree).filter(node => node.type === 'input').length, 1, 'the browser-only reason memo stays in the unmatched table row');
});

test('keeps compact rows inside a component-owned horizontal scroller with visible focus', () => {
  assert.match(cssSource, /\.resultsSection\s*\{[^}]*max-width:\s*100%/s);
  assert.match(cssSource, /\.resultWorkspace\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(cssSource, /\.sheetScroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
  assert.match(cssSource, /\.resultSheet th, \.resultSheet td\s*\{[^}]*padding:\s*2px 6px/s);
  assert.match(cssSource, /:focus-visible\s*\{[^}]*outline:\s*3px solid/s);
});

test('copy summary preserves explicit zero, marks unknown quantity, and carries only real issue facts', () => {
  const excel = {
    name: 'china.xlsx',
    label: 'China invoice',
    products: [
      { source_row: 7, name: 'ZERO <img src=x onerror=alert(1)>', qty: 0, unmatched: true },
      { source_row: 8, name: 'UNKNOWN', qty: null, unmatched: true },
      { sourceName: 'MATCHED', name: 'MATCHED', qty: 9, unmatched: false },
    ],
    totalMismatch: { computed: 0, expected: 10, invoice: 'INV-1' },
  };
  const summary = buildIssueSummary([excel], 'CN', { 'china.xlsx::7': '원문 품명 확인' }, true, [{ ProdKey: 1, ProdName: 'MATCHED', country: 'CN' }]);

  assert.match(summary.text, /ZERO <img src=x onerror=alert\(1\)> · 0단 · 사유: 원문 품명 확인/);
  assert.match(summary.text, /UNKNOWN · 수량 미확인 · 사유: DB 미매칭/);
  assert.match(summary.text, /패킹 리스트 0 · 인보이스 10/);
  assert.match(summary.text, /PDF 분석 결과가 잘려/);
  assert.doesNotMatch(summary.text, /MATCHED/);
  assert.equal(summary.issueCount, 4);
  assert.doesNotMatch(source, /innerHTML|dangerouslySetInnerHTML/);
  assert.match(source, /textContent =/);
});

test('does not aggregate quantity for an unknown country unit', () => {
  state.length = 0;
  const tree = render({
    excels: [{ name: 'unknown.xlsx', products: [{ name: 'A', qty: 5 }] }],
    country: 'XX', blocked: () => false, onDownload() {},
  });
  assert.match(text(tree), /수량 합계 단위 미확인/);
  assert.doesNotMatch(text(tree), /합계 5송이|합계 5단/);
});

test('same item in different invoices keeps separate quantities and notes', () => {
  const summary = buildIssueSummary([
    { name: '2026-41.xlsx', products: [{ name: 'ROSE', source_row: 7, qty: 2, unmatched: true }] },
    { name: '2027-41.xlsx', products: [{ name: 'ROSE', source_row: 7, qty: 8, unmatched: true }] },
  ], 'CN', { '2026-41.xlsx::7': '이전 인보이스 확인' });
  assert.equal(summary.issueCount, 2);
  assert.match(summary.text, /ROSE · 2단 · 사유: 이전 인보이스 확인/);
  assert.match(summary.text, /ROSE · 8단 · 사유: DB 미매칭/);
});
