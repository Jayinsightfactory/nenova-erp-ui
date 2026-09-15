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

const Alert = loadJsx('../components/raum/RaumPnlCollisionLocations.js').default;
const longHotel = '아주 긴 호텔 이름 '.repeat(18);
const longItem = '매우 긴 품목명 '.repeat(24);
const html = renderToStaticMarkup(React.createElement(Alert, { details: [
  { incomingIndex: 1, message: '기존 행 2개의 수기 매입단가 또는 품목 연결이 서로 다릅니다.', location: { hotel: '신라호텔', orderYear: '2025', major: '12', itemName: '장미', originalSource: '12차!A16', salePrice: 0 } },
  { incomingIndex: 2, message: '기존 행 수와 업로드 행 수가 달라 수기 정보를 안전하게 보존할 수 없습니다.', location: { hotel: longHotel, orderYear: '2026', major: '12', itemName: longItem, originalSource: '원본!A999' } },
] }));
assert.match(html, /data-testid="raum-pnl-collision-locations"/);
assert.match(html, /2025/);
assert.match(html, /2026/);
assert.match(html, /아주 긴 호텔 이름/);
assert.match(html, /매우 긴 품목명/);
assert.match(html, /업로드 원본 위치/);
assert.match(html, /판매단가/);
assert.match(html, /확인 내용/);
assert.match(html, /기존 행 2개의 수기 매입단가 또는 품목 연결이 서로 다릅니다/);
assert.match(html, />0<\/td>/, 'a zero sale price stays visible instead of disappearing');
assert.match(html, /overflow-wrap:anywhere/);
assert.match(html, /overflow-x:auto/);

const htmlWithoutPrice = renderToStaticMarkup(React.createElement(Alert, { details: [
  { incomingIndex: 3, message: '수기 품목 연결이 서로 다릅니다.', location: { hotel: '라움', orderYear: '2026', major: '13', itemName: '튤립', originalSource: '13차!B7' } },
] }));
assert.doesNotMatch(htmlWithoutPrice, /판매단가/, 'the optional price column is omitted when no structured price exists');
assert.equal(renderToStaticMarkup(React.createElement(Alert, { details: [] })), '');
console.log('Raum P&L collision location render tests passed');
