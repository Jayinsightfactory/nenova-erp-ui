import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import XLSX from 'xlsx-js-style';
import { generatePedidos, generatePedidosFromMatrix, readPedidosWorkbook, serializePedidosWorkbook } from '../lib/importPedidos.js';
import { prepareCountryOrderPedidos } from '../lib/countryOrderPedidosAdapter.js';
import { buildCountryOrderMatrix, COUNTRY_ORDER_COUNTRIES } from '../lib/countryOrderSource.js';
const matrix = (country = 'Netherlands', unit = 'stems') => ({ source: 'erp', scope: { country, year: 2026, orderWeek: '42-01' }, customers: [{ key: '1', code: 'CL21', name: '업체', label: 'CL21' }], rows: [{ key: `10|${unit}`, prodKey: 10, name: 'Tulip A', flower: '장미', unit, quantities: { 1: 200 }, total: 200 }], warnings: [], blockers: [] });
const workbook = rows => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Source'); return wb; };

test('ERP Netherlands stored stems pass through existing Holex/EZ workbook builder and roundtrip', () => {
  const input = matrix(), before = JSON.stringify(input), output = generatePedidosFromMatrix(input)[0];
  assert.equal(output.filename, '42-01_Holex.xlsx'); assert.equal(output.totalQuantity, 200);
  assert.equal(output.unit, 'stems'); assert.equal(output.workbook.Sheets['Holex 42-01']['!freeze'], 'B4');
  const saved = readPedidosWorkbook(serializePedidosWorkbook(output.workbook)).Sheets['Holex 42-01'];
  assert.equal(saved.B4.v, 200); assert.equal(saved.C4.f, 'SUM(B4:B4)'); assert.equal(saved.C5.v, 200);
  assert.equal(JSON.stringify(input), before);
  input.rows[0].name = '[EZ] hyacinth'; assert.equal(generatePedidosFromMatrix(input)[0].filename, '42-01_EZ.xlsx');
});

test('duplicate customer codes, missing code and duplicate product names stay separate by identities', () => {
  const input = matrix();
  input.customers.push({ key: '2', code: 'cl21', name: '다른 업체' }, { key: '3', code: '', name: '코드 없음' });
  input.rows[0].quantities = { 1: 100, 2: 80, 3: 20 };
  input.rows.push({ ...input.rows[0], key: '11|stems', prodKey: 11, quantities: { 1: 20, 2: 30, 3: 0 }, total: 50 });
  const output = generatePedidosFromMatrix(input)[0];
  assert.equal(output.itemCount, 2); assert.equal(output.totalQuantity, 250);
  assert.deepEqual(output.cls, ['CL21 [CustKey:1]', 'cl21 [CustKey:2]', '코드 없음']);
  assert.match(output.preview.rows[0][0], /ProdKey:10/); assert.match(output.preview.rows[1][0], /ProdKey:11/);
});

