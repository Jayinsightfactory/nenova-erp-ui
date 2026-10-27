import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { readNativeCostSource, calculateNativeCost, nativeCostDocument } from '../lib/nativeReceiptCost.js';
import { createNativeCostWorkbook, createInvoiceCostWorkbook } from '../lib/invoiceReceiptCostExport.js';
import { invoiceCostExportFixture } from './invoiceReceiptCostExport.test.js';
import { createNativeCostHandler } from '../lib/nativeCostHttp.js';

const types = { Int: 'int', NVarChar: n => `nvarchar(${n})` };
async function fixture(formulaId) {
  const f = invoiceCostExportFixture(3, formulaId);
  const details = f.snapshot.receiptSnapshot.details;
  const raw = f.document.lines.map((line, i) => ({ WarehouseKey: 901, OrderYear: f.document.orderYear, OrderWeek: f.document.orderWeek,
    FarmName: 'Fixture farm', InvoiceNo: 'fixture', InputDate: f.document.reviewedMetadata.inputDate,
    GrossWeight: f.document.reviewedMetadata.gw, ChargeableWeight: f.document.reviewedMetadata.cw,
    WdetailKey: details[i].wdetailKey, ProdKey: line.prodKey, ProdName: line.originalName, CounName: f.document.reviewedMetadata.country,
    FlowerName: 'fixture', OutUnit: f.document.operations[0].result.lineMappings[i].unit,
    BoxQuantity: details[i].boxQuantity ?? details[i].outQuantity * ({ 단: 1 / 20, 송이: 1 / 100, 박스: 1 }[f.document.operations[0].result.lineMappings[i].unit]),
    BunchQuantity: details[i].outQuantity * ({ 단: 1, 송이: 1 / 5, 박스: 20 }[f.document.operations[0].result.lineMappings[i].unit]),
    SteamQuantity: details[i].stemQuantity ?? details[i].outQuantity * ({ 단: 5, 송이: 1, 박스: 100 }[f.document.operations[0].result.lineMappings[i].unit]), OutQuantity: details[i].outQuantity,
    UPrice: line.unitPrice, TPrice: line.lineAmount, SteamOf1Bunch: 5, SteamOf1Box: 100 }));
  let calls = 0;
  const queryFn = async (sql, params) => {
    calls++; assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    assert.match(sql, /wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek/);
    assert.doesNotMatch(sql, /wd.isDeleted|p.isDeleted/);
    return { recordset: raw.filter(row => row.OrderYear === params.orderYear.value && row.OrderWeek === params.orderWeek.value && row.WarehouseKey === params.warehouseKey.value) };
  };
  const scope = { orderYear: f.document.orderYear, orderWeek: f.document.orderWeek, warehouseKey: 901 };
  const source = await readNativeCostSource({ queryFn, types, input: scope });
  const request = { ...scope, sourceHash: source.sourceHash, metadata: { currency: f.snapshot.input.nativeCurrency, transportMode: f.document.reviewedMetadata.transportMode },
    input: { ...f.snapshot.input, lineInputs: f.snapshot.input.lineInputs.map((line, i) => ({ ...line, lineId: source.lines[i].lineId })) } };
  return { f, source, request, queryFn, calls, raw };
}

for (const formula of ['CN_AIR_WEIGHT_CBM_V1','CN_SEA_ACTUAL_V1','NL_AMOUNT_V1','US_CNF_BOX_V1','VN_CNF_STEM_V1','AU_CNF_BUNCH_V1','NZ_CNF_STEM_V1','EC_FOB_STEM_V1','CO_GROUP_42_1_V1','TH_GROUP_BOX_SHARE_V1']) {
  test(`native receipt without invoice document calculates and exports ${formula}`, async () => {
    const { f, source, request } = await fixture(formula), before = JSON.stringify(source);
    const result = calculateNativeCost(source, request);
    assert.equal(result.preview.status, 'APPROVED', JSON.stringify(result.preview.issues));
    assert.equal(result.document.receiptStatus, 'NATIVE_READONLY');
    assert.equal(result.preview.totals.totalCostKRW, f.revision.totalCostKRW);
    const bytes = await createNativeCostWorkbook(result), book = XLSX.read(bytes);
    assert.ok(book.SheetNames.length >= 2);
    assert.match(book.Sheets[book.SheetNames[0]].B1.v, /미승인 계산본/);
    assert.equal(JSON.stringify(source), before);
    await assert.rejects(() => createInvoiceCostWorkbook({ document: result.document, revision: f.revision, snapshot: f.snapshot }));
  });
}
test('AU existing receipt preserves saved shipment total instead of multiplying saved UPrice by bunches', async () => {
  const {source,request}=await fixture('AU_CNF_BUNCH_V1');
  source.lines=[{...source.lines[0],originalName:'Wolly Bush Red Tip',bunchQuantity:120,stemQuantity:600,boxQuantity:4,outQuantity:120,outUnit:'단',unitPrice:8.5,lineAmount:5100}];
  source.lines[0].stemsPerBox=30;
  const defaults=nativeCostDocument(source,request.metadata).reviewedMetadata.invoiceCostInput.lineInputs[0];
  assert.equal(defaults.bunchesPerBox,30);assert.equal(defaults.stemsPerBunch,5);
  request.input.lineInputs=[{...request.input.lineInputs[0],...defaults}];
  const before=JSON.stringify(source), result=calculateNativeCost(source,request);
  assert.equal(result.preview.status,'APPROVED',JSON.stringify(result.preview.issues));
  assert.equal(result.document.lines[0].unitPrice,42.5);
  assert.equal(result.document.lines[0].nativeStoredUnitPrice,8.5);
  assert.equal(result.preview.lines[0].componentAmounts.cnfNative,5100);
  assert.equal(JSON.stringify(source),before);
  const book=XLSX.read(await createNativeCostWorkbook(result));
  const values=Object.values(book.Sheets[book.SheetNames[0]]).map(c=>c?.v);
  assert.ok(values.includes(5100));assert.ok(values.includes(42.5));
  assert.ok(values.some(v=>typeof v==='string'&&v.includes('저장총액')));
});

