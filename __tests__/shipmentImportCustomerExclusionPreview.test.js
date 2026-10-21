import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
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

test('separate client header and explicit alstro ERP unit roundtrip preserve quantities', () => {
  const XLSX = require('xlsx-js-style');
  for (const year of [2025, 2026]) {
    for (const actual of [16, 32, 8, 0]) {
      const sheet = XLSX.utils.aoa_to_sheet([
        [`${year}-41-01 알스트로`], ['알스트로 ERP 수량 (÷16 참고)'],
        ['', '주광', '주문', '입고'], ['클라이언트 번호', 'CL2'],
        ['ALSTROMERIA Lavender', actual, actual, 0], ['합계', actual, actual, 0],
      ]);
      const workbook = { SheetNames:['알스트로'], Sheets:{알스트로:sheet} };
      const decoded = XLSX.read(XLSX.write(workbook, {type:'buffer',bookType:'xlsx'}), {type:'buffer'});
      const parsed = parseAllocationWorkbook(XLSX, decoded).rows;
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].rowNo, 5);
      assert.equal(parsed[0].customerLabel, '주광');
      assert.equal(normalizeUploadQtyForProduct(parsed[0]), actual);
      assert.equal(normalizeUploadQtyForProduct({...parsed[0], alstroErpQuantity:false, uploadQty:actual/16}), actual);
      assert.equal(normalizeUploadQtyForProduct({...parsed[0], alstroErpQuantity:'true', uploadQty:1}), 16);
    }
  }
});

const product = { ProdKey: 359, ProdName: 'ROSE / Brut', DisplayName: 'Brut',
  FlowerName: '장미', CounName: '에콰도르', CountryFlower: '에콰도르 장미',
  OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Bunch: 10, SteamOf1Box: 100 };
const customer = { CustKey: 533, CustName: '주광농원', OrderCode: 'JGW', Descr: '', BaseOutDay: 0 };
const ledger = [
  { year: '2026', week: '41-01', CustKey: 533, ProdKey: 359, orderQty: 5, currentOutQty: 4 },
  { year: '2026', week: '40-02', CustKey: 533, ProdKey: 359, orderQty: 3, currentOutQty: 3 },
  { year: '2025', week: '41-01', CustKey: 533, ProdKey: 359, orderQty: 99, currentOutQty: 99 },
];
const parsedRows = [
  { week: '41-01', customerLabel: '주광농원', prodName: product.ProdName, prodKey: 359,
    uploadQty: 5, outUnit: '박스', sheetName: '장미', rowNo: 4, colNo: 2 },
  { week: '41-01', customerLabel: '주광선출고', prodName: product.ProdName, prodKey: 359,
    uploadQty: 3, outUnit: '박스', sheetName: '장미', rowNo: 4, colNo: 3 },
];

test('replacement preview adds all six orderless Yangjae cancellations including products removed entirely', async () => {
  const products = Array.from({length: 7}, (_, i) => ({...product, ProdKey:389+i,
    ProdName:`CARNATION fixture ${i}`, DisplayName:`fixture ${i}`, FlowerName:'카네이션',
    CounName:'콜롬비아', CountryFlower:'콜롬비아카네이션'}));
  const customers = [customer, {...customer, CustKey:686, CustName:'양재동'}];
  const residues = products.slice(0,6).map((p,i) => ({CustKey:686, CustName:'양재동',
    ProdKey:p.ProdKey, ProdName:p.ProdName, OutUnit:'박스', orderQty:0, currentOutQty:[5,2,3,1,1,2][i]}));
  const fixture = {year:'2026', week:'36-01', residues};
  const original = JSON.stringify(fixture);
  const queryFn = async (text, params={}) => {
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if (params.weekKey) return {recordset:[]};
    if (/FROM Product\s+WHERE/.test(text)) return {recordset:products};
    if (/FROM Customer\s+WHERE/.test(text)) return {recordset:customers};
    assert.equal(params.importYear.value,'2026');
    assert.equal(params.week.value,'36-01');
    if (/AS yr, COUNT/.test(text)) return {recordset:[{yr:'2025',detailCount:6}]};
    if (/NOT EXISTS/.test(text)) return {recordset:residues};
    return {recordset:[]};
  };
  const result = await buildImportPreview({rawWeek:'36-01',rawYear:'2026',queryFn,
    parsedRows:[{week:'36-01',customerLabel:customer.CustName,prodKey:395,
      prodName:products[6].ProdName,uploadQty:10,outUnit:'박스',sheetName:'카네이션',rowNo:4,colNo:2}]});
  const missing = result.rows.filter(r=>r.custKey===686);
  assert.equal(missing.length,6);
  assert(missing.every(r=>r.missingFromExcel && r.uploadQty===0 && r.orderQty===0));
  assert.equal(result.rows.find(r=>r.custKey===533).uploadQty,10);
  assert.equal(JSON.stringify(fixture),original);
});

