import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStockAdjustmentMatrixHandler } from '../lib/stockAdjustmentMatrixApi.js';
import { parseStockAdjustmentMatrixScope, loadStockAdjustmentMatrix, STOCK_ADJUSTMENT_MATRIX_SQL, STOCK_ADJUSTMENT_PERIODS_SQL } from '../lib/stockAdjustmentMatrixSql.js';

const response = () => ({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
test('explicit valid year, optional major and bounded search; no active-year fallback', () => {
  assert.deepEqual(parseStockAdjustmentMatrixScope({year:'2026',major:'41',search:' blue '}),{orderYear:'2026',major:'41',search:'blue',format:''});
  for(const input of [{},{year:['2026']},{year:'0000'},{year:'2026',major:'0'},{year:'2026',major:'54'},{year:'2026',major:'41-1'},{year:'2026',search:['x']},{year:'2026',search:'a'.repeat(101)},{year:'2026',format:'csv'}]) assert.equal(parseStockAdjustmentMatrixScope(input),null);
});
test('query and workbook share scope; export uses only actual adjustments without loading residual', async () => {
  const calls=[];const matrix={orderYear:'2026',major:'41',search:'블루',rows:[]};
  const handler=createStockAdjustmentMatrixHandler({loadMatrix:async scope=>{calls.push(scope);return matrix;},loadFlow:async()=>assert.fail('residual must not be loaded'),buildWorkbook:async (m,flow)=>{assert.equal(m,matrix);assert.equal(flow,undefined);return {xlsx:{writeBuffer:async()=>Buffer.from('fixture')}};}});
  const res=response();await handler({method:'GET',query:{year:'2026',major:'41',search:'블루'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.source,'StockHistory');assert.equal(calls.length,1);
  const excel=response();await handler({method:'GET',query:{year:'2026',major:'41',search:'블루',format:'xlsx'}},excel);
  assert.equal(excel.body.toString(),'fixture');assert.equal(calls.at(-1).orderYear,'2026');assert.equal(calls.length,2);assert.match(excel.headers['Content-Disposition'],/2026/);assert.equal(excel.headers['Cache-Control'],'private, no-store');
});
test('mutation, bad scope, stale year and failed reads cannot export a misleading workbook',async()=>{
  let loaded=0;const handler=createStockAdjustmentMatrixHandler({loadMatrix:async()=>{loaded++;return {orderYear:'2025'};},loadFlow:()=>assert.fail('must not export'),buildWorkbook:()=>assert.fail('must not export')});
  for(const [req,code] of [[{method:'POST',query:{year:'2026'}},405],[{method:'GET',query:{}},400],[{method:'GET',query:{year:'2026',format:'xlsx'}},500]]){const res=response();await handler(req,res);assert.equal(res.statusCode,code);assert.equal(res.body.ok,false);}
  assert.equal(loaded,1);
  const failing=createStockAdjustmentMatrixHandler({loadMatrix:async()=>{throw Error('secret SQL text');}});const res=response();await failing({method:'GET',query:{year:'2026'}},res);assert.equal(res.statusCode,500);assert.doesNotMatch(res.body.message,/secret/);
});
test('annual SELECT is year-scoped and uses shared EXISTS policy without multiplying duplicate codes',async()=>{
  assert.match(STOCK_ADJUSTMENT_MATRIX_SQL,/sh.OrderYear = @year/);assert.match(STOCK_ADJUSTMENT_MATRIX_SQL,/EXISTS[\s\S]*Category = N'StockType'/);assert.doesNotMatch(STOCK_ADJUSTMENT_MATRIX_SQL,/@major|@prefix/);
  for(const q of [STOCK_ADJUSTMENT_MATRIX_SQL,STOCK_ADJUSTMENT_PERIODS_SQL])assert.doesNotMatch(q,/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|EXEC)\b/i);
  const calls=[];const data=await loadStockAdjustmentMatrix({sql:{NVarChar:'nvarchar'},query:async(q,p)=>{calls.push(p.year.value);return {recordset:q===STOCK_ADJUSTMENT_MATRIX_SQL?[{orderYear:'2025',orderWeek:'41-01',prodKey:1,beforeValue:0,afterValue:100},{orderYear:'2026',orderWeek:'41-01',prodKey:1,beforeValue:0,afterValue:1,unit:'단'}]:[{orderWeek:'41-01'},{orderWeek:'41-02'}]};}},{orderYear:'2026',major:'41',search:''});
  assert.deepEqual(calls,['2026','2026']);assert.equal(data.eventCount,1);assert.equal(data.rows[0].net,1);
  assert.match(fs.readFileSync('pages/api/sales/stock-adjustment-matrix.js','utf8'),/withAuth\(createStockAdjustmentMatrixHandler/);
});
