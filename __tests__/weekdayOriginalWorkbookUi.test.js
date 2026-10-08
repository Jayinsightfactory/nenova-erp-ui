import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { normalizeWeekdayUnit } from '../lib/weekdayEstimateCompare.js';
import { applyEarlyShipmentClassification } from '../lib/weekdayEarlyShipmentPresentation.js';

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
  const earlyRecord={operationId:'early-fixture',revision:1,status:'APPLIED',custKey:533,prodKey:77,unit:'송이',
    quantity:3,sourceYear:2026,sourceMajorWeek:'41',targetYear:2026,targetMajorWeek:'42'};
  const env = { scopeKey: scope, customer: { CustKey: 533 }, activePlans: [{ ...linked }],
    compareRows: [{ year: 2026, orderWeek: '41-01', custKey: 533, prodKey: 77, outUnit: '송이',
      state: 'FOUND_UNFIXED', detailRows: 1, shipmentDates: [{ date: linked.date, shipmentQuantity: 8 }] }],
    workbookLinks: { current: [{ ...linked, fileId: 'file-a' }] }, currentScope: { current: scope },
    originalWorkbook: { current: { fileId: 'file-a', scope, savedTemplate: true, file: { name: '주광.xlsx',
      arrayBuffer: () => new Promise(resolve => { release = () => resolve(bytes); }) } } },
    exportState: { current: { plans: [{ ...linked }], compareRows: [], earlyRecords:[earlyRecord], earlyError:'' } },
    cycles: [], baselines: [], baselineCandidates: [], carryover: null, plans: [], year: 2026, majorWeek: '41', wilsonRecords:[],wilsonDrafts:[],activeWilsonInputs:[],exportWilsonDay:'일',wilsonBusy:false,wilsonError:'',earlyRecords:[earlyRecord],earlyError:'',
    buildHorizontalWeekdayMatrix: (...args) => { assert.equal(args[1],env.activePlans); assert.equal(args[2],env.compareRows);
      return {rows:[{prodKey:77,blocks:[{cycle:{year:2026,majorWeek:'41'},unit:'송이',remainderMajorView:{value:-3,savedValue:-3}}]}]}; },
    applyEarlyShipmentClassification,
    applyWeekdayCarryoverToMatrix: matrix => matrix,
    buildWeekdayWebExportSnapshot: (matrix,title,options) => { assert.equal(options.wilsonDrafts,env.activeWilsonInputs,'same scoped Wilson draft inputs as web matrix');
      assert.equal(matrix.rows[0].blocks[0].remainderMajorView.value,0,'source APPLIED q classifies -3 residual to zero in workbook');
      return {rows:[{name:'웹 품목',values:{quantity:3}}]}; },
    buildWeekdayStyledWebWorkbook: async (input, model) => {
      assert.deepEqual(new Uint8Array(input), bytes, 'export receives original formatting source bytes');
      assert.deepEqual(model.rows,[{name:'웹 품목',values:{quantity:3}}]);
      env.patchCalls++; return input;
    }, patchCalls: 0, urls: 0, clicked: 0, revoked: 0, Blob,
    URL: { createObjectURL() { env.urls++; return 'blob:fixture'; }, revokeObjectURL() { env.revoked++; } },
    document: { body: { appendChild() {} }, createElement(tag) { assert.equal(tag, 'a');
      return { click() { env.clicked++; }, remove() {} }; } }, setTimeout(fn) { fn(); },
    setDownloadBusy(value) { env.busy = value; }, setDownloadError(value) { env.error = value; },
    setMessage(value) { env.message = value; }, release: () => release() };
  return env;
}
test('download fills design with full web snapshot, then releases busy state', async () => {
  const env = downloadEnvironment();
  const pending = callback('downloadOriginalWorkbook', 'addSourceRow', env)();
  assert.equal(env.busy, true); env.release(); await pending;
  assert.equal(env.patchCalls, 1); assert.equal(env.urls, 1); assert.equal(env.clicked, 1);
  assert.equal(env.revoked, 1); assert.equal(env.busy, false); assert.equal(env.error, '');
  assert.match(env.message, /전체 1개 품목/);
});
test('quantity or ERP snapshot change during file read prevents any download', async () => {
  for (const changed of ['plans', 'compareRows', 'baselines', 'carryover', 'cycles','wilsonRecords','wilsonDrafts','exportWilsonDay']) {
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

test('manual imports still download full web work using saved design, not uploaded quantities', async () => {
  const env = downloadEnvironment(); env.originalWorkbook.current.savedTemplate = false;
  env.apiGet = async path => { assert.equal(path, '/api/estimate/weekday-template?custKey=533'); return {success:true,custKey:533,base64:'UEsDBA=='}; };
  await callback('downloadOriginalWorkbook','addSourceRow',env)();
  assert.equal(env.patchCalls,1); assert.equal(env.clicked,1); assert.equal(env.error,'');
});
test('unknown Wilson classification cannot be exported as zero', async () => {
  for(const state of [{wilsonBusy:true},{wilsonError:'윌슨 조회 실패'}]) {
    const env=Object.assign(downloadEnvironment(),state);
    await callback('downloadOriginalWorkbook','addSourceRow',env)();
    assert.equal(env.clicked,0);assert.equal(env.patchCalls,0);assert.match(env.error,/윌슨/);
  }
});

test('unknown or conflicting linked early shipment blocks workbook before file read', async () => {
  for(const kind of ['unknown','failed','conflicting']) {
    const env=downloadEnvironment();
    if(kind==='unknown')env.earlyRecords=null;
    if(kind==='failed')env.earlyError='원장 조회 실패';
    if(kind==='conflicting')env.earlyRecords=[...env.earlyRecords,{...env.earlyRecords[0],quantity:4}];
    await callback('downloadOriginalWorkbook','addSourceRow',env)();
    assert.equal(env.clicked,0);assert.equal(env.patchCalls,0);
    assert.match(env.error,/선출고/);
    assert.equal(env.busy,false);
  }
});
test('Wilson selector remount always shares actual selected weekday including storage fallback', () => {
  const matrixSource=readFileSync(new URL('../components/WeekdayCycleMatrix.js',import.meta.url),'utf8');
  const effect=matrixSource.split('\n').find(line=>line.includes("useEffect(()=>{let resolved='일'"));
  for(const stored of ['화',null,'invalid','throws']) {
    const selected=[],shared=[];
    new Function('useEffect','localStorage','wilsonWeekdays','setWilsonDay','onWilsonDayChange',effect)(
      callback=>callback(),{getItem(){if(stored==='throws')throw Error('storage disabled');return stored;}},
      ['목','금','토','일','월','화','수'],value=>selected.push(value),value=>shared.push(value));
    assert.deepEqual(selected,[stored==='화'?'화':'일']);assert.deepEqual(shared,selected);
  }
});
