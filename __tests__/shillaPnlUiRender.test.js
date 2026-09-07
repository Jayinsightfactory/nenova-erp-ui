const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

function loadJsx(relative) {
  const filename = path.resolve(__dirname, relative);
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = name => name.startsWith('.')
    ? loadJsx(path.resolve(path.dirname(filename), /\.js$/.test(name) ? name : `${name}.js`))
    : originalRequire(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const loaded = loadJsx('../components/raum/ShillaPurchaseCosts.js');
const Cell = loaded.default;
const item = { name: '호접 · 염색', unit: '8스팀' };
const cell = { major: 15, values: [0], qty: 48, salePrices: [26000], purchaseAmount: 0, saleAmount: 1248000 };
const render = props => renderToStaticMarkup(React.createElement(Cell, { item, cell, onChange() {}, ...props }));

let html = render({});
assert.match(html, /신라 별도/);
assert.match(html, /value="0"/, 'confirmed free receipt must remain an editable zero, not missing');
assert.match(html, /수량 48/);
assert.match(html, /26,000/);
assert.match(html, /1,248,000/);
assert.match(html, /호접 · 염색 15차 신라 매입단가/);
html = render({ draft: { value: '100' } });
assert.match(html, /4,800/, 'draft purchase amount is local unit cost times unchanged quantity');
assert.match(html, /1,248,000/, 'draft purchase cost does not alter sales');
html = render({ draft: { value: '-1' } });
assert.match(html, /확인/);
assert.doesNotMatch(html, /매입액 -48/);
html = render({ disabled: true });
assert.match(html, /disabled=""/, 'save in progress prevents additional edits');
html = render({ cell: null });
assert.match(html, /신라 자료 없음/);
assert.doesNotMatch(html, /<input/);
assert.equal(loaded.isShillaPurchaseCostDraftUnchanged('0', cell), true);
assert.equal(loaded.isShillaPurchaseCostDraftUnchanged('', cell), false);
const Combined = loadJsx('../components/raum/CombinedPurchaseCostCell.js').default;
const detail = { qty: 2, salePrices: [300], costPrices: [100], purchaseAmount: 200, saleAmount: 600, missingCostRows: 0, missingSaleAmountRows: 0 };
const combinedCell = {
  major: 15,
  shared: { major: 15, state: 'match', values: [100], singleValue: 100, partners: { raum: detail, choimun: detail } },
  shilla: cell,
};
html = renderToStaticMarkup(React.createElement(Combined, { item, cell: combinedCell, onSharedChange() {}, onShillaChange() {} }));
assert.equal((html.match(/<input/g) || []).length, 2, 'same product/week shows two independently labelled purchase-cost inputs');
assert.match(html, /15차 공통 매입단가/);
assert.match(html, /15차 신라 매입단가/);
assert.match(html, /value="100"/);
assert.match(html, /value="0"/);
assert.match(html, /1,248,000/);
assert.match(html, /600/);
console.log('Shilla purchase-cost real React server render passed (zero/free, draft, invalid, disabled, absent)');