async function preview(customerOverrides = {}, { earlyImportMode = null, sourceRows = parsedRows } = {}) {
  const before = JSON.stringify({ ledger, parsedRows, product, customer });
  const calls = [];
  const queryFn = async (text, params = {}) => {
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    calls.push({ text, params });
    if (params.weekKey) {
      assert.equal(params.yr.value, '2026');
      assert.equal(params.weekKey.value, '20264101');
      return { recordset: [] };
    }
    if (/FROM Product\s+WHERE/.test(text)) return { recordset: [structuredClone(product)] };
    if (/FROM Customer\s+WHERE/.test(text)) return { recordset: [structuredClone(customer)] };
    assert.equal(params.importYear?.value, '2026');
    assert.equal(params.week?.value, '41-01');
    if (/AS yr, COUNT/.test(text)) return { recordset: [{ yr: '2025', detailCount: 1 }] };
    assert.match(text, /ISNULL\(CAST\(sm\.OrderYear AS NVARCHAR\(4\)\), @importYear\) = @importYear/,
      'actual shipment query must filter selected year, not just fixture routing');
    if (/FROM OrderMaster om/.test(text) && !/NOT EXISTS/.test(text)) {
      assert.match(text, /ISNULL\(CAST\(om\.OrderYear AS NVARCHAR\(4\)\), @importYear\) = @importYear/);
      assert.match(text, /om\.OrderWeek\s*=\s*@week/);
      const rows = ledger.filter(r => r.year === params.importYear.value && r.week === params.week.value)
        .map(r => ({ ...r, CustName: customer.CustName, OrderCode: customer.OrderCode,
          ProdName: product.ProdName, OutUnit: product.OutUnit }));
      return { recordset: rows };
    }
    if (/FROM ShipmentMaster sm/.test(text) && /NOT EXISTS/.test(text)) return { recordset: [] };
    throw new Error(`Unexpected preview query: ${text}`);
  };
  const result = await buildImportPreview({ parsedRows: sourceRows, rawWeek: '41-01', rawYear: '2026',
    customerOverrides, queryFn, earlyImportMode,
    earlyExclusionLoader: earlyImportMode ? async (_query, scope) => {
      assert.equal(scope.year, '2026');
      assert.equal(scope.majorWeek, '41');
      assert.equal(scope.orderWeek, '41-01');
      return { fingerprint: 'ledger-v1', rows: [{ custKey: 533, prodKey: 359, unit: '박스',
        processedEarlyTotal: 3, earlyExcludedApplied: 3, targetImportYear: 2026, targetImportWeek: '41-01' }] };
    } : null });
  assert.equal(JSON.stringify({ ledger, parsedRows, product, customer }), before,
    'preview/exclusion never mutates current, previous-week or prior-year ledger fixtures');
  assert.equal(result.orderYear, '2026');
  assert.deepEqual(result.otherYearWeeks, [{ year: '2025', detailCount: 1 }]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].currentOutQty, 4, 'only selected-year/week allocation participates');
  assert.equal(result.rows[0].orderQty, 5, 'prior-year same-week order is excluded');
  assert.ok(calls.length >= 7, 'actual preview executes catalog, fix, order, shipment and year reads');
  return result;
}