test('five non-CL customers retain every product and converted stem cell through XLSX roundtrip', () => {
  const customers = [[686,'양재동'],[340,'다원플라워'],[420,'성남원예'],[690,'호텔여분'],[584,'주식회사 코벤트원예']];
  for (const country of Object.keys(COUNTRY_ORDER_COUNTRIES)) {
    const raw = customers.flatMap(([CustKey,CustName], i) => [1,2].map(n => ({OrderYear:2026,OrderWeek:'47-02',CustKey,CustName,CustOrderCode:'',ProdKey:n,ProdName:n===1?'Alpha':'Beta',FlowerName:'장미',CounName:COUNTRY_ORDER_COUNTRIES[country],OutUnit:'단',OutQuantity:(i+1)*n,BunchQuantity:(i+1)*n,SteamQuantity:(i+1)*n*10,BoxQuantity:0,SteamOf1Bunch:10})));
    const response={success:true,readOnly:true,scope:{country,counName:COUNTRY_ORDER_COUNTRIES[country],year:2026,majorWeek:'47',scopeKey:`${country}/2026/47`},subweeks:[{orderWeek:'47-02'}],rows:[...raw,{...raw[0],OrderYear:2025,SteamQuantity:99999}],warnings:[]};
    const input=buildCountryOrderMatrix(response,'47-02');
    assert.equal(input.customers.length,5);assert.equal(input.rows.length,2);assert.deepEqual(input.warnings,[]);assert.deepEqual(input.blockers,[]);
    const outputs=generatePedidosFromMatrix(input);
    assert.equal(outputs.reduce((sum,out)=>sum+out.itemCount,0),2);
    assert.equal(outputs.reduce((sum,out)=>sum+out.totalQuantity,0),['Netherlands','Vietnam'].includes(country)?450:45);
    const saved=readPedidosWorkbook(serializePedidosWorkbook(outputs[0].workbook));
    const sheet=saved.Sheets[saved.SheetNames[0]];
    if(['Netherlands','China','NewZealand','Japan','USA','Israel','Ethiopia'].includes(country)){
      const header=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true})[2];
      for(const [key,name]of customers){const col=header.indexOf(name);assert.ok(col>0);for(let n=1;n<=2;n++){assert.equal(sheet[XLSX.utils.encode_cell({r:n+2,c:col})].v,input.rows.find(r=>r.prodKey===n).quantities[String(key)]);}}
    }
    assert.ok(!JSON.stringify(outputs[0].preview).includes('코드미등록'));
  }
});

test('blank-code names colliding with each other or real codes never merge customer columns',()=>{
  const input=matrix();input.customers=[{key:'1',code:'',name:'CL21'},{key:'2',code:'CL21',name:'other'},{key:'3',code:'',name:'CL21'}];
  input.rows[0].quantities={1:50,2:60,3:90};
  const out=generatePedidosFromMatrix(input)[0];assert.equal(out.cls.length,3);assert.equal(out.totalQuantity,200);
  assert.deepEqual(out.cls,['CL21 [CustKey:1]','CL21 [CustKey:2]','CL21 [CustKey:3]']);
});

test('export rejects blockers, wrong provenance, invalid identity, nonfinite quantity and mismatched totals', () => {
  for (const mutate of [m => m.blockers.push('STEM_QUANTITY_UNAVAILABLE'), m => m.source = 'upload', m => m.rows.push(m.rows[0]), m => m.customers.push(m.customers[0]), m => m.rows[0].quantities[1] = NaN, m => m.rows[0].total = 199, m => m.rows[0].unit = 'bunches', m => m.rows[0].quantities[99] = 1]) {
    const input = matrix(); mutate(input); assert.throws(() => generatePedidosFromMatrix(input));
  }
});

test('all other ERP countries reuse existing templates and enforce Colombia output units', () => {
  const expectations = [['Australia', 'bunches', 'Australia'], ['Thailand', 'bunches', 'Thailand'], ['Ecuador', 'stems', 'Ecuador'], ['Vietnam', 'stems', 'Royal_base'], ['Colombia', 'bunches', 'Rosas'], ['China', 'bunches', 'Melody']];
  for (const [country, unit, label] of expectations) {
    const output = generatePedidosFromMatrix(matrix(country, unit))[0];
    assert.equal(output.filename, `42-01_${label}.xlsx`); assert.equal(output.totalQuantity, 200);
    assert.ok(serializePedidosWorkbook(output.workbook).length > 0);
  }
  const input = matrix('Colombia', 'stems'); assert.throws(() => prepareCountryOrderPedidos(input), /단위/);
  input.rows[0].unit = 'boxes'; input.rows[0].flower = '카네이션';
  assert.equal(generatePedidosFromMatrix(input)[0].filename, '42-01_Clavel.xlsx');
});

test('China ERP mixed units stay separate with unchanged Melody naming and no conversion', () => {
  const input = matrix('China', 'bunches');
  input.rows.push({ ...input.rows[0], key: '10|stems', unit: 'stems', total: 150, quantities: { 1: 150 } });
  const outputs = generatePedidosFromMatrix(input);
  assert.deepEqual(outputs.map(output => [output.filename, output.totalQuantity]), [['42-01_Melody_단.xlsx', 200], ['42-01_Melody_송이.xlsx', 150]]);
  assert.equal(outputs[0].sourceAdapter, 'country-order-matrix-v1');
  assert.deepEqual(outputs[0].sourceScope, input.scope);
});

