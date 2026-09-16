const assert = require('assert');
const {
  MENU_BACK_REQUEST_EVENT,
  MENU_PAGE_RESET_EVENT,
  MENU_HISTORY_KEY,
  requestContextualMenuBack,
  requestMenuPageReset,
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

function eventTarget(handler) {
  return {
    CustomEvent: class {
      constructor(type, options) { this.type = type; this.cancelable = options?.cancelable; this.defaultPrevented = false; }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    },
    dispatchEvent(event) { if (handler) handler(event); return !event.defaultPrevented; },
  };
}

assert.equal(requestContextualMenuBack(eventTarget()), false);
assert.equal(requestContextualMenuBack(eventTarget(event => {
  assert.equal(event.type, MENU_BACK_REQUEST_EVENT);
  event.preventDefault();
})), true);
let resetEvent = '';
assert.equal(requestMenuPageReset(eventTarget(event => { resetEvent = event.type; })), true);
assert.equal(resetEvent, MENU_PAGE_RESET_EVENT);

const component = require('fs').readFileSync(require('path').join(__dirname, '../components/MenuBackButton.js'), 'utf8');
assert(!/window\.close\s*\(/.test(component), '뒤로가기는 자식창을 닫으면 안 됩니다.');
assert(/requestContextualMenuBack/.test(component), '현재 페이지의 내부 초기 화면 복귀를 메뉴 이동보다 먼저 요청해야 합니다.');
assert(/pageInteractedRef/.test(component) && /requestMenuPageReset/.test(component), '모든 메뉴는 내부 작업 후 공통 초기 화면 복귀를 제공해야 합니다.');
assert(/new URLSearchParams\(window\.location\.search\)/.test(component), '상세 URL을 직접 연 직후에도 hydration 전 실제 query를 기준으로 초기 화면에 복귀해야 합니다.');
assert(/data-ui-page-content/.test(require('fs').readFileSync(require('path').join(__dirname, '../pages/_app.js'), 'utf8')), '모든 메뉴 페이지의 사용자 작업 영역을 공통으로 추적해야 합니다.');
assert(/takePreviousMenuRoute/.test(component), '같은 창의 메뉴 이동 기록을 우선 사용해야 합니다.');

console.log('menuNavigationHistory tests passed');
