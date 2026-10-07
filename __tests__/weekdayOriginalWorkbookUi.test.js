import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { normalizeWeekdayUnit } from '../lib/weekdayEstimateCompare.js';
import { buildWeekdayWorkbookExportUpdates } from '../lib/weekdayWorkbookExportPlan.js';

const require = createRequire(import.meta.url);
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const source = readFileSync(new URL('../components/WeekdayEstimateWorkspace.js', import.meta.url), 'utf8');
function callback(name, next, env) {
  const start = source.indexOf(`  ${name === 'downloadOriginalWorkbook' ? 'async ' : ''}function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start);
  assert.ok(start >= 0 && end > start, 'extract actual Workspace handler boundaries');
  const compiled = transformSync(`export default ${source.slice(start, end).trim()}`, false,
    Buffer.from(JSON.stringify({ jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' } })));
  const mod = { exports: {} };
  return new Function('environment', 'module', 'exports', `with(environment){${compiled.code};return module.exports.default;}`)(env, mod, mod.exports);
}
const scope = '533|2026|41';
const row = { sheet: '수국', row: 8, label: 'Mojito', quantityCells: [
  { address: 'D8', headerRole: 'date-quantity-candidate', columnHeader: '출고예정 11일', raw: '8', numericCandidate: 8 },
] };
const linked = { id: '수국|8|D8', sheet: '수국', sourceCell: 'D8', year: 2026, orderWeek: '41-01',
  date: '2026-10-11', custKey: 533, prodKey: 77, unit: '송이', draftScope: scope, quantity: 3 };
function sourceEnvironment(plans = []) {
  const env = { editLocked: false, customer: { CustKey: 533 }, cycles: [{ year: 2026, days: [
    { date: '2026-10-11', orderWeek: '41-01', calendarState: 'FOUND' },
  ] }], unit: '송이', mappings: { '수국|8': 77 }, productNames: { '수국|8': 'Mojito' },
  shipDate: '', scopeKey: scope, plans, activePlans: plans.filter(p => p.draftScope === scope),
  normalizeWeekdayUnit, draftKey: item => `${item.sheet}|${item.row}|${item.cell.address}`,
  originalWorkbook: { current: { fileId: 'new-file', scope } }, workbookLinks: { current: [] },
  setMessage(value) { env.message = value; }, setPlans(fn) { env.plans = fn(env.plans); } };
  return env;
}
test('reupload connects existing exact identity and preserves edited quantity', () => {
  const env = sourceEnvironment([{ ...linked }]);
  callback('addSourceRow', 'updatePlan', env)(row);
  assert.equal(env.plans.length, 1);
  assert.equal(env.plans[0].quantity, 3);
  assert.equal(env.workbookLinks.current.length, 1);
  assert.equal(env.workbookLinks.current[0].fileId, 'new-file');
  assert.equal(env.workbookLinks.current[0].sourceCell, 'D8');
  assert.match(env.message, /새 초안 0건/);
});
test('other scope with identical source address cannot block current file linking', () => {
  const other = { ...linked, draftScope: '533|2025|41', year: 2025 };
  const env = sourceEnvironment([other]);
  callback('addSourceRow', 'updatePlan', env)(row);
  assert.equal(env.plans.length, 2);
  assert.deepEqual(env.plans[0], other);
  assert.equal(env.plans[1].quantity, 8);
  assert.equal(env.workbookLinks.current.length, 1);
});
test('same address with conflicting date/unit blocks without changing links or quantities', () => {
  for (const patch of [{ date: '2026-10-12' }, { unit: '박스' }]) {
    const plans = [{ ...linked, ...patch }], env = sourceEnvironment(plans);
    const before = JSON.stringify(plans);
    callback('addSourceRow', 'updatePlan', env)(row);
    assert.equal(JSON.stringify(env.plans), before);
    assert.deepEqual(env.workbookLinks.current, []);
    assert.match(env.message, /품목·날짜·단위가 다릅니다/);
  }
});

function downloadEnvironment() {
  let release;
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const env = { scopeKey: scope, customer: { CustKey: 533 }, activePlans: [{ ...linked }],
    compareRows: [{ year: 2026, orderWeek: '41-01', custKey: 533, prodKey: 77, outUnit: '송이',
      state: 'FOUND_UNFIXED', detailRows: 1, shipmentDates: [{ date: linked.date, shipmentQuantity: 8 }] }],
    workbookLinks: { current: [{ ...linked, fileId: 'file-a' }] }, currentScope: { current: scope },
    originalWorkbook: { current: { fileId: 'file-a', scope, file: { name: '주광.xlsx',
      arrayBuffer: () => new Promise(resolve => { release = () => resolve(bytes); }) } } },
    exportState: { current: { plans: [{ ...linked }], compareRows: [] } }, buildWeekdayWorkbookExportUpdates,
    patchOriginalWorkbook: async (input, updates, options) => {
      assert.equal(input, bytes, 'patch receives the retained original bytes');
      assert.deepEqual(updates, [{ sheetName: '수국', address: 'D8', value: 3 }]);
      assert.deepEqual(options, { filename: '주광.xlsx' });
      env.patchCalls++; return input;
    }, patchCalls: 0, urls: 0, clicked: 0, revoked: 0, Blob,
    URL: { createObjectURL() { env.urls++; return 'blob:fixture'; }, revokeObjectURL() { env.revoked++; } },
    document: { body: { appendChild() {} }, createElement(tag) { assert.equal(tag, 'a');
      return { click() { env.clicked++; }, remove() {} }; } }, setTimeout(fn) { fn(); },
    setDownloadBusy(value) { env.busy = value; }, setDownloadError(value) { env.error = value; },
    setMessage(value) { env.message = value; }, release: () => release() };
  return env;
}
test('download passes retained original bytes and absolute updates, then releases busy state', async () => {
  const env = downloadEnvironment();
  const pending = callback('downloadOriginalWorkbook', 'addSourceRow', env)();
  assert.equal(env.busy, true); env.release(); await pending;
  assert.equal(env.patchCalls, 1); assert.equal(env.urls, 1); assert.equal(env.clicked, 1);
  assert.equal(env.revoked, 1); assert.equal(env.busy, false); assert.equal(env.error, '');
  assert.match(env.message, /1개 셀 반영/);
});
test('quantity or ERP snapshot change during file read prevents any download', async () => {
  for (const changed of ['plans', 'compareRows']) {
    const env = downloadEnvironment();
    const pending = callback('downloadOriginalWorkbook', 'addSourceRow', env)();
    env.exportState.current = { ...env.exportState.current, [changed]: [{ quantity: 999 }] };
    env.release(); await pending;
    assert.equal(env.urls, 0); assert.equal(env.clicked, 0); assert.equal(env.message, undefined);
    assert.match(env.error, / 수량|수량 또는 전산/); assert.equal(env.busy, false);
  }
});
test('original file replacement or scope switch during await prevents download', async () => {
  for (const changed of ['file', 'scope']) {
    const env = downloadEnvironment();
    const pending = callback('downloadOriginalWorkbook', 'addSourceRow', env)();
    if (changed === 'file') env.originalWorkbook.current = { ...env.originalWorkbook.current, fileId: 'file-b' };
    else env.currentScope.current = '533|2026|42';
    env.release(); await pending;
    assert.equal(env.urls, 0); assert.equal(env.clicked, 0); assert.equal(env.message, undefined);
    assert.match(env.error, /원본이 변경/); assert.equal(env.busy, false);
  }
});
