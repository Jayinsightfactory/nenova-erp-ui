const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'components/import-tools/PackingMatchManager.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/PackingMatchManager.module.css'), 'utf8');
const code = babel.transformSync(source, {
  filename:'PackingMatchManager.js',
  presets:[require('next/dist/compiled/babel/preset-react')],
  plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
  configFile:false, babelrc:false,
}).code;
const countries = {NL:'네덜란드', CO:'콜롬비아', CN:'중국', EC:'에콰도르', TH:'태국', AU:'호주', US:'미국', VN:'베트남'};
const styles = new Proxy({}, {get:(_, key) => key === '__esModule' ? false : String(key)});
function load(react) {
  const module = {exports:{}};
  const imports = {react, '../../lib/importPackingErpMatches.js':{PACKING_COUNTRIES:countries}, '../../styles/PackingMatchManager.module.css':styles};
  new Function('require', 'module', 'exports', code)(key => {
    assert.ok(key in imports, `unexpected import ${key}`);
    return imports[key];
  }, module, module.exports);
  return module.exports.default;
}
const Component = load(React);
const entry = (description, prodKey, prodName, country='CN') => ({description, sourceKey:description, prodKey, prodName, country});
const product = (ProdKey, ProdName, country='CN', selectable=true, ProdCode=`C${ProdKey}`) => ({ProdKey, ProdName, country, selectable, ProdCode});
const entries = [
  entry('원문 전체 이름 long supplier rose 60cm', 1, 'Rose 60'),
  entry('삭제된 품목', 2, 'Missing'),
  entry('이름 바뀐 품목', 3, 'Old Name'),
  entry('동명 품목', 4, 'Duplicate'),
  entry('타국 품목', 5, 'Foreign'),
  entry('콜롬비아 원문', 6, 'CO Flower', 'CO'),
];
const products = [product(1, 'Rose 60'), product(3, 'New Name'), product(4, 'Duplicate', 'CN', false), product(5, 'Foreign', 'CO'), product(6, 'CO Flower', 'CO')];

function harness() {
  const state = [];
  let cursor = 0;
  const fakeReact = {
    createElement:(type, props, ...children) => ({type, props:{...props, children}}),
    useState:initial => {const slot=cursor++; if (!(slot in state)) state[slot]=initial; return [state[slot], value => {state[slot]=typeof value==='function' ? value(state[slot]) : value;}];},
    useMemo:fn => fn(),
  };
  const View = load(fakeReact);
  const render = props => {cursor=0; return View(props);};
  const flat = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flat) : [node, ...(node.props?.children || []).flatMap(flat)];
  const rows = tree => flat(tree).filter(node => node.type === 'tbody')[0].props.children.flatMap(flat).filter(node => node.type === 'tr');
  const rowText = node => flat(node).flatMap(item => item.props.children || []).filter(item => typeof item === 'string' || typeof item === 'number').join(' ');
  return {render, flat, rows, rowText};
}

test('real React render starts collapsed with an accessible count; expanded markup distinguishes DB connections', () => {
  const html = renderToStaticMarkup(React.createElement(Component, {entries, products}));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /매칭 데이터 조회·수정 \(6\)/);
  assert.doesNotMatch(html, /<table/);
  const h = harness();
  const toggle = h.flat(h.render({entries, products})).find(node => node.type === 'button');
  toggle.props.onClick();
  const expanded = h.render({entries, products});
  assert.equal(h.flat(expanded).find(node => node.type === 'button').props['aria-expanded'], true);
  assert.equal(h.rows(expanded).length, 6);
  const text = h.flat(expanded).filter(node => node.type === 'p').map(h.rowText).join(' ');
  assert.match(text, /팀 공용 전산 DB 품목 연결 기록만/);
  assert.match(text, /기존 변환 별칭·기본 변환 규칙은 포함하지 않습니다/);
  assert.match(text, /이미 입고한 문서는 변경되지 않습니다/);
});

test('status agrees with packingErpAliases exact country, ProdKey, ProdName, selectable predicates', async () => {
  const {packingErpAliases} = await import('../lib/importPackingErpMatches.js');
  const h = harness();
  h.flat(h.render({entries, products})).find(node => node.type === 'button').props.onClick();
  const rows = h.rows(h.render({entries, products}));
  assert.equal(rows.length, 6);
  const expected = ['정상', '확인 필요', '확인 필요', '확인 필요', '확인 필요', '정상'];
  rows.forEach((row, index) => {
    const status = h.flat(row).find(node => node.type === 'span' && ['valid','review'].includes(node.props.className));
    assert.equal(status.props.children[0], expected[index]);
    const aliases = packingErpAliases(entries[index].country, {}, {entries:[entries[index]]}, products);
    assert.equal(status.props.children[0] === '정상', aliases[entries[index].sourceKey] === entries[index].prodName);
  });
  const values = rows.map(h.rowText);
  assert.match(values[0], /원문 전체 이름 long supplier rose 60cm/);
  assert.match(values[0], /현재 코드:\s+C1/);
  assert.match(values[1], /현재 전산 품목 없음/);
  assert.match(values[1], /현재 코드:\s+—/);
  assert.match(values[2], /전산 품목명 변경/);
  assert.match(values[2], /현재 이름:\s+New Name/);
  assert.match(values[3], /현재 선택할 수 없는 품목/);
  assert.match(values[4], /연결 품목의 국가가 다름/);
});

