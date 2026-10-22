import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { createReplacementPlan, assertReplacementPlan, assertReplacementCoverage, replacementScopeSql } from '../lib/shipmentReplacementPlan.js';
import { importProductOverrideKey, IMPORT_SKIP_PRODUCT_VALUE, compareVerifyResult } from '../lib/shipmentImportQty.js';
import { normalizeWeekdayUnit } from '../lib/weekdayEstimateCompare.js';

// Compile the actual preview and its matching/quantity/fix policies locally.
// DB and write-only dependencies cannot open a connection or run a transaction.
const require = createRequire(import.meta.url);
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const lib = fileURLToPath(new URL('../lib/', import.meta.url));
const realModules = new Set(['shipmentImport', 'orderUtils', 'shipmentImportQty', 'shipmentFixScope',
  'shipmentFixScopeCore', 'shipmentDescr', 'distributeUnits', 'pivotProdName',
  'pivotVolumeProductLabel', 'dutchVolumeCustomerMatch', 'weekdayEarlyShipmentImport']);
const cache = new Map();
const forbidden = () => { throw new Error('Preview fixture must never access a real DB or write dependency'); };
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} };
  cache.set(filename, mod);
  const compiled = transformSync(readFileSync(filename, 'utf8'), false, Buffer.from(JSON.stringify({
    filename, jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' },
  })));
  new Function('require', 'module', 'exports', compiled.code)(name => {
    if (name === './weekdayEstimateCompare.js') return {normalizeWeekdayUnit};
    if (name === './db') return { query: forbidden, withTransaction: forbidden,
      sql: { NVarChar: 'NVarChar', Int: 'Int', Decimal: forbidden } };
    const target = resolve(dirname(filename), name.endsWith('.js') ? name : `${name}.js`);
    if (realModules.has(basename(target, '.js'))) return load(target);
    // Every unused write-only import is a throwing function if accidentally invoked.
    return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden });
  }, mod, mod.exports);
  return mod.exports;
}
const { buildImportPreview, parseAllocationWorkbook } = load(resolve(lib, 'shipmentImport.js'));
const { normalizeUploadQtyForProduct, isAlstroImportRow } = load(resolve(lib, 'shipmentImportQty.js'));


const products = [
  { ProdKey: 1717, ProdName: 'Ruscus Green', DisplayName: '루스커스', FlowerName: '루스커스', CountryFlower: '콜롬비아루스커스', OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 },
  { ProdKey: 3085, ProdName: 'Ruscus Green 40cm', DisplayName: '루스커스 40cm', FlowerName: '루스커스', CountryFlower: '콜롬비아루스커스', OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 },
  { ProdKey: 501, ProdName: 'Hydrangea White', DisplayName: 'White', FlowerName: '수국', CountryFlower: '콜롬비아수국', OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 },
];
const customers = [{ CustKey: 1, CustName: 'Fixture', BaseOutDay: 0 }, { CustKey: 2, CustName: 'Other', BaseOutDay: 0 }];
const sourceRows = ['루스커스', '루스커스 40cm', 'White'].map((productLabel,i)=>({
  sheetName:'수국',productLabel,productFamily:'hydrangea',customerLabel:'Fixture',rowNo:i+4,colNo:2,
  uploadQty:i+2,hasFinalDistributionDirective:true,outUnit:'박스',week:'43-01',
}));
const key = i => importProductOverrideKey(sourceRows[i]);
const options = { secret: 'fixture-only', now: 10000 };
const ledger = ['2025','2026'].flatMap(year => products.map(p=>({year,week:'43-01',CustKey:2,ProdKey:p.ProdKey,orderQty:9,currentOutQty:7,shipmentDateIssueCount:0})));
async function preview(overrides={}, rows=sourceRows, year='2026', catalog=products, fixtureLedger=ledger) {
  const before=JSON.stringify(ledger);
  const queryFn=async(text, params={})=>{
    assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if (params.weekKey) { assert.equal(params.yr.value,year); return {recordset:[]}; }
    if (/FROM Product\s+WHERE/.test(text)) return {recordset:catalog};
    if (/FROM Customer\s+WHERE/.test(text)) return {recordset:customers};
    assert.equal(params.importYear.value,year);assert.equal(params.week.value,'43-01');
    if (/AS yr, COUNT/.test(text)) return {recordset:[]};
    if (/NOT EXISTS/.test(text)) return {recordset:[]};
    return {recordset:fixtureLedger.filter(r=>r.year===year && r.week===params.week.value)};
  };
  const result=await buildImportPreview({parsedRows:rows,rawWeek:'43-01',rawYear:year,productOverrides:overrides,fileBasedScope:true,queryFn});
  assert.equal(JSON.stringify(ledger),before);
  return result;
}
function body(p) {return {year:p.orderYear,week:p.week,rows:p.rows,fullCategoryReplacement:true,
  replacementProductKeys:p.replacementProductKeys,replacementPlan:createReplacementPlan(p,'actor',options)};}

