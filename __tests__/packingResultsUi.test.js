const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const babel = require('next/dist/compiled/babel/core');

const sourcePath = path.join(__dirname, '../components/import-tools/PackingResults.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const code = babel.transformSync(source, {
  filename: sourcePath,
  presets: [require('next/dist/compiled/babel/preset-react')],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
  configFile: false,
  babelrc: false,
}).code;

const state = [];
let cursor = 0;
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  },
  useMemo: fn => { cursor++; return fn(); },
  useRef(initial) { cursor++; return { current: initial }; },
  useEffect() { cursor++; },
};
const css = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', code)(key => {
  if (key === 'react') return React;
  if (key === '../../styles/ImportPacking.module.css') return css;
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
  const tree = render({ excels: [excel], country: 'CN', blocked: item => item === excel, onDownload() {} });
  const nodes = flatten(tree);

  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results')?.type, 'section');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-table')?.type, 'table');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-issues')?.type, 'aside');
  assert.equal(nodes.find(node => node.props?.['data-testid'] === 'packing-results-copy-open')?.type, 'button');
  assert.equal(nodes.filter(node => node.type === 'tr').length, 102, 'header plus all 101 product rows');
  for (const heading of ['원문품목', '매칭품목', '길이', '박스', '단수', '송이', '단가', '금액', '상태']) {
    assert.ok(text(tree).includes(heading), `missing optional column ${heading}`);
  }
  assert.ok(text(tree).includes('GW 미확인'));
  assert.ok(text(tree).includes('CW 0kg'));
  assert.ok(text(tree).includes('매칭 101'));
  assert.ok(text(tree).includes('—'), 'unknown values stay unknown instead of becoming zero');
  const download = nodes.find(node => node.type === 'button' && text(node).includes('다운로드 차단'));
  assert.equal(download.props.disabled, true, 'existing blocked callback owns the download gate');
});

test('copy summary preserves explicit zero, marks unknown quantity, and carries only real issue facts', () => {
  const excel = {
    name: 'china.xlsx',
    label: 'China invoice',
    products: [
      { source_row: 7, name: 'ZERO <img src=x onerror=alert(1)>', qty: 0, unmatched: true },
      { source_row: 8, name: 'UNKNOWN', qty: null, unmatched: true },
      { name: 'MATCHED', qty: 9, unmatched: false },
    ],
    totalMismatch: { computed: 0, expected: 10, invoice: 'INV-1' },
  };
  const summary = buildIssueSummary([excel], 'CN', { 'china.xlsx::7': '원문 품명 확인' }, true);

  assert.match(summary.text, /ZERO <img src=x onerror=alert\(1\)> · 0단 · 사유: 원문 품명 확인/);
  assert.match(summary.text, /UNKNOWN · 수량 미확인 · 사유: 카탈로그 미매칭/);
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
  assert.match(summary.text, /ROSE · 8단 · 사유: 카탈로그 미매칭/);
});