test('Australia duplicate display suffix preserves exact original-name box divisor', () => {
  const input = matrix('Australia', 'bunches');
  input.rows[0].name = 'Fern Umbrella'; input.rows[0].total = 50; input.rows[0].quantities = { 1: 50 };
  input.rows.push({ ...input.rows[0], key: '11|bunches', prodKey: 11, total: 100, quantities: { 1: 100 } });
  const output = generatePedidosFromMatrix(input)[0];
  assert.equal(output.itemCount, 2); assert.deepEqual(output.preview.rows.map(row => row[2]), [1, 2]);
  assert.equal(output.warnings.length, 0); assert.match(output.preview.rows[0][0], /ProdKey:10/);
});

test('uploaded Netherlands C-column product header and prefix CL families are numeric pass-through', () => {
  const codes = ['BCL16', 'CL21', 'KCL03', 'HCL07', 'MCL73', 'YCLS'];
  const input = workbook([['국가', null, '품목명(색상)'], [null, null, null, ...codes], ['네덜란드', null, 'tulip hyacinth skimmia eucalyptus', 1, 2, 3, 4, 5, 6], ['네덜란드 Total']]);
  const output = generatePedidos(input, 'Netherlands', '42-01')[0];
  assert.equal(output.totalQuantity, 21); assert.deepEqual(output.cls, [...codes].sort());
  assert.equal(output.preview.rows[0][0], 'tulip hyacinth skimmia eucalyptus');
  input.Sheets.Source.C3.v = 'changed name'; assert.equal(generatePedidos(input, 'Netherlands', '42-01')[0].totalQuantity, 21);
});

