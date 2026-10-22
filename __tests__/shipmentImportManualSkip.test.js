import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
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
const { normalizeUploadQtyForProduct } = load(resolve(lib, 'shipmentImportQty.js'));


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
async function preview(overrides={}, rows=sourceRows, year='2026') {
  const before=JSON.stringify(ledger);
  const queryFn=async(text, params={})=>{
    assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if (params.weekKey) { assert.equal(params.yr.value,year); return {recordset:[]}; }
    if (/FROM Product\s+WHERE/.test(text)) return {recordset:products};
    if (/FROM Customer\s+WHERE/.test(text)) return {recordset:customers};
    assert.equal(params.importYear.value,year);assert.equal(params.week.value,'43-01');
    if (/AS yr, COUNT/.test(text)) return {recordset:[]};
    if (/NOT EXISTS/.test(text)) return {recordset:[]};
    return {recordset:ledger.filter(r=>r.year===year && r.week===params.week.value)};
  };
  const result=await buildImportPreview({parsedRows:rows,rawWeek:'43-01',rawYear:year,productOverrides:overrides,fileBasedScope:true,queryFn});
  assert.equal(JSON.stringify(ledger),before);
  return result;
}
function body(p) {return {year:p.orderYear,week:p.week,rows:p.rows,fullCategoryReplacement:true,
  replacementProductKeys:p.replacementProductKeys,replacementPlan:createReplacementPlan(p,'actor',options)};}

test('manual Ruscus and 40cm override title family and stale workbook key, with quantity preserved',async()=>{
  const auto=await preview();assert.equal(auto.unmatched.length,2);
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
  const undo=await preview({[key(0)]:1717});assert.equal(undo.unmatched.length,1);
});
test('all skipped, stale skip keys and same known product include/skip conflict cannot silently apply',async()=>{
  const p=await preview(Object.fromEntries(sourceRows.map((r,i)=>[key(i),IMPORT_SKIP_PRODUCT_VALUE])));
  assert.equal(p.rows.length,0);assert.equal(createReplacementPlan(p,'actor',options),null);
  const stale=await preview({'old-sheet|old-label|hydrangea':IMPORT_SKIP_PRODUCT_VALUE});assert.equal(stale.unmatched.length,2);assert.equal(stale.replacementProductKeys,undefined);
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
