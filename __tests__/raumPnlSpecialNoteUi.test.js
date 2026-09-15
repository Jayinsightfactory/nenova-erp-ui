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

const Dialog = loadJsx('../components/raum/PnlSpecialNotesDialog.js').default;
let html = renderToStaticMarkup(React.createElement(Dialog, {
  open: true, partnerCode: 'shilla', partnerLabel: '신라호텔', initialYear: '2026', yearOptions: ['2025', '2026'], onClose() {},
}));
assert.match(html, /role="dialog"/);
assert.match(html, /신라호텔 특이사항/);
assert.match(html, /aria-label="특이사항 연도"/);
assert.match(html, /2026년/);
assert.match(html, /2025년/);
assert.match(html, /maxLength="5000"/);
assert.match(html, /특이사항 저장/);
assert.match(html, /차수별 매입단가, 원본 자료, 정산 확인사항/);
assert.equal(renderToStaticMarkup(React.createElement(Dialog, { open: false })), '');

const page = fs.readFileSync(path.resolve(__dirname, '../pages/raum/pnl.js'), 'utf8');
const costButton = page.indexOf('>차수별 매입단가 관리</button>');
const noteButton = page.indexOf('>📝 특이사항</button>');
assert.ok(costButton >= 0 && noteButton > costButton && noteButton - costButton < 1200, '특이사항 버튼은 차수별 매입단가 관리 바로 옆에 있어야 한다.');
assert.match(page, /partnerCode=\{partnerCode\}/);
assert.match(page, /initialYear=\{specialNoteYear\}/);
console.log('Raum P&L special-note dialog UI contract passed');
