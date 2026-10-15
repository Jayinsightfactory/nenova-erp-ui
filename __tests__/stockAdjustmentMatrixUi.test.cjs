const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const source = fs.readFileSync(require.resolve('../components/StockAdjustmentMatrixPanel.js'), 'utf8');
const compiled = transformSync(source, { filename: 'StockAdjustmentMatrixPanel.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } }).code;

function harness() {
  let cursor = 0, year = 2026, tree;
  const slots = [], pending = [], calls = [], downloads = [];
  const react = {
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(fn, deps) { const index = cursor++; const previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) pending.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); },
  };
  const context = { exports: {}, require: () => react, React: react, URLSearchParams, AbortController, setTimeout: (fn) => fn(), URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, document: { createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }), body: { appendChild() {} } }, fetch: (url, options) => new Promise((resolve) => calls.push({ url, options, resolve })) };
  vm.runInNewContext(compiled, context);
  const render = (nextYear = year) => { year = nextYear; cursor = 0; tree = context.exports.default({ year }); while (pending.length) pending.shift()(); return tree; };
  const all = (type, node = tree) => !node || typeof node !== 'object' ? [] : [...(node.type === type ? [node] : []), ...node.children.flatMap((child) => all(type, child))];
  const settle = async (call, data) => { call.resolve({ ok: true, json: async () => data }); await new Promise(setImmediate); render(); };
  render();
  return { render, calls, downloads, all, settle, text: () => JSON.stringify(tree) };
}
const matrix = { ok: true, orderYear: '2026', rows: [{ key: '10:stem', prodKey: 10, productName: '긴 품명', unit: 'stem', net: -0.125, invalidCount: 0, cells: { '41-1': { quantity: 0, eventCount: 2, invalidCount: 0 }, '41-2': { quantity: null, eventCount: 1, invalidCount: 1 } } }], weeks: [{ key: '41-1', label: '41-1' }, { key: '41-2', label: '41-2' }, { key: '42-1', label: '42-1' }], eventCount: 3, invalidCount: 1 };

test('actual matrix preserves decimal, zero, missing quantity and absent-history cells', async () => {
  const ui = harness(); await ui.settle(ui.calls[0], matrix);
  const cells = ui.all('td').filter((cell) => cell.props.className === 'quantity');
  assert.equal(cells[0].children[0].children[0], '0');
  assert.equal(cells[1].children[0].children[0], '확인 필요');
  assert.equal(cells[2].children[0], '');
  assert.equal(cells[3].children[0], '-0.125');
  assert.match(ui.text(), /선택 연도 전체 참고 자료/);
  assert.equal(ui.all('option').length, 54);
});

test('year transition hides previous data and rejects late responses', async () => {
  const ui = harness(); const old = ui.calls[0]; ui.render(2025);
  assert.equal(old.options.signal.aborted, true);
  await ui.settle(old, matrix);
  assert.equal(ui.all('table').length, 0);
  assert.ok(ui.all('button')[1].props.disabled);
  await ui.settle(ui.calls[1], { ...matrix, orderYear: '2025', rows: [] });
  assert.match(ui.text(), /실제 조정 이력이 없습니다/);
});

test('Enter form applies search, major stays selected and Excel uses exact displayed filter', async () => {
  const ui = harness(); await ui.settle(ui.calls[0], matrix);
  ui.all('select')[0].props.onChange({ target: { value: '41' } }); ui.render();
  await ui.settle(ui.calls[1], matrix);
  ui.all('input')[0].props.onChange({ target: { value: '장미/RED' } }); ui.render();
  assert.ok(ui.all('button')[1].props.disabled);
  ui.all('form')[0].props.onSubmit({ preventDefault() {} }); ui.render();
  assert.match(ui.calls[2].url, /major=41&search=/);
  await ui.settle(ui.calls[2], matrix);
  assert.equal(ui.all('select')[0].props.value, '41');
  const promise = ui.all('button')[1].props.onClick();
  const call = ui.calls[3]; assert.equal(call.url, `${ui.calls[2].url}&format=xlsx`);
  call.resolve({ ok: true, headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, blob: async () => ({}) }); await promise;
  assert.deepEqual(ui.downloads, ['재고조정_2026년_41차_장미_RED.xlsx']);
});

test('same-year filter changes reject late responses and export errors remain visible', async () => {
  const ui = harness(); const first = ui.calls[0];
  ui.all('select')[0].props.onChange({ target: { value: '42' } }); ui.render();
  await ui.settle(first, matrix); assert.equal(ui.all('table').length, 0);
  await ui.settle(ui.calls[1], matrix);
  const promise = ui.all('button')[1].props.onClick();
  ui.calls[2].resolve({ ok: false, headers: { get: () => 'application/json' }, json: async () => ({ message: '다운로드 실패' }) });
  await promise; ui.render(); assert.match(ui.text(), /다운로드 실패/);
});


test('mismatched response year is a visible failure, never a new-year table', async () => {
  const ui = harness();
  await ui.settle(ui.calls[0], { ...matrix, orderYear: '2025' });
  assert.equal(ui.all('table').length, 0);
  assert.match(ui.text(), /요청한 연도와 조회 결과가 다릅니다/);
  assert.ok(ui.all('button')[1].props.disabled);
});

test('tiny nonzero quantities retain their sign and magnitude rather than rounding to zero', async () => {
  const ui = harness();
  const rows = [1e-11, -1e-11, Number.MIN_VALUE, 0].map((quantity, index) => ({ ...matrix.rows[0], key: String(index), net: quantity, cells: { '41-1': { quantity, eventCount: 1, invalidCount: 0 } } }));
  await ui.settle(ui.calls[0], { ...matrix, rows });
  const values = ui.all('td').filter((cell) => cell.props.className === 'quantity').filter((_, index) => index % 4 === 0).map(cell => cell.children[0].children[0]);
  assert.deepEqual(values, ['+1e-11', '-1e-11', '+5e-324', '0']);
});
