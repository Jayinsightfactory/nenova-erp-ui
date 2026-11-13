import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import * as store from '../lib/costMasterStore.js';
import { prepareNativeShared, suggestGroup } from '../lib/nativeSharedCost.js';
import { createSharedAwbHandler } from '../lib/invoiceSharedAwbApi.js';

const SAMPLE = 'C:/Users/USER/Downloads/45-1 콜카장 원가자료.xlsx';
const types = { NVarChar: () => 1 };
const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; }, send(b) { this.body = b; } });
let wd = 0;
const line = (key, name, flower, box, stems, price, perBunch = 20, counName = '콜롬비아') => ({ WarehouseKey: key, WdetailKey: ++wd, ProdKey: 1000 + wd, SteamOf1Bunch: perBunch, SteamOf1Box: perBunch * 10,
  BoxQuantity: box, BunchQuantity: stems / perBunch, SteamQuantity: stems, OutQuantity: box, UPrice: price, TPrice: Math.round(stems * price * 100) / 100,
  ProdName: name, CounName: counName, FlowerName: flower, OutUnit: '박스' });
const head = (key, farm, inv) => ({ FarmName: farm, InvoiceNo: inv, InputDate: '2026-11-04' });
function fakeQuery(rows) {
  return async (sqlText, params) => {
    assert.match(sqlText, /^\/\* native-shared-cost:readonly-source \*\/ SELECT/); assert.doesNotMatch(sqlText, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
    assert.equal(params.orderYear.value, '2026'); assert.equal(params.orderWeek.value, '45-01');
    return { recordset: rows };
  };
}
function weekRows() {
  wd = 0;
  const r = [];
  const add = (key, farm, inv, lines) => lines.forEach(l => r.push({ ...head(key, farm, inv), ...l }));
  add(7902, 'Ayura', '17655', [line(7902, 'CARNATION Caramel', '카네이션', 10, 3000, 0.19), line(7902, 'ROSE / Mondial White 60cm', '장미', 4, 800, 0.43, 10)]);
  add(7903, 'El Cactus', 'FC68120', [line(7903, 'ALSTROMERIA Mix', '알스트로', 3, 480, 0.3, 10), line(7903, 'Ruscus Italian', '루스커스', 2, 2000, 0.1, 10)]);
  add(7904, 'Freight Co', 'F1', []); // 빈 입고는 무시
  add(7936, 'Antioquia Floral S.A.S', '8256', [line(7936, 'Hydrangea White', '수국', 8, 800, 0.66, 1)]);
  add(7937, 'C.I Flores Balverde S.A.S', '25547', [line(7937, 'Hydrangea Blue', '수국', 7, 700, 0.85, 1)]);
  return r;
}
const request = (scope, extra = {}) => ({ orderYear: '2026', orderWeek: '45-01', awb: '160-17338005', scope, ...extra });

test('추천 품종은 제안일 뿐이며 근거가 없으면 비워 둔다', () => {
  assert.equal(suggestGroup('카네이션', 'CARNATION X'), 'CARNATION'); assert.equal(suggestGroup('', 'Hydrangea White'), 'HYDRANGEA');
  assert.equal(suggestGroup('', 'Cordyline Red'), ''); assert.equal(suggestGroup('장미', 'ROSE A'), 'ROSE');
});

test('범위 분리: 콜카장은 수국 농장을 제외하고, 수국은 수국 농장만 묶는다', async () => {
  const rows = weekRows();
  const main = await prepareNativeShared({ queryFn: fakeQuery(rows), types, request: request('MAIN') });
  assert.deepEqual(main.members.map(m => m.farmName), ['Ayura', 'El Cactus']);
  assert.equal(main.members[0].rows.length, 2); assert.equal(main.members[0].rows[0].unit, 'STEM'); assert.equal(main.members[0].rows[0].actualQuantity, 3000);
  assert.equal(main.members[0].lineInputs[0].groupId, ''); assert.equal(main.members[0].lineInputs[0].suggestedGroupId, 'CARNATION'); // 확정은 사용자가
  assert.equal(main.members[0].lineInputs[0].stemsPerBunch, 20);
  const hy = await prepareNativeShared({ queryFn: fakeQuery(rows), types, request: request('HYDRANGEA') });
  assert.deepEqual(hy.members.map(m => m.farmName), ['Antioquia Floral S.A.S', 'C.I Flores Balverde S.A.S']);
  // 품종 선택(lineInputs)이 바뀌어도 원본 기준 지문은 같다.
  const edited = await prepareNativeShared({ queryFn: fakeQuery(rows), types, request: request('MAIN', { lineInputs: [{ lineId: main.members[0].lineInputs[0].lineId, groupId: 'CARNATION' }] }) });
  assert.equal(edited.baselineDigest, main.baselineDigest); assert.equal(edited.members[0].lineInputs[0].groupId, 'CARNATION');
  rows[0].SteamQuantity += 1; // 입고가 바뀌면 지문이 달라진다
  assert.notEqual((await prepareNativeShared({ queryFn: fakeQuery(rows), types, request: request('MAIN') })).baselineDigest, main.baselineDigest);
});

test('잘못된 요청·섞인 입고는 계산 전에 막는다', async () => {
  const rows = weekRows();
  await assert.rejects(prepareNativeShared({ queryFn: fakeQuery(rows), types, request: request('MAIN', { awb: '123' }) }), /AWB/);
  await assert.rejects(prepareNativeShared({ queryFn: fakeQuery(rows), types, request: request('ALL') }), /범위/);
  const mixed = weekRows(); mixed.push({ ...head(7902, 'Ayura', '17655'), ...line(7902, 'Hydrangea White', '수국', 1, 100, 1, 1) });
  await assert.rejects(prepareNativeShared({ queryFn: fakeQuery(mixed), types, request: request('MAIN') }), /수국과 다른 품종/);
  const foreign = weekRows(); foreign.push({ ...head(7902, 'Ayura', '17655'), ...line(7902, 'Tulip', '튤립', 1, 100, 1, 10, '네덜란드') });
  await assert.rejects(prepareNativeShared({ queryFn: fakeQuery(foreign), types, request: request('MAIN') }), /콜롬비아가 아닌/);
});

async function runDownload(scope, groupOf, extraInput = {}, { append = false, masterKey } = {}) {
  const rows = weekRows(), queryFn = fakeQuery(rows);
  const prepare = args => prepareNativeShared(args); // 핸들러가 { queryFn, types, request }를 넘긴다
  const first = await prepare({ queryFn, types, request: request(scope) });
  const lineInputs = first.members.flatMap(m => m.lineInputs.map(l => ({ ...l, groupId: groupOf(l) })));
  const body = { action: 'download', ...request(scope), baselineDigest: first.baselineDigest, completeManifestConfirmed: true, lineInputs, appendToMaster: append,
    input: { gw: 1000, cw: 1000, freightAmount: 500, freightCurrency: 'USD', exchangeRate: 1550, customsTotalKRW: 100000, exchangeRateType: 'TEST_ONLY', ...extraInput } };
  const r = response(); await createSharedAwbHandler({ authorize: () => true, prepare, queryFn, types })({ method: 'POST', body }, r);
  return { r, first };
}

test('콜카장 4품종: 환산 박스수가 없으면 계산하지 않고, 입력하면 농장별 행이 있는 엑셀이 나온다', async () => {
  const groupOf = l => l.suggestedGroupId;
  let { r } = await runDownload('MAIN', groupOf);
  assert.equal(r.code, 422); assert.match(r.data.error, /FB 환산 박스수/);
  const fb = { fullBoxCounts: { ROSE: 40, CARNATION: 100, ALSTROMERIA: 30, RUSCUS: 20 } };
  ({ r } = await runDownload('MAIN', groupOf, fb));
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const book = XLSX.read(r.body, { cellFormula: true });
  assert.ok(book.SheetNames.includes('원본 양식 계산'));
  const sheet = book.Sheets['원본 양식 계산'];
  const farms = Object.keys(sheet).filter(k => /^A\d+$/.test(k) && Number(k.slice(1)) >= 15).map(k => sheet[k].v);
  assert.deepEqual(farms, ['Ayura', 'Ayura', 'El Cactus', 'El Cactus']);
  const names = Object.keys(sheet).filter(k => /^B\d+$/.test(k) && Number(k.slice(1)) >= 15).map(k => sheet[k].v);
  assert.deepEqual(names, ['CARNATION Caramel', 'ROSE / Mondial White 60cm', 'ALSTROMERIA Mix', 'Ruscus Italian']); // 농장 접두어 없음(원본 양식)
  assert.equal(sheet.AC8.v, 40); assert.equal(sheet.AC9.v, 100); // 시트 박스 수량 = 환산 박스수
  assert.equal(sheet.N15.v, 20); assert.equal(sheet.N16.v, 10);
});

test('품종을 확정하지 않은 행이 있으면 계산이 막힌다', async () => {
  const { r } = await runDownload('MAIN', () => '', { fullBoxCounts: { ROSE: 1 } });
  assert.equal(r.code, 422); assert.match(r.data.error, /품종 분류/);
});

test('누적 반영: 콜카장은 콜카장 파일, 수국은 수국 파일에만 붙고 서로 섞이지 않는다', { skip: !fs.existsSync(SAMPLE) }, async () => {
  process.env.COST_MASTER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-master-'));
  const original = fs.readFileSync(SAMPLE);
  await store.writeMaster('CO', original);
  // 수국 파일이 없으면 수국 계산은 콜카장 파일을 건드리지 않고 막힌다.
  let { r } = await runDownload('HYDRANGEA', l => l.suggestedGroupId, {}, { append: true });
  assert.equal(r.code, 409); assert.match(r.data.error, /수국 누적 원가자료/);
  assert.equal(Buffer.compare(await store.readMaster('CO'), original), 0);
  ({ r } = await runDownload('MAIN', l => l.suggestedGroupId, { fullBoxCounts: { ROSE: 40, CARNATION: 100, ALSTROMERIA: 30, RUSCUS: 20 } }, { append: true }));
  assert.equal(r.code, 200, JSON.stringify(r.data)); assert.equal(r.headers['X-Cost-Master-Key'], 'CO'); assert.equal(r.headers['X-Cost-Master-Replaced'], 'true');
  const before = XLSX.read(original), after = XLSX.read(r.body);
  assert.deepEqual(after.SheetNames, before.SheetNames);
  for (const name of before.SheetNames.filter(n => n !== '45-1')) assert.equal(JSON.stringify(after.Sheets[name]), JSON.stringify(before.Sheets[name]), name);
  assert.equal(after.Sheets['45-1'].A15.v, 'Ayura');
  // 수국 파일을 올려 두면 수국 계산은 그 파일에만 붙는다.
  await store.writeMaster('CO_HYDRANGEA', original);
  ({ r } = await runDownload('HYDRANGEA', l => l.suggestedGroupId, {}, { append: true }));
  assert.equal(r.code, 200, JSON.stringify(r.data)); assert.equal(r.headers['X-Cost-Master-Key'], 'CO_HYDRANGEA');
  assert.equal(XLSX.read(await store.readMaster('CO_HYDRANGEA')).Sheets['45-1'].A15.v, 'Antioquia Floral S.A.S');
  assert.equal(XLSX.read(await store.readMaster('CO')).Sheets['45-1'].A15.v, 'Ayura'); // 콜카장 파일은 그대로
});
