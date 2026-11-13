import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import * as store from '../lib/costMasterStore.js';
import { createCostMasterHandler } from '../lib/costMasterHttp.js';
import { prepareSharedAwb, createSharedAwbHandler } from '../lib/invoiceSharedAwbApi.js';

const SAMPLE = 'C:/Users/USER/Downloads/45-1 콜카장 원가자료.xlsx';
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-master-')); process.env.COST_MASTER_DIR = dir; return dir; };
const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; }, send(b) { this.body = b; }, end() {} });

function fixture() {
  const docs = Array.from({ length: 13 }, (_, i) => ({ documentId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, revision: 1, sourceHash: 'a'.repeat(64), orderYear: '2026', orderWeek: '45-01', invoiceNo: `INV${i}`,
    reviewedMetadata: { country: 'CO', transportMode: 'AIR', awb: '160-17338005', farmName: `FARM${i}`, inputDate: '2026-10-30' },
    lines: [{ lineId: `11111111-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, prodKey: i + 1, originalName: 'Hydrangea White', outQuantity: 10, outUnit: '박스', priceUnit: '송이', currency: 'USD', unitPrice: 1, lineAmount: 300, boxQuantity: 10, bunchQuantity: null, stemQuantity: 300 }] }));
  return { docs, request: { orderYear: '2026', orderWeek: '45-01', awb: '16017338005' },
    queryFn: async () => ({ recordset: docs.map(d => ({ DocumentId: d.documentId })) }),
    readDocument: async ({ documentId }) => docs.find(d => d.documentId === documentId),
    readReceipt: async ({ document }) => ({ operation: { warehouseKey: docs.indexOf(document) + 1 }, lines: document.lines }),
    types: { Char: () => 1, VarChar: () => 1 } };
}
async function downloadBody() {
  const f = fixture(), p = await prepareSharedAwb(f);
  for (const member of p.members) for (const setting of member.lineInputs) { setting.groupId = 'HYDRANGEA'; if (!(setting.stemsPerBunch > 0)) setting.stemsPerBunch = 20; }
  return { p, body: { action: 'download', orderYear: '2026', orderWeek: '45-01', awb: '16017338005', baselineDigest: p.baselineDigest, completeManifestConfirmed: true,
    input: { gw: 3483, cw: 4307, freightAmount: 12777.65, freightCurrency: 'USD', exchangeRate: 1400, customsTotalKRW: 1000, exchangeRateType: 'TEST_ONLY' } } };
}

test('차수 이름은 누적 파일 표기(45-1)로 바뀐다', () => {
  assert.equal(store.weekSheetName('45-01'), '45-1'); assert.equal(store.weekSheetName('08-02'), '8-2');
  assert.throws(() => store.weekSheetName('45-1A'));
});

test('누적 파일은 최초 1회 올리고, 교체 확인 없이는 덮어쓰지 않으며 이전 파일은 백업된다', { skip: !fs.existsSync(SAMPLE) }, async () => {
  const dir = tmp(); const handler = createCostMasterHandler({ authorize: () => true });
  const file = fs.readFileSync(SAMPLE).toString('base64');
  let r = response(); await handler({ method: 'GET', query: {} }, r); assert.equal(r.data.exists, false);
  r = response(); await handler({ method: 'POST', body: { action: 'seed', fileBase64: file } }, r);
  assert.equal(r.code, 200); assert.equal(r.data.sheetNames.length, 47); assert.equal(r.data.sheetNames.at(-1), '45-1');
  r = response(); await handler({ method: 'POST', body: { action: 'seed', fileBase64: file } }, r); assert.equal(r.code, 409);
  r = response(); await handler({ method: 'POST', body: { action: 'seed', fileBase64: file, replace: true } }, r); assert.equal(r.code, 200);
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
  r = response(); await handler({ method: 'POST', body: { action: 'seed', fileBase64: Buffer.from('not xlsx').toString('base64'), replace: true } }, r); assert.equal(r.code, 422);
  r = response(); await createCostMasterHandler({ authorize: () => false })({ method: 'GET', query: {} }, r); assert.equal(r.code, 403);
});

test('공동 AWB 다운로드 + 누적 반영: 과거 47개 시트는 유지되고 이번 차수 시트가 농장별 행으로 교체·반영된다', { skip: !fs.existsSync(SAMPLE) }, async () => {
  tmp(); const original = fs.readFileSync(SAMPLE);
  await store.writeMaster('CO_HYDRANGEA', original); // 13농장 수국 공동 AWB는 수국 누적 파일로 간다
  const { p, body } = await downloadBody();
  const handler = createSharedAwbHandler({ authorize: () => true, prepare: async () => p });
  const r = response(); await handler({ method: 'POST', body: { ...body, appendToMaster: true } }, r);
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.equal(r.headers['X-Cost-Master-Replaced'], 'true'); // 샘플에는 이미 45-1 시트가 있다
  const before = XLSX.read(original), after = XLSX.read(r.body, { cellFormula: true });
  assert.deepEqual(after.SheetNames, before.SheetNames);
  for (const name of before.SheetNames.filter(n => n !== '45-1')) assert.equal(JSON.stringify(after.Sheets[name]), JSON.stringify(before.Sheets[name]), name);
  const sheet = after.Sheets['45-1'];
  const farms = new Set(Object.keys(sheet).filter(k => /^A\d+$/.test(k) && Number(k.slice(1)) >= 15).map(k => sheet[k].v));
  assert.equal(farms.size, 13); for (let i = 0; i < 13; i++) assert.ok(farms.has(`FARM${i}`), `FARM${i}`);
  assert.ok(Object.values(sheet).some(c => c?.f));
  // 서버에 보관된 파일도 같은 내용으로 갱신되었다.
  assert.deepEqual(XLSX.read(await store.readMaster('CO_HYDRANGEA')).SheetNames, before.SheetNames);
  assert.equal(await store.readMaster('CO'), null); // 콜카장 파일은 만들어지지도 바뀌지도 않는다
});

test('다음 차수(46-01)는 새 시트로 뒤에 붙고 다시 실행하면 그 시트만 교체된다', { skip: !fs.existsSync(SAMPLE) }, async () => {
  tmp(); await store.writeMaster('CO_HYDRANGEA', fs.readFileSync(SAMPLE));
  const f = fixture(); for (const d of f.docs) d.orderWeek = '46-01';
  f.request.orderWeek = '46-01';
  const p = await prepareSharedAwb(f); for (const member of p.members) for (const setting of member.lineInputs) { setting.groupId = 'HYDRANGEA'; if (!(setting.stemsPerBunch > 0)) setting.stemsPerBunch = 20; }
  const body = { action: 'download', orderYear: '2026', orderWeek: '46-01', awb: '16017338005', baselineDigest: p.baselineDigest, completeManifestConfirmed: true, appendToMaster: true,
    input: { gw: 3483, cw: 4307, freightAmount: 12777.65, freightCurrency: 'USD', exchangeRate: 1400, customsTotalKRW: 1000, exchangeRateType: 'TEST_ONLY' } };
  const handler = createSharedAwbHandler({ authorize: () => true, prepare: async () => p });
  let r = response(); await handler({ method: 'POST', body }, r); assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.equal(r.headers['X-Cost-Master-Replaced'], 'false');
  let names = XLSX.read(r.body).SheetNames; assert.equal(names.length, 48); assert.equal(names.at(-1), '46-1');
  r = response(); await handler({ method: 'POST', body }, r); assert.equal(r.code, 200);
  assert.equal(r.headers['X-Cost-Master-Replaced'], 'true'); assert.equal(XLSX.read(r.body).SheetNames.length, 48);
});

test('서버에 누적 파일이 없으면 409로 막고 아무것도 쓰지 않는다', async () => {
  const dir = tmp(); const { p, body } = await downloadBody();
  const r = response(); await createSharedAwbHandler({ authorize: () => true, prepare: async () => p })({ method: 'POST', body: { ...body, appendToMaster: true } }, r);
  assert.equal(r.code, 409); assert.match(r.data.error, /누적 원가자료/); assert.deepEqual(fs.readdirSync(dir), []);
});
