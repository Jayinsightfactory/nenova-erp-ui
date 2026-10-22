const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const source = fs.readFileSync('pages/shipment/distribute-import.js', 'utf8');
const helpers = source.slice(source.indexOf('const fmt ='), source.indexOf('export default function'));
const component = source.slice(source.indexOf('function PivotComparison('), source.indexOf('function ApplyProgressModal('));
const styles = source.slice(source.lastIndexOf('const st ='));
const code = transformSync(`${helpers}\n${component}\n${styles}\nmodule.exports={buildPivotModel,PivotComparison};`, false,
  Buffer.from(JSON.stringify({ jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }))).code;
const mod = { exports: {} };
const familyBody = fs.readFileSync('lib/shipmentImportQty.js', 'utf8')
  .match(/export function isAlstroImportRow\(row\) \{([\s\S]*?)\r?\n\}/)[1];
const isAlstroImportRow = new Function('row', familyBody);
new Function('require', 'module', 'exports', 'isAlstroImportRow', code)(require, mod, mod.exports, isAlstroImportRow);
const { buildPivotModel, PivotComparison } = mod.exports;
const rows = [
  { custKey: 1, custName: '주광', prodKey: 1, prodName: '품목 A', uploadQty: 16, orderQty: 16, currentOutQty: 16, status: '동일' },
  { custKey: 2, custName: '주식회사 긴 업체 이름 (지점 포함)', prodKey: 1, prodName: '품목 A', uploadQty: 0, orderQty: 0, currentOutQty: 0, status: '동일' },
  { custKey: 3, custName: '주광', prodKey: 1, prodName: '품목 A', uploadQty: 32.5, orderQty: 32.5, currentOutQty: 32.5, status: '동일' },
  { custKey: 1, custName: '주광', prodKey: 2, prodName: '품목 B', uploadQty: 1000, orderQty: 1000, currentOutQty: 1000, status: '동일' },
];
const render = (selected, filter = 'all', full = selected) => renderToStaticMarkup(React.createElement(PivotComparison, {
  model: buildPivotModel(selected), fullModel: buildPivotModel(full), filter,
}));
function footerCells(html) {
  const footer = html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1] || '';
  return [...footer.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
}
function check(selected, expected, filter, full) {
  const html = render(selected, filter, full);
  const cells = footerCells(html);
  assert.equal(cells.length, expected.length + 6);
  expected.forEach(([name, qty], i) => {
    const divs = [...cells[i + 1].matchAll(/<div\b[^>]*>(.*?)<\/div>/g)].map(m => m[1]);
    assert.deepEqual(divs, [name, qty]);
  });
  assert.match(cells[2], /overflow-wrap:anywhere/);
  return cells;
}
const before = JSON.stringify(rows);
const all = check(rows, [['주광', '1,016'], ['주식회사 긴 업체 이름 (지점 포함)', '0'], ['주광', '32.5']]);
assert.equal(all[6], '1,048.5'); // Existing overall upload total is unchanged.
check([rows[2], rows[1]], [['주광', '32.5'], ['주식회사 긴 업체 이름 (지점 포함)', '0']], 'changed', rows);
assert.equal(footerCells(render([])).length, 0);
// Rendering an independently selected year must never retain the previous model's totals.
for (const [year, qty] of [[2025, 7], [2026, 19]]) {
  const scoped = [{ ...rows[0], orderYear: year, orderWeek: '41-01', uploadQty: qty }];
  const cells = footerCells(render(scoped));
  assert.match(cells[1], new RegExp(`<div>${qty}</div>`));
  assert.equal(scoped[0].orderYear, year);
}
assert.equal(JSON.stringify(rows), before);
console.log('Shipment import footer: labels, totals, zero, long/duplicate names, filtered order and separate-year rendering passed');
module.exports = { render, rows };