test('open upload choices survive family correction without changing manual, invalid or skipped intent',async()=>{
  const rows=sourceRows.map((r,i)=>({...r,productFamily:i<2?'ruscus':r.productFamily}));
  for (const year of ['2025','2026']) {
    const p=await preview({[key(0)]:501,[key(1)]:IMPORT_SKIP_PRODUCT_VALUE},rows.slice(0,2),year);
    assert.equal(p.unmatched.length,0);
    assert.equal(p.skippedProducts.length,1);
    assert.equal(p.rows.find(r=>r.custKey===1&&r.prodKey===501).uploadQty,2);
    assert(p.rows.every(r=>r.prodKey!==1717));
    assert.deepEqual(p.replacementProductKeys,[501]);
    assert.doesNotThrow(()=>assertReplacementPlan(body(p),'actor',options));
    const invalid=await preview({[key(0)]:99999},[rows[0]],year);
    assert.equal(invalid.unmatched.length,1);
    assert.equal(createReplacementPlan(invalid,'actor',options),null);
  }
  const exact=await preview({[key(0)]:IMPORT_SKIP_PRODUCT_VALUE,[importProductOverrideKey(rows[0])]:1717},[rows[0]]);
  assert.equal(exact.skippedProducts.length,0);
  assert.equal(exact.rows.find(r=>r.custKey===1).prodKey,1717);
  const stale=await preview({'other-sheet|루스커스|hydrangea':IMPORT_SKIP_PRODUCT_VALUE},[rows[0]]);
  assert.equal(stale.skippedProducts.length,0);
  assert.equal(stale.unmatched.length,0);
});
test('ambiguous historical choices require a new choice instead of silently auto matching',async()=>{
  const row={...sourceRows[0],productFamily:'ruscus'};
  const duplicate=await preview({[key(0)]:1717,[importProductOverrideKey({...row,productFamily:'rose'})]:IMPORT_SKIP_PRODUCT_VALUE},[row]);
  assert.equal(duplicate.unmatched.length,1);
  assert.equal(createReplacementPlan(duplicate,'actor',options),null);
  const blocks=await preview({[key(0)]:IMPORT_SKIP_PRODUCT_VALUE},[row,{...row,productFamily:'rose'}]);
  assert.equal(blocks.unmatched.length,2);
  assert.equal(blocks.skippedProducts.length,0);
});
test('manual Ruscus and 40cm override title family and stale workbook key, with quantity preserved',async()=>{
  const auto=await preview();assert.equal(auto.unmatched.length,0);
  for (const year of ['2025','2026']) {
    const p=await preview({[key(0)]:1717,[key(1)]:3085}, sourceRows.map(r=>({...r,prodKey:501})),year);
    assert.equal(p.unmatched.length,0);
    assert.equal(p.rows.find(r=>r.custKey===1&&r.prodKey===1717).uploadQty,2);
    assert.equal(p.rows.find(r=>r.custKey===1&&r.prodKey===3085).uploadQty,3);
    assert.doesNotThrow(()=>assertReplacementPlan(body(p),'actor',options));
  }
});
test('invalid explicit manual key never falls back to valid embedded key or automatic match',async()=>{
  for (const bad of [0,-1,99999,'invalid',true,1.5]) {
    const p=await preview({[key(2)]:bad},[{...sourceRows[2],prodKey:501}]);
    assert.equal(p.unmatched.length,1,String(bad));
    assert.equal(createReplacementPlan(p,'actor',options),null);
  }
});
test('skip protects existing same-category product, while remaining product and missing customer are retained',async()=>{
  for (const year of ['2025','2026']) {
    const p=await preview({[key(0)]:1717,[key(1)]:IMPORT_SKIP_PRODUCT_VALUE},sourceRows,year);
    assert.equal(p.unmatched.length,0);assert.equal(p.skippedProducts.length,1);
    assert.deepEqual(p.replacementProductKeys,[501,1717]);
    assert(p.rows.every(r=>r.prodKey!==3085));
    assert.equal(p.rows.find(r=>r.custKey===2&&r.prodKey===1717).uploadQty,0);
    assert.doesNotThrow(()=>assertReplacementPlan(JSON.parse(JSON.stringify(body(p))),'actor',options));
    for (const mutate of [b=>delete b.replacementProductKeys,b=>b.replacementProductKeys.push(3085),b=>b.year=year==='2026'?'2025':'2026',b=>b.rows.push({...b.rows[0],prodKey:3085})]) {
      const b=body(p);b.replacementProductKeys=[...b.replacementProductKeys];b.rows=structuredClone(b.rows);mutate(b);
      assert.throws(()=>assertReplacementPlan(b,'actor',options));
    }
  }
  const undo=await preview({[key(0)]:1717});assert.equal(undo.unmatched.length,0);assert.equal(undo.skippedProducts.length,0);
  assert(undo.rows.some(r=>r.custKey===1&&r.prodKey===3085));
});
test('all skipped, stale skip keys and same known product include/skip conflict cannot silently apply',async()=>{
  const p=await preview(Object.fromEntries(sourceRows.map((r,i)=>[key(i),IMPORT_SKIP_PRODUCT_VALUE])));
  assert.equal(p.rows.length,0);assert.equal(createReplacementPlan(p,'actor',options),null);
  const stale=await preview({'old-sheet|old-label|hydrangea':IMPORT_SKIP_PRODUCT_VALUE});assert.equal(stale.unmatched.length,0);assert.equal(stale.skippedProducts.length,0);assert.equal(stale.replacementProductKeys,undefined);
  await assert.rejects(preview({[key(0)]:IMPORT_SKIP_PRODUCT_VALUE,[key(1)]:1717}),/함께 선택/);
});
test('unidentified skipped label cannot cancel any out-of-file ERP product',async()=>{
  const unknown={...sourceRows[0],productLabel:'unknown source'};
  const p=await preview({[importProductOverrideKey(unknown)]:IMPORT_SKIP_PRODUCT_VALUE},[unknown,sourceRows[2]]);
  assert.deepEqual(p.replacementProductKeys,[501]);assert(p.rows.every(r=>r.prodKey===501));
});
test('coverage before and inside transaction and post-write verification use identical signed product scope',async()=>{
  const p=await preview({[key(0)]:1717,[key(1)]:IMPORT_SKIP_PRODUCT_VALUE});
  const source=readFileSync(resolve(lib,'shipmentImport.js'),'utf8').replace(/\r\n/g,'\n');
  const begin=source.indexOf('async function verifyAppliedShipmentRows('),end=source.indexOf('\n}\n',begin)+2;
  const verify=vm.runInNewContext(`(${source.slice(begin,end)})`,{sql:{NVarChar:'text'},compareVerifyResult,replacementScopeSql});
  const query=async(text,params)=>{
    assert.match(text,/p.ProdKey IN \(501,1717\)/);
    assert.doesNotMatch(text,/p.CountryFlower IN/);
    assert.equal((params.importYear||params.replacementYear).value,'2026');
    return {recordset:p.rows.map(r=>({CustKey:r.custKey,ProdKey:r.prodKey,OutQuantity:r.uploadQty,DateQty:r.uploadQty,DateIssueCount:0}))};
  };
  for(const lock of [false,true]) await assertReplacementCoverage(query,p.rows,'2026','43-01',{NVarChar:'text'},lock,p.replacementProductKeys);
  const result=await verify(query,'43-01',p.rows.map(r=>({...r,intended:r.uploadQty,verifyOrder:false})),'2026',true,p.replacementProductKeys);
  assert.equal(result.mismatchCount,0);
  await assert.rejects(assertReplacementCoverage(query,p.rows.slice(1),'2026','43-01',{NVarChar:'text'},true,p.replacementProductKeys),/既|기존 분배/);
});