test('native scope, stale receipt, missing exchange rate, wrong formula and explicit zero remain guarded', async () => {
  const { source, request, queryFn } = await fixture('CN_SEA_ACTUAL_V1');
  await assert.rejects(() => readNativeCostSource({ queryFn, types, input: { ...request, orderYear: '2025' } }), /입고 상세/);
  assert.throws(() => calculateNativeCost(source, { ...request, sourceHash: 'stale' }), /변경/);
  assert.throws(() => calculateNativeCost(source, { ...request, metadata: { ...request.metadata, transportMode: 'AIR' } }), /일치/);
  const missing = calculateNativeCost(source, { ...request, input: { ...request.input, exchangeRateKRW: null } });
  assert.equal(missing.preview.status, 'REVIEW_REQUIRED');
  await assert.rejects(() => createNativeCostWorkbook(missing), /환율/);
  const zero = calculateNativeCost(source, { ...request, input: { ...request.input, freightAmount: 0 } });
  assert.equal(zero.preview.status, 'APPROVED');
});
test('native API and component expose calculation/export only, not approval or receipt writes', () => {
  const api = readFileSync(new URL('../pages/api/import/receipts/native-cost.js', import.meta.url), 'utf8');
  assert.doesNotMatch(api, /saveInvoice|commitInvoice|withTransaction|INSERT|UPDATE|DELETE|uspStock/);
  assert.match(api, /canManageInvoiceReceipt/);
  const ui = readFileSync(new URL('../components/import-tools/NativeReceiptCost.js', import.meta.url), 'utf8');
  assert.match(ui, /nativePreview onNativeAction/);
  assert.doesNotMatch(ui, /autoSaveRequested|cost-revisions|\/commit/);
});

test('actual HTTP handler enforces access/methods, exports binary and blocks concurrent receipt changes', async () => {
  const f = await fixture('CN_SEA_ACTUAL_V1');
  const response = () => ({ code:200, headers:{}, setHeader(k,v){this.headers[k]=v;}, status(n){this.code=n;return this;},
    json(v){this.body=v;return this;}, send(v){this.body=v;return this;}, end(){return this;} });
  const handler = createNativeCostHandler({ queryFn:f.queryFn, types, authorize:user=>user?.allowed===true });
  const denied=response();await handler({method:'GET',query:f.request},denied);assert.equal(denied.code,403);
  const bad=response();await handler({method:'DELETE',user:{allowed:true}},bad);assert.equal(bad.code,405);
  const good=response();await handler({method:'POST',user:{allowed:true},body:{...f.request,action:'download'}},good);
  assert.equal(good.code,200);assert.ok(Buffer.isBuffer(good.body));assert.equal(good.headers['Cache-Control'],'no-store');
  const invalid=response();await handler({method:'POST',user:{allowed:true},body:{...f.request,action:'approve'}},invalid);assert.equal(invalid.code,400);
  const raced=createNativeCostHandler({queryFn:f.queryFn,types,authorize:()=>true,generate:async result=>{
    const bytes=await createNativeCostWorkbook(result);f.raw[0].TPrice++;return bytes;
  }});
  const conflict=response();await raced({method:'POST',body:{...f.request,action:'download'}},conflict);assert.equal(conflict.code,409);
  const broken=createNativeCostHandler({queryFn:async()=>{throw Error('SQL password SECRET');},types,authorize:()=>true});
  const masked=response();await broken({method:'GET',query:f.request},masked);assert.equal(masked.code,503);assert.doesNotMatch(JSON.stringify(masked.body),/SECRET|password/);
});

test('weight rows are separated, conflicts stay missing, zero header is preserved and forged goods are ignored', async () => {
  const f=await fixture('CN_SEA_ACTUAL_V1');
  for(const row of f.raw){row.GrossWeight=null;row.ChargeableWeight=0;}
  f.raw.push({...f.raw[0],WdetailKey:9991,ProdName:'Gross weight',OutQuantity:123,BoxQuantity:0,BunchQuantity:123,SteamQuantity:123});
  const source=await readNativeCostSource({queryFn:f.queryFn,types,input:f.request});
  assert.equal(source.gw,123);assert.equal(source.cw,0);assert.equal(source.lines.length,3);assert.equal(source.excluded.length,1);
  const request={...f.request,sourceHash:source.sourceHash,lines:[{lineAmount:999999}]};
  assert.equal(calculateNativeCost(source,request).preview.totals.totalCostKRW,f.f.revision.totalCostKRW);
  f.raw.at(-1).SteamQuantity=456;
  assert.equal((await readNativeCostSource({queryFn:f.queryFn,types,input:f.request})).gw,null);
  await assert.rejects(()=>readNativeCostSource({queryFn:f.queryFn,types,input:{...f.request,warehouseKey:['901']}}),/입고 번호/);
  assert.throws(()=>calculateNativeCost(source,{...request,metadata:{...request.metadata,gw:true}}),/GW/);
});