test('country, original/stored/current/code search, review filter, reload and edit controls', () => {
  const h = harness();
  const calls = [];
  const props = {entries, products, onEdit:item => calls.push(item), onReload:() => calls.push('reload')};
  h.flat(h.render(props)).find(node => node.type === 'button').props.onClick();
  const controls = () => h.flat(h.render(props));
  const country = () => controls().find(node => node.type === 'select' && node.props.value === 'ALL' && h.flat(node).some(option => option.type === 'option' && option.props.value === 'CN'));
  country().props.onChange({target:{value:'CO'}});
  assert.equal(h.rows(h.render(props)).length, 1);
  const allCountry = controls().find(node => node.type === 'select' && node.props.value === 'CO');
  allCountry.props.onChange({target:{value:'ALL'}});
  const search = () => controls().find(node => node.type === 'input');
  for (const query of ['supplier rose', 'Old Name', 'New Name', 'C3']) {
    search().props.onChange({target:{value:query}});
    assert.equal(h.rows(h.render(props)).length, 1, `search ${query}`);
  }
  search().props.onChange({target:{value:''}});
  controls().find(node => node.type === 'select' && h.flat(node).some(option => option.type === 'option' && option.props.value === 'REVIEW')).props.onChange({target:{value:'REVIEW'}});
  assert.equal(h.rows(h.render(props)).length, 4);
  const buttons = controls().filter(node => node.type === 'button');
  buttons.find(node => node.props.children.includes('전산·매칭 다시 조회')).props.onClick();
  buttons.find(node => node.props.children.includes('매칭 수정')).props.onClick();
  assert.equal(calls[0], 'reload');
  assert.equal(calls[1], entries[1], 'edit callback receives unchanged saved entry');
});

test('disabled locks all native controls and layout has no nested vertical scrolling', () => {
  const h = harness();
  const props = {entries, products, disabled:true, onEdit:() => assert.fail('edit'), onReload:() => assert.fail('reload')};
  const collapsed = h.render(props);
  assert.equal(h.flat(collapsed).find(node => node.type === 'button').props.disabled, true);
  // Open while enabled, then lock the existing panel.
  h.flat(h.render({...props, disabled:false})).find(node => node.type === 'button').props.onClick();
  const nodes = h.flat(h.render(props));
  const controls = nodes.filter(node => ['button','input','select'].includes(node.type));
  assert.ok(controls.length > 4);
  assert.ok(controls.every(node => node.props.disabled === true));
  assert.match(css, /overflow-x:\s*auto/);
  assert.doesNotMatch(css, /overflow-y:\s*(auto|scroll)|max-height:\s*\d/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*700px\)/);
});

test('1920 and 1280 desktop widths keep table and actions in the page width', {timeout:30000}, async context => {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!fs.existsSync(chrome)) return context.skip('Chrome is not installed');
  const puppeteer = require('puppeteer-core');
  const h = harness();
  const longEntries = [entry('LONG ORIGINAL NAME '.repeat(22), 1, 'Rose 60'), ...entries];
  const props = {entries:longEntries, products};
  h.flat(h.render(props)).find(node => node.type === 'button').props.onClick();
  const asReact = node => node == null || typeof node === 'boolean' ? null : Array.isArray(node) ? node.map(asReact) :
    typeof node !== 'object' ? node : React.createElement(node.type, {...node.props, children:undefined}, ...node.props.children.map(asReact));
  const markup = renderToStaticMarkup(asReact(h.render(props)));
  const browser = await puppeteer.launch({executablePath:chrome, headless:true});
  try {
    const page = await browser.newPage();
    for (const width of [1920, 1280]) {
      await page.setViewport({width, height:1080, deviceScaleFactor:1});
      await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:20px;font-family:Arial,sans-serif}${css}</style></head><body>${markup}</body></html>`);
      const layout = await page.evaluate(() => {
        const table = document.querySelector('table');
        const edit = document.querySelector('tbody button');
        const original = document.querySelector('tbody td');
        return {documentWidth:document.documentElement.scrollWidth, tableRight:table.getBoundingClientRect().right,
          editRight:edit.getBoundingClientRect().right, originalHeight:original.getBoundingClientRect().height};
      });
      assert.ok(layout.documentWidth <= width, `${width}px page has horizontal clipping: ${JSON.stringify(layout)}`);
      assert.ok(layout.tableRight <= width && layout.editRight <= width, `${width}px action outside page`);
      assert.ok(layout.originalHeight > 50, `${width}px full original should wrap`);
    }
  } finally {await browser.close();}
});