const actualRuscus = products.slice(0,2).map((p,i)=>({...p,
  ProdName: i ? 'Ruscus Green 40cm ' : 'Ruscus Green',
  DisplayName: i ? '루스커스 그린 40CM' : '루스커스 그린'}));
actualRuscus.push(
  {...actualRuscus[0],ProdKey:2959,ProdName:'Ruscus Green 50cm ',DisplayName:'루스커스 그린 50CM'},
  {...actualRuscus[0],ProdKey:3023,ProdName:'Ruscus Green 70cm ',DisplayName:'루스커스 그린 70CM'},
  {...actualRuscus[0],ProdKey:2617,ProdName:'ISRAEL 루스쿠스. Sample Ruscus',DisplayName:'ISRAEL 루스쿠스. SAMPLE 루스커스',CountryFlower:'이스라엘루스커스'},
  {...actualRuscus[0],ProdKey:2205,ProdName:'Ruscus israelí',DisplayName:'루스커스 ISRAELÍ',FlowerName:'왁스',CountryFlower:'국내왁스'});
function allocationRows(labels, heading='수국') {
  const XLSX=require('xlsx'), book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[heading],[],['','Fixture','주문','입고'],
    ...labels.map((label,i)=>[label,i+2,i+2,0])]),heading);
  return parseAllocationWorkbook(XLSX,book).rows;
}
test('actual workbook automatically matches Ruscus and 40cm under hydrangea heading, without manual choices',async()=>{
  const rows=allocationRows(['루스커스','루스커스 40cm','White']);
  assert.deepEqual(rows.map(r=>r.productFamily),['ruscus','ruscus','hydrangea']);
  for (const year of ['2025','2026']) {
    const p=await preview({},rows,year,[...actualRuscus,products[2]]);
    assert.equal(p.unmatched.length,0);
    const included=p.rows.filter(r=>r.custKey===1);
    assert.deepEqual(included.map(r=>[r.prodKey,r.productFamily,r.uploadQty]),[[1717,'ruscus',2],[3085,'ruscus',3],[501,'hydrangea',4]]);
    for (const r of included) assert.equal(normalizeUploadQtyForProduct(r,[...actualRuscus,products[2]].find(p=>p.ProdKey===r.prodKey)),r.uploadQty);
    assert.doesNotThrow(()=>assertReplacementPlan(body(p),'actor',options));
  }
  const skipKey=importProductOverrideKey(rows[1]);
  const skipped=await preview({[skipKey]:IMPORT_SKIP_PRODUCT_VALUE},rows,'2026',[...actualRuscus,products[2]]);
  assert.equal(skipped.unmatched.length,0);assert(!skipped.rows.some(r=>r.prodKey===3085));
});
test('catalog exact name beats heading, ambiguous names use heading and foreign fuzzy/explicit keys remain blocked',async()=>{
  const rose={...products[2],ProdKey:502,ProdName:'Rose White',DisplayName:'White',FlowerName:'장미',CountryFlower:'케냐장미'};
  const unique={...rose,ProdKey:503,ProdName:'Rose Freedom',DisplayName:'프리덤'};
  const catalog=[...actualRuscus,...products.slice(2),rose,unique];
  const p=await preview({},allocationRows(['White','프리덤','Freedom']),'2026',catalog);
  assert.equal(p.unmatched.length,0);
  assert.equal(p.rows.find(r=>r.custKey===1&&r.prodKey===501).productFamily,'hydrangea');
  assert.equal(p.rows.find(r=>r.custKey===1&&r.prodKey===503).productFamily,'rose');
  assert.equal((await preview({},allocationRows(['Free']),'2026',catalog)).unmatched.length,1);
  const keyed=allocationRows(['White']).map(r=>({...r,prodKey:1717}));
  assert.equal((await preview({},keyed,'2026',catalog)).unmatched.length,1);
  const explicit=allocationRows(['Hydrangea White']).map(r=>({...r,prodKey:502}));
  assert.equal((await preview({},explicit,'2026',catalog)).unmatched.length,1);
  const ambiguous=allocationRows(['White'],'2026 혼합');
  assert.equal(ambiguous.length,1);
  assert.equal((await preview({},ambiguous,'2026',catalog)).unmatched.length,1);
});
test('mixed sheet headings cannot change Ruscus quantities or the matched rose/alstro conversion',async()=>{
  const rose={...products[2],ProdKey:502,ProdName:'Rose Freedom',DisplayName:'프리덤',FlowerName:'장미',CountryFlower:'케냐장미'};
  const alstro={...products[2],ProdKey:503,ProdName:'Alstroemeria Yellow',DisplayName:'노랑알스트로',FlowerName:'알스트로메리아',CountryFlower:'콜롬비아알스트로'};
  for(const heading of ['수국','알스트로','장미','루스커스']) {
    const input=allocationRows(['루스커스','루스커스 40cm','프리덤','노랑알스트로'],heading).map(r=>r.productLabel==='프리덤'?{...r,outUnit:'단'}:r);
    assert.equal(input.length,4);
    const p=await preview({},input,'2026',[...actualRuscus,rose,alstro]);
    assert.equal(p.unmatched.length,0);
    for(const [key,qty] of [[1717,2],[3085,3],[502,0.4],[503,80]]) {
      const row=p.rows.find(r=>r.custKey===1&&r.prodKey===key);
      assert.equal(row.uploadQty,qty,`${heading}/${key}`);
      assert.equal(normalizeUploadQtyForProduct(row,[...actualRuscus,rose,alstro].find(p=>p.ProdKey===key)),qty);
    }
  }
});

