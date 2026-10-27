const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../lib/invoiceWarehouseBrowse.js');
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