test('uploaded totals precedence is case-insensitive and unknown numeric header remains visible with address warning', () => {
  const output = generatePedidos(workbook([['country'], ['name', 'cl21', 'CL21 Total', 'UNLISTED7'], ['Lily', 999, 4, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(output.totalQuantity, 10); assert.deepEqual(output.cls, ['UNLISTED7', 'cl21']);
  assert.match(output.warnings.join(' '), /Source!D2.*UNRECOGNIZED_CUSTOMER_CODE/);
});

test('unknown ABC Total is retained and unknown raw plus total obey precedence', () => {
  const onlyTotal = generatePedidos(workbook([['country'], ['name', 'CL1', 'ABC Total'], ['Lily', 1, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(onlyTotal.totalQuantity, 7); assert.deepEqual(onlyTotal.cls, ['ABC', 'CL1']);
  assert.match(onlyTotal.warnings.join(' '), /Source!C2.*UNRECOGNIZED_CUSTOMER_CODE.*ABC/);
  const rawAndTotal = generatePedidos(workbook([['country'], ['name', 'CL1', 'abc', 'ABC Total'], ['Lily', 1, 999, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(rawAndTotal.totalQuantity, 7); assert.deepEqual(rawAndTotal.cls, ['CL1', 'abc']);
});

test('case-insensitive repeated Netherlands raw codes sum while first literal is preserved', () => {
  const output = generatePedidos(workbook([['country'], ['name', 'kcl03', 'KCL03'], ['Lily', 2, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(output.totalQuantity, 8); assert.deepEqual(output.cls, ['kcl03']);
  assert.equal(output.preview.rows[0][1], 8);
});

test('ambiguous uploaded product columns block instead of guessing', () => {
  assert.throws(() => generatePedidos(workbook([['Name', '품목명', 'CL1'], ['A', 'B', 2]]), 'Netherlands', 'W'), /AMBIGUOUS_PRODUCT_COLUMN/);
});

const realSource = new URL('../.tmp-country/source-orders.xlsx', import.meta.url);
test('confidential local Netherlands source: 59 product rows, 15 codes, 9220 stems preserved through save/reopen', { skip: !fs.existsSync(realSource) }, () => {
  const input = readPedidosWorkbook(fs.readFileSync(realSource)), before = JSON.stringify(input);
  const outputs = generatePedidos(input, 'Netherlands', '42-01');
  assert.equal(outputs.reduce((sum, output) => sum + output.totalQuantity, 0), 9220);
  assert.equal(outputs.reduce((sum, output) => sum + output.itemCount, 0), 59);
  assert.equal(outputs[0].cls.length, 15);
  const saved = readPedidosWorkbook(serializePedidosWorkbook(outputs[0].workbook));
  const rows = XLSX.utils.sheet_to_json(saved.Sheets[saved.SheetNames[0]], { header: 1, raw: true });
  assert.equal(rows.at(-1).at(-1), 9220); assert.equal(JSON.stringify(input), before);
});

test('every country exports mixed-case names A-Z with quantities and formulas intact across years', () => {
  for (const year of [2025, 2026]) for (const country of ['Netherlands', 'China', 'Colombia', 'Australia', 'Thailand', 'Ecuador', 'Vietnam']) {
    const unit = ['China', 'Colombia', 'Australia', 'Thailand'].includes(country) ? 'bunches' : 'stems';
    const input = matrix(country, unit); input.scope.year = year;
    input.rows = ['zulu', 'Alpha', 'bravo'].map((name, i) => ({ ...input.rows[0], key: `${10+i}|${unit}`, prodKey: 10+i, name, total: (i+1)*200, quantities: { 1: (i+1)*200 } }));
    const before = JSON.stringify(input), out = generatePedidosFromMatrix(input)[0];
    assert.deepEqual(out.preview.rows.map(row => row.slice(0,2)), [['Alpha',400],['bravo',600],['zulu',200]], country);
    assert.equal(out.totalQuantity,1200); assert.equal(out.sourceScope.year,year); assert.equal(out.sourceScope.orderWeek,'42-01');
    assert.equal(JSON.stringify(input),before);
    const reopened = readPedidosWorkbook(serializePedidosWorkbook(out.workbook));
    const ws = reopened.Sheets[reopened.SheetNames[0]];
    assert.equal(ws.A4.v,'Alpha'); assert.equal(ws.B4.v,400); assert.equal(ws.A6.v,'zulu'); assert.equal(ws.B6.v,200);
    if (country === 'Colombia') { assert.equal(ws.D4.f,'B4+C4'); assert.equal(ws.D4.v,400); }
    if (country === 'Netherlands' || country === 'China') { assert.equal(ws.C4.f,'SUM(B4:B4)'); assert.equal(ws.C4.v,400); }
    if (country === 'Vietnam') { assert.equal(ws.C4.f,'B4/16'); assert.equal(ws.C4.v,25); }
  }
});

test('Ecuador sorts A-Z without half-box pairing/merging, calculates 100 stems=1 box per row and emits SUM formulas', () => {
  const input=matrix('Ecuador','stems');
  input.rows=[['Rose C',100],['Rose B',200],['Rose A',300]].map(([name,q],i)=>({...input.rows[0],key:`${10+i}|stems`,prodKey:10+i,name,total:q,quantities:{1:q}}));
  const out=generatePedidosFromMatrix(input)[0];
  assert.deepEqual(out.preview.rows.map(row=>row.slice(0,3)),[['Rose A',300,3],['Rose B',200,2],['Rose C',100,1]]);
  assert.equal(out.totalQuantity,600);assert.equal(out.totalBoxes,6);
  const ws=out.workbook.Sheets[out.workbook.SheetNames[0]];
  assert.equal(ws.C4.f,'B4/100');assert.equal(ws.C5.f,'B5/100');assert.equal(ws.C6.f,'B6/100');
  assert.equal(ws.B7.f,'SUM(B4:B6)');assert.equal(ws.B7.v,600);
  assert.equal(ws.C7.f,'SUM(C4:C6)');assert.equal(ws.C7.v,6);
  assert.equal(ws['!merges'].length,1,'only title A1:C1 merge; zero C-column merges');
});

test('explicit unit override passes through adapter for any country without blocking', () => {
  const input = matrix('Netherlands', 'bunches');
  input.rows[0].unitOverridden = true;
  const out = generatePedidosFromMatrix(input)[0];
  assert.equal(out.totalQuantity, 200);
});