test('screen quantity formatter uses the same resolved family as preview',()=>{
  const source=readFileSync(resolve(lib,'../pages/shipment/distribute-import.js'),'utf8');
  const formatter=source.slice(source.indexOf('const fmt ='),source.indexOf('const qtyWarningText'));
  const fmtUpload=vm.runInNewContext(`${formatter}\nfmtUpload`,{isAlstroImportRow});
  assert.equal(fmtUpload({sheetName:'알스트로',productFamily:'ruscus',uploadQty:2,excelQty:2}),'2');
  assert.equal(fmtUpload({sheetName:'수국',productFamily:'alstroemeria',uploadQty:32,excelQty:2}),'32(2)');
});

const fullCatalog=JSON.parse(readFileSync(resolve(lib,'../__tests__/fixtures/shipmentImportCatalog20261022.json'),'utf8'));
test('all 3359 active catalog products: 6175 original names never silently map to another key',async()=>{
  assert.equal(fullCatalog.length,3359);
  const cases=[],input=[];
  for(const field of ['ProdName','DisplayName']) {
    const groups=new Map();
    for(const p of fullCatalog) {
      if(!String(p[field]||'').trim())continue;
      const heading=p.FlowerName||'품목';
      if(!groups.has(heading))groups.set(heading,[]);
      groups.get(heading).push(p);
    }
    for(const [heading,items] of groups) {
      const XLSX=require('xlsx'),book=XLSX.utils.book_new();
      const sheet=heading.replace(/[\\/?*\[\]:]/g,' ').slice(0,31);
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['2026 '+heading],[],['','Fixture','주문','입고'],...items.map(p=>[p[field],1,1,0])]),sheet);
      const parsed=parseAllocationWorkbook(XLSX,book).rows;
      assert.equal(parsed.length,items.length,`${field}/${heading}: parser must retain every original row`);
      for(const row of parsed) {
        const p=items[row.rowNo-4],entryId=field+':'+p.ProdKey;
        cases.push({entryId,key:p.ProdKey});input.push({...row,entryId});
      }
    }
  }
  assert.equal(cases.length,6175);
  const duplicateKeys=new Set([854,861,952,3464,1846,2030,2195,2197]);
  for(const year of ['2025','2026']) {
    const p=await preview({},input,year,fullCatalog,[]),resolved=new Map();
    for(const row of p.rows)for(const id of row.entryIds)resolved.set(id,row.prodKey);
    assert.equal(p.unmatched.length,16);assert.equal(resolved.size,6159);
    for(const c of cases) {
      if(duplicateKeys.has(c.key))assert(!resolved.has(c.entryId),'duplicate original name needs explicit evidence');
      else assert.equal(resolved.get(c.entryId),c.key,c.entryId);
    }
    assert(p.unmatched.every(r=>duplicateKeys.has(Number(r.entryId.split(':')[1]))));
    for(const key of [1044,2738,2739,2682])assert.equal(p.rows.find(r=>r.prodKey===key).uploadQty,p.rows.find(r=>r.prodKey===key).entryIds.length,'box/bunch/fee quantities remain correct');
  }
});
test('duplicate exact names use only one current-year customer order, manual selection or explicit workbook key',async()=>{
  const rows=allocationRows(['Hydrangea / Royal Parade']).map(r=>({...r,entryId:'duplicate'}));
  const oldOrder={year:'2025',week:'43-01',CustKey:1,ProdKey:952,orderQty:2,currentOutQty:0};
  const currentOrder={...oldOrder,year:'2026',ProdKey:3464};
  const p=await preview({},rows,'2026',fullCatalog,[oldOrder,currentOrder]);
  assert.equal(p.unmatched.length,0);assert.equal(p.rows.find(r=>r.entryIds.includes('duplicate')).prodKey,3464);
  assert.equal((await preview({},rows,'2026',fullCatalog,[oldOrder])).unmatched.length,1);
  assert.equal((await preview({},rows,'2026',fullCatalog,[currentOrder,{...currentOrder,ProdKey:952}])).unmatched.length,1);
  const manual=await preview({[importProductOverrideKey(rows[0])]:952},rows,'2026',fullCatalog,[]);
  assert.equal(manual.rows[0].prodKey,952);
  const embedded=await preview({},rows.map(r=>({...r,prodKey:3464})),'2026',fullCatalog,[]);
  assert.equal(embedded.rows[0].prodKey,3464);
});
test('unknown detailed names cannot collapse into generic species, and wrong same-family embedded keys stay blocked',async()=>{
  const missing=await preview({},allocationRows(['[MEL] 장미 CHINA / Unknown Variety']),'2026',fullCatalog,[]);
  assert.equal(missing.unmatched.length,1);
  const input=allocationRows(['[MEL] 장미 CHINA / 카롤라 (CAROLA)']).map(r=>({...r,prodKey:2739}));
  assert.equal((await preview({},input,'2026',fullCatalog,[])).unmatched.length,1);
});
test('original-name choice keys keep mix variants separate and safely recover old cleaned selections',async()=>{
  const names=[2520,2521].map(key=>fullCatalog.find(p=>p.ProdKey===key).ProdName);
  const rows=allocationRows(names,'알스트로');
  const keys=rows.map(importProductOverrideKey);
  assert.notEqual(keys[0],keys[1]);
  const p=await preview({[keys[0]]:IMPORT_SKIP_PRODUCT_VALUE},rows,'2026',fullCatalog,[]);
  assert.equal(p.unmatched.length,0);assert.equal(p.skippedProducts.length,1);
  assert.deepEqual(p.replacementProductKeys,[2521]);assert.equal(p.rows[0].prodKey,2521);
  const legacy=importProductOverrideKey({...rows[0],rawProductLabel:''});
  assert.equal((await preview({[legacy]:IMPORT_SKIP_PRODUCT_VALUE},rows,'2026',fullCatalog,[])).unmatched.length,2);
  const sole=await preview({[legacy]:IMPORT_SKIP_PRODUCT_VALUE},[rows[0]],'2026',fullCatalog,[]);
  assert.equal(sole.skippedProducts.length,1);assert.equal(sole.rows.length,0);
  const manual=await preview({[legacy]:2520},[rows[0]],'2026',fullCatalog,[]);
  assert.equal(manual.rows[0].prodKey,2520);
  const invalid=await preview({[legacy]:999999},[rows[0]],'2026',fullCatalog,[]);
  assert.equal(invalid.unmatched.length,1);
});
test('country-species heading narrows same species duplicates before order history',async()=>{
  const catalog=[{...products[2],ProdKey:701,ProdName:'Rose Test',DisplayName:'테스트',FlowerName:'장미',CountryFlower:'케냐장미'},
    {...products[2],ProdKey:702,ProdName:'Rose Test',DisplayName:'테스트',FlowerName:'장미',CountryFlower:'콜롬비아장미'}];
  const rows=allocationRows(['Rose Test'],'케냐장미');
  const p=await preview({},rows,'2026',catalog,[{year:'2026',week:'43-01',CustKey:1,ProdKey:702,orderQty:9}]);
  assert.equal(p.rows.find(r=>r.cells.length).prodKey,701);
});
test('a correctly signed pre-fix preview cannot apply without revalidation',async()=>{
  const p=await preview(),b=body(p);
  assert.doesNotThrow(()=>assertReplacementPlan(b,'actor',options));
  const payload=JSON.parse(Buffer.from(b.replacementPlan.split('.')[0],'base64url').toString());
  delete payload.matchPolicy;
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  b.replacementPlan=encoded+'.'+createHmac('sha256',options.secret).update('shipment-replacement-v1:'+encoded).digest('hex');
  assert.throws(()=>assertReplacementPlan(b,'actor',options),/매칭 기준.*다시 검증/);
});
