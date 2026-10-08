const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');
const { renderToStaticMarkup } = require('react-dom/server');

function compile(relative, requireMock = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = mod.require.bind(mod);
  mod.require = (id) => Object.hasOwn(requireMock, id) ? requireMock[id] : realRequire(id);
  const code = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code;
  mod._compile(code, filename);
  return mod.exports;
}

const helper = compile('lib/stockAdjustmentReportNotes.js');
const scope = helper.parseStockAdjustmentScope('2026', '32-01');
assert.deepEqual(scope, { orderYear: '2026', major: '32', prefix: '32-%' });
for (const [year, week] of [[undefined, '32'], ['2026', undefined], ['26', '32'], ['0000', '32'], ['2026', '0'], ['2026', '54'], ['2026', '32-00'], ['2026', '32-100'], ['2026', '32-xx'], [['2026'], '32'], ['2026', ['32']], ['2026', '032'], ['2026', '32-']]) {
  assert.equal(helper.parseStockAdjustmentScope(year, week), null, `invalid ${JSON.stringify([year, week])}`);
}
assert.match(helper.STOCK_ADJUSTMENT_NOTES_SQL, /sh\.OrderYear\s*=\s*@year/);
assert.match(helper.STOCK_ADJUSTMENT_NOTES_SQL, /sh\.OrderWeek\s*=\s*@major\s+OR\s+sh\.OrderWeek\s+LIKE\s+@prefix/);
assert.match(helper.STOCK_ADJUSTMENT_NOTES_SQL, /EXISTS\s*\([\s\S]*CodeInfo ci[\s\S]*ci\.Category\s*=\s*N'StockType'[\s\S]*ci\.Descr\s*=\s*sh\.ChangeType/);
assert.match(helper.STOCK_ADJUSTMENT_NOTES_SQL, /LEFT JOIN Product p/);
assert.doesNotMatch(helper.STOCK_ADJUSTMENT_NOTES_SQL, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\b/i);

const row = (overrides = {}) => ({
  historyKey: 1, orderYear: '2026', orderWeek: '32-01', prodKey: 101,
  beforeValue: 100, afterValue: 93, changeType: '재고조정', reason: '',
  displayName: '테스트 품목 A', productName: '테스트 품목 A', country: '국가 A', flower: '품종 A', unit: '단',
  ...overrides,
});
const notes = helper.buildStockAdjustmentNotes([
  row(), row({ historyKey: 2, orderWeek: '32-02', beforeValue: 93, afterValue: 100, changeType: '기타차감', reason: '복원' }),
  row({ historyKey: 3, orderWeek: '31-02', afterValue: 116 }),
  row({ historyKey: 4, orderYear: '2025', afterValue: 116 }),
  row({ historyKey: 5, prodKey: 102, displayName: '테스트 품목 B', beforeValue: 50, afterValue: 43 }),
  row({ historyKey: 6, prodKey: 103, displayName: '테스트 품목 C', beforeValue: 50, afterValue: 43 }),
  row({ historyKey: 7, prodKey: 101, unit: '박스', beforeValue: 3, afterValue: 2 }),
], scope);
assert.equal(notes.count, 5);
assert.equal(notes.items.length, 4);
assert.equal(notes.items[0].net, 0, 'offsetting histories remain visible');
assert.equal(notes.items[0].increase, 7);
assert.equal(notes.items[0].decrease, -7);
assert.equal(notes.items[0].count, 2);
assert.deepEqual(notes.items[0].weeks, ['32-01', '32-02']);
assert.deepEqual(notes.items[0].changeTypes, ['재고조정', '기타차감']);
assert.deepEqual(notes.items[0].reasons, ['사유 미기재', '복원']);
assert.equal(notes.items.find((x) => x.unit === '박스').net, -1, 'units stay separate');
assert.equal(notes.items.filter((x) => x.unit === '단').length, 3, 'three synthetic products stay separate');

const irregular = helper.buildStockAdjustmentNotes([
  row({ historyKey: 8, prodKey: 104, productName: null, displayName: null, unit: null, beforeValue: null, afterValue: 0 }),
  row({ historyKey: 9, prodKey: 104, productName: null, displayName: null, unit: null, beforeValue: ' ', afterValue: 0 }),
  row({ historyKey: 10, prodKey: 104, productName: null, displayName: null, unit: null, beforeValue: 0, afterValue: 0 }),
  row({ historyKey: 11, prodKey: 104, productName: null, displayName: null, unit: null, beforeValue: '0.125', afterValue: '0.375' }),
  row({ historyKey: 14, prodKey: 104, productName: null, displayName: null, unit: null, beforeValue: '0x10', afterValue: 0 }),
  row({ historyKey: 12, prodKey: null, productName: null, displayName: null, unit: null, beforeValue: 0, afterValue: 1 }),
  row({ historyKey: 13, prodKey: null, productName: null, displayName: null, unit: null, beforeValue: 0, afterValue: 2 }),
], scope);
assert.equal(irregular.items[0].invalidCount, 3);
assert.equal(irregular.items[0].zeroCount, 1);
assert.equal(irregular.items[0].net, null, 'invalid quantity is not converted to zero');
assert.equal(irregular.items[0].increase, 0.25);
assert.equal(irregular.items[0].unit, '단위 미확인');
assert.match(irregular.items[0].productName, /품목번호 104/);
assert.equal(irregular.items.length, 3, 'missing product keys do not collapse distinct histories');

async function apiTests() {
  let calls = 0;
  let fail = false;
  const handler = compile('pages/api/sales/profit-stock-adjustment-notes.js', {
    '../../../lib/auth': { withAuth: (fn) => fn },
    '../../../lib/db': { query: async (sqlText, params) => { calls += 1; assert.equal(sqlText, helper.STOCK_ADJUSTMENT_NOTES_SQL); assert.equal(params.year.value, '2026'); assert.equal(params.major.value, '32'); assert.equal(params.prefix.value, '32-%'); if (fail) throw new Error('db down'); return { recordset: [row()] }; }, sql: { NVarChar: 'nvarchar' } },
    '../../../lib/stockAdjustmentReportNotes': helper,
  }).default;
  const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
  for (const query of [{}, { week: '32' }, { year: '2026' }, { year: ['2026'], week: '32' }, { year: '2026', week: '0' }]) {
    const res = response();
    await handler({ method: 'GET', query }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0, 'invalid input never touches DB');
  const method = response();
  await handler({ method: 'POST', query: { year: '2026', week: '32' } }, method);
  assert.equal(method.statusCode, 405);
  const ok = response();
  await handler({ method: 'GET', query: { year: '2026', week: '32' } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.count, 1);
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  fail = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    const bad = response();
    await handler({ method: 'GET', query: { year: '2026', week: '32' } }, bad);
    assert.equal(bad.statusCode, 500);
    assert.equal(bad.body.ok, false);
    assert.equal(bad.headers['Cache-Control'], 'no-store');
  } finally { console.error = originalError; }
}

function renderNotes(result, props = { orderYear: '2026', major: '32', confirmed: true }) {
  let stateIndex = 0;
  const ReactHooks = { useEffect: () => {}, useRef: () => ({ current: 0 }), useState: (initial) => [stateIndex++ === 0 ? 0 : result ?? initial, () => {}] };
  const Component = compile('components/ProfitStockAdjustmentNotes.js', { react: ReactHooks }).default;
  return renderToStaticMarkup(require('react').createElement(Component, props));
}

const xss = '<img src=x onerror=alert(1)>';
const unsafe = helper.buildStockAdjustmentNotes([row({ displayName: xss, reason: xss, changeType: xss })], scope);
const html = renderNotes({ scopeKey: '2026:32', status: 'ready', data: unsafe, error: '' });
assert.match(html, /&lt;img/);
assert.doesNotMatch(html, /<img src=x/);
assert.match(html, /확정본의 저장 당시 근거 또는 금액을 변경하지 않습니다/);
assert.match(renderNotes({ scopeKey: '2025:32', status: 'ready', data: unsafe, error: '' }), /조회 중/,
  'a stale scope is hidden before the effect runs');
assert.match(renderNotes({ scopeKey: '2026:32', status: 'error', data: null, error: 'DB 오류' }), /조회 실패/);
assert.doesNotMatch(renderNotes({ scopeKey: '2026:32', status: 'error', data: null, error: 'DB 오류' }), /이력 없음/);
assert.match(renderNotes({ scopeKey: '2026:32', status: 'ready', data: { count: 0, items: [] }, error: '' }), /이력 없음/);

async function clientRaceTest() {
  const state = [];
  const refs = [];
  const pending = [];
  let stateIndex = 0;
  let refIndex = 0;
  let nextEffect;
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(effect) { nextEffect = effect; },
  };
  const Component = compile('components/ProfitStockAdjustmentNotes.js', { react: hooks }).default;
  const oldFetch = global.fetch;
  global.fetch = (url, options) => new Promise((resolve) => pending.push({ url, options, resolve }));
  const render = (props) => {
    stateIndex = 0;
    refIndex = 0;
    return renderToStaticMarkup(Component(props));
  };
  try {
    const a = { orderYear: '2026', major: '31', confirmed: false, refreshToken: {} };
    const b = { orderYear: '2026', major: '32', confirmed: false, refreshToken: {} };
    render(a);
    const cleanupA = nextEffect();
    assert.match(pending[0].url, /week=31/);
    cleanupA();
    assert.equal(pending[0].options.signal.aborted, true);
    const beforeNewEffect = render(b);
    assert.match(beforeNewEffect, /조회 중/);
    assert.doesNotMatch(beforeNewEffect, /이력 없음/);
    const cleanupB = nextEffect();
    assert.match(pending[1].url, /week=32/);
    pending[0].resolve({ ok: true, json: async () => ({ ok: true, orderYear: '2026', major: '31', count: 0, items: [] }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(render(b), /조회 중/, 'late response from previous week is ignored');
    pending[1].resolve({ ok: true, json: async () => ({ ok: true, orderYear: '2026', major: '32', count: 0, items: [] }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(render(b), /이력 없음/, 'only successful current response gives empty state');
    cleanupB();
    const c = { ...b, refreshToken: {} };
    render(c);
    const cleanupC = nextEffect();
    assert.equal(pending.length, 3, 'same scope is re-fetched for a new report payload');
    cleanupC();
  } finally { global.fetch = oldFetch; }
}

const page = fs.readFileSync(path.resolve(__dirname, '..', 'pages/sales/profit-report.js'), 'utf8');
const component = fs.readFileSync(path.resolve(__dirname, '..', 'components/ProfitStockAdjustmentNotes.js'), 'utf8');
assert.match(page, /<ProfitStockAdjustmentNotes orderYear=\{data\.orderYear\} major=\{data\.major\}[^>]*refreshToken=\{data\}/);
assert.match(component, /controller\.abort\(\)/);
assert.match(component, /requestId\.current !== id/);
assert.match(component, /\[scopeKey, attempt, refreshToken\]/);
assert.match(component, /cache: 'no-store'/);
assert.doesNotMatch(component, /dangerouslySetInnerHTML/);

Promise.all([apiTests(), clientRaceTest()]).then(() => console.log('profit stock adjustment notes: passed')).catch((error) => { console.error(error); process.exitCode = 1; });
