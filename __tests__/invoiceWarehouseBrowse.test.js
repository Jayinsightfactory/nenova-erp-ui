const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../lib/invoiceWarehouseBrowse.js');
test('invoice shortcut never selects another year/week/invoice or silently chooses a farm', async () => {
  const { filterInvoiceWarehouses } = await modulePromise;
  const scope={orderYear:'2026',orderWeek:'44-01'};
  const rowScope={OrderYear:scope.orderYear,OrderWeek:scope.orderWeek};
  const rows=[{...rowScope,InvoiceNo:'41002',WarehouseKey:1},{...rowScope,InvoiceNo:'41002',WarehouseKey:2},
    {...rowScope,OrderYear:'2025',InvoiceNo:'41002'}, {...rowScope,OrderWeek:'43-01',InvoiceNo:'41002'}, {...rowScope,InvoiceNo:'410020'}];
  assert.deepEqual(filterInvoiceWarehouses(rows,scope,' 41002 ').map(row=>row.WarehouseKey),[1,2]);
  assert.deepEqual(filterInvoiceWarehouses(rows,scope,''),[]);
  assert.equal(filterInvoiceWarehouses(rows,scope,undefined),rows);
});
test('shared detail-step preserves sequence and crosses year explicitly', () => {
  const fs = require('node:fs'); const babel = require('next/dist/compiled/babel/core');
  const source = fs.readFileSync(require('node:path').join(__dirname,'../lib/useWeekInput.js'),'utf8');
  const compiled = babel.transformSync(source,{presets:['next/babel'],filename:'useWeekInput.js',babelrc:false,configFile:false}).code;
  const mod={exports:{}}; new Function('module','exports','require',compiled)(mod,mod.exports,require);
  assert.equal(mod.exports.stepWeek('2026-44-01','next'),'2026-44-02');
  assert.equal(mod.exports.stepWeek('2026-01-01','prev'),'2025-52-04');
  assert.equal(mod.exports.stepWeek('2026-52-04','next'),'2027-01-01');
  assert.equal(mod.exports.stepWeek('','next'),'');
});
test('warehouse cost browser normalizes explicit scope, refuses missing/zero/array fields', async () => {
  const { normalizeWarehouseBrowse } = await modulePromise;
  assert.deepEqual(normalizeWarehouseBrowse({ orderYear:'2026', orderWeek:'44-1' }), { orderYear:'2026', orderWeek:'44-01' });
  for (const input of [{}, {orderYear:'2026'}, {orderYear:2026,orderWeek:'44-01'}, {orderYear:'2026',orderWeek:'0-1'}, {orderYear:['2026'],orderWeek:'44-01'}]) assert.throws(() => normalizeWarehouseBrowse(input));
});
test('warehouse browse keeps same-week previous year separate and has no write query', async () => {
  const { listCostWarehouse } = await modulePromise;
  const rows = [{OrderYear:'2025',OrderWeek:'44-01',WarehouseKey:1},{OrderYear:'2026',OrderWeek:'44-01',WarehouseKey:2}];
  const queryFn = async (sql, params) => {
    assert.match(sql,/OrderYear=@orderYear AND OrderWeek=@orderWeek/);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i);
    return {recordset:rows.filter(row => row.OrderYear===params.orderYear.value && row.OrderWeek===params.orderWeek.value)};
  };
  const result = await listCostWarehouse({queryFn, types:{NVarChar:n=>n},input:{orderYear:'2026',orderWeek:'44-01'}});
  assert.deepEqual(result.rows.map(row=>row.WarehouseKey),[2]);
});
test('warehouse browse caps response and invalid input never reaches SQL', async () => {
  const { listCostWarehouse } = await modulePromise;
  await assert.rejects(listCostWarehouse({queryFn:()=>{throw new Error('must not query')},types:{},input:{orderYear:'2026',orderWeek:''}}), /조회 연도/);
  const result=await listCostWarehouse({queryFn:async()=>({recordset:Array(501).fill({})}),types:{NVarChar:n=>n},input:{orderYear:'2026',orderWeek:'44-01'}});
  assert.equal(result.rows.length,500);assert.equal(result.hasMore,true);
});
test('selected invoice exposes native download independently from unsupported link approval', () => {
  const fs=require('node:fs');
  const ui=fs.readFileSync(require('node:path').join(__dirname,'../components/import-tools/InvoiceReceiptWorkbench.js'),'utf8');
  const browser=fs.readFileSync(require('node:path').join(__dirname,'../components/import-tools/InvoiceWarehouseCostBrowse.js'),'utf8');
  assert.match(ui,/도착원가 엑셀 생성·다운로드 · 기존 입고/);
  assert.match(ui,/invoiceNo=\{documentValue.invoiceNo\}/);
  assert.match(browser,/filterInvoiceWarehouses\(state.rows/);
  assert.doesNotMatch(browser,/\/commit|link-existing/);
});