test('unmatched original column blocks until explicitly excluded or connected; undo restores block', async () => {
  const unresolved = await preview();
  assert.equal(unresolved.unmatched.length, 1);
  assert.equal(unresolved.unmatched[0].customerLabel, '주광선출고');
  assert.match(unresolved.unmatched[0].reason, /업체/);
  assert.equal(unresolved.rows[0].uploadQty, 5);
  assert.equal(unresolved.ignoredCustomerCount, 0);

  const ignored = await preview({ '주광선출고': '__ignore__' });
  assert.equal(ignored.unmatched.length, 0);
  assert.equal(ignored.ignoredCustomerCount, 1);
  assert.equal(ignored.rows[0].uploadQty, 5, 'normal customer column remains; pseudo-column is not summed');
  assert.equal(ignored.rows[0].missingFromExcel, undefined, 'normal column prevents missing-to-zero synthesis');
  assert.deepEqual(ignored.rows[0].cells, ['장미!R4C2']);
  assert.equal(ignored.applyRows[0].shipmentDiffQty, 1, '5 is a final target relative to current 4');

  const connected = await preview({ '주광선출고': 533 });
  assert.equal(connected.unmatched.length, 0);
  assert.equal(connected.ignoredCustomerCount, 0);
  assert.equal(connected.rows[0].uploadQty, 8, 'explicit real-customer connection sums both original columns');
  assert.deepEqual(connected.rows[0].cells, ['장미!R4C2', '장미!R4C3']);
  assert.equal(connected.applyRows[0].shipmentDiffQty, 4);

  const undone = await preview({});
  assert.deepEqual(undone.unmatched, unresolved.unmatched);
  assert.equal(undone.rows[0].uploadQty, 5);

  const invalidConnection = await preview({ '주광선출고': 999999 });
  assert.equal(invalidConnection.unmatched.length, 1, 'invalid explicit mapping cannot silently resolve another customer');
  assert.equal(invalidConnection.rows[0].uploadQty, 5);
});

test('alstro unit marker survives preview and preflight normalization; mixed units block', async () => {
  const source = {...parsedRows[0], productFamily:'alstroemeria', uploadQty:16, alstroErpQuantity:true};
  const result = await preview({}, {sourceRows:[source]});
  assert.equal(result.rows[0].uploadQty, 16);
  assert.equal(result.rows[0].alstroErpQuantity, true);
  assert.equal(normalizeUploadQtyForProduct(result.rows[0], product), 16);
  await assert.rejects(preview({}, {sourceRows:[source, {...source, uploadQty:1, alstroErpQuantity:false}]}), /섞여/);
});

test('preview totals are normalized first, then exclude processed ledger exactly once', async () => {
  const sourceRows = [{ ...parsedRows[0], uploadQty: 10 }];
  const original = await preview({}, { earlyImportMode: 'ORIGINAL_INCLUDES_EARLY', sourceRows });
  assert.equal(original.rows[0].originalTotal, 10);
  assert.equal(original.rows[0].processedEarlyTotal, 3);
  assert.equal(original.rows[0].earlyExcludedApplied, 3);
  assert.equal(original.rows[0].uploadQty, 7);
  assert.equal(original.rows[0].shipmentDiffQty, 3, 'current 4 gives storage delta 3; 7 is the absolute target');
  assert.equal(original.earlyImport.fingerprint, 'ledger-v1');
  const repeated = await preview({}, { earlyImportMode: 'ORIGINAL_INCLUDES_EARLY', sourceRows });
  assert.equal(repeated.rows[0].uploadQty, 7, 'repeated preview starts from original 10');
  const excluded = await preview({}, { earlyImportMode: 'ALREADY_EXCLUDED', sourceRows });
  assert.equal(excluded.rows[0].uploadQty, 10);
  assert.equal(excluded.rows[0].processedEarlyTotal, 3);
  assert.equal(excluded.rows[0].earlyExcludedApplied, 0);
  await assert.rejects(() => preview({}, { earlyImportMode: 'ORIGINAL_INCLUDES_EARLY',
    sourceRows: [...sourceRows, { ...sourceRows[0], week: '41-02', uploadQty: 4 }] }),
  { code: 'EARLY_IMPORT_AMBIGUOUS_SUFFIX' }, 'multiple same-major source buckets need explicit mapping');
});


