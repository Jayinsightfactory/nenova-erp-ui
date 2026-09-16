const assert = require('assert');
const {
  MENU_HISTORY_KEY,
  rememberMenuRoute,
  takePreviousMenuRoute,
} = require('../lib/menuNavigationHistory');

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const store = storage();
rememberMenuRoute('/raum/pnl?popup=1', store);
rememberMenuRoute('/raum/purchase-costs?popup=1', store);
assert.equal(takePreviousMenuRoute('/sales/farm-quality?popup=1', store), '/raum/purchase-costs?popup=1');
assert.equal(takePreviousMenuRoute('/raum/purchase-costs?popup=1', store), '/raum/pnl?popup=1');
assert.equal(takePreviousMenuRoute('/raum/pnl?popup=1', store), '');

rememberMenuRoute('https://evil.example/path', store);
assert.deepEqual(JSON.parse(store.getItem(MENU_HISTORY_KEY) || '[]'), []);

const component = require('fs').readFileSync(require('path').join(__dirname, '../components/MenuBackButton.js'), 'utf8');
assert(!/window\.close\s*\(/.test(component), '뒤로가기는 자식창을 닫으면 안 됩니다.');
assert(/takePreviousMenuRoute/.test(component), '같은 창의 메뉴 이동 기록을 우선 사용해야 합니다.');

console.log('menuNavigationHistory tests passed');