test('수국 선택은 혼합 원본과 기존 카네이션 분배를 교체 범위에서 제외한다', async () => {
  const hydrangea={...product,ProdKey:501,ProdName:'HYDRANGEA fixture',DisplayName:'수국 fixture',FlowerName:'수국',CountryFlower:'콜롬비아수국'};
  const carnation={...product,ProdKey:502,ProdName:'CARNATION fixture',FlowerName:'카네이션',CountryFlower:'콜롬비아카네이션'};
  const queryFn=async(text,params={})=>{
    assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if(params.weekKey)return{recordset:[]};
    if(/FROM Product\s+WHERE/.test(text))return{recordset:[hydrangea,carnation]};
    if(/FROM Customer\s+WHERE/.test(text))return{recordset:[customer]};
    assert.equal(params.importYear.value,'2026');assert.equal(params.week.value,'43-01');
    if(/AS yr, COUNT/.test(text))return{recordset:[{yr:'2025',detailCount:1}]};
    return{recordset:/NOT EXISTS/.test(text)?[]:[{CustKey:533,ProdKey:501,orderQty:5,currentOutQty:3},{CustKey:533,ProdKey:502,orderQty:20,currentOutQty:20}]};
  };
  const sourceRows=[{week:'43-01',customerLabel:customer.CustName,prodKey:501,productFamily:'hydrangea',uploadQty:5,outUnit:'박스',sheetName:'혼합',rowNo:4,colNo:2},
    {week:'43-01',customerLabel:customer.CustName,prodKey:502,productFamily:'carnation',uploadQty:0,outUnit:'박스',sheetName:'혼합',rowNo:5,colNo:2,hasFinalDistributionDirective:true}];
  const result=await buildImportPreview({parsedRows:sourceRows,rawWeek:'43-01',rawYear:'2026',requestedProductFamily:'hydrangea',queryFn});
  assert.deepEqual(result.rows.map(r=>r.prodKey),[501]);
  assert.deepEqual(result.replacementCategories,['콜롬비아수국']);
  assert.equal(result.rows[0].uploadQty,5);
  assert.match(result.logs.join(' '),/선택 품종 밖 원본 1행 제외/);
});


test('fresh hydrangea file derives scope without a manual family filter; foreign key/name cannot introduce carnation', async () => {
  const hydrangea={...product,ProdKey:501,ProdName:'WHITE',DisplayName:'WHITE',FlowerName:'수국',CountryFlower:'콜롬비아수국'};
  const carnation={...product,ProdKey:502,ProdName:'WHITE',DisplayName:'WHITE',FlowerName:'카네이션',CountryFlower:'콜롬비아카네이션'};
  const queryFn=async(text,params={})=>{
    assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    if(params.weekKey)return{recordset:[]};
    if(/FROM Product\s+WHERE/.test(text))return{recordset:[carnation,hydrangea]};
    if(/FROM Customer\s+WHERE/.test(text))return{recordset:[customer]};
    assert.equal(params.importYear.value,'2026');assert.equal(params.week.value,'43-01');
    if(/AS yr, COUNT/.test(text))return{recordset:[{yr:'2025',detailCount:1}]};
    return{recordset:/NOT EXISTS/.test(text)?[]:[{CustKey:533,ProdKey:501,orderQty:5,currentOutQty:3},{CustKey:533,ProdKey:502,orderQty:20,currentOutQty:20}]};
  };
  const row={week:'43-01',customerLabel:customer.CustName,productLabel:'WHITE',productFamily:'hydrangea',uploadQty:5,outUnit:'박스',sheetName:'수국',rowNo:4,colNo:2,hasFinalDistributionDirective:true};
  const run=rows=>buildImportPreview({parsedRows:rows,rawWeek:'43-01',rawYear:'2026',fileBasedScope:true,queryFn});
  const first=await run([{...row,productFamily:'carnation'}]);assert.deepEqual(first.replacementCategories,['콜롬비아카네이션']);
  const fresh=await run([row]);assert.deepEqual(fresh.rows.map(r=>r.prodKey),[501]);assert.deepEqual(fresh.replacementCategories,['콜롬비아수국']);
  assert.equal(fresh.rows[0].orderQty,5);assert.equal(fresh.rows[0].uploadQty,5);
  const badKey=await run([{...row,prodKey:502}]);assert.equal(badKey.rows.length,0);assert.equal(badKey.unmatched.length,1);
  const ambiguous=await run([{...row,productFamily:''}]);assert.equal(ambiguous.rows.length,0);assert.equal(ambiguous.unmatched.length,1);
});
