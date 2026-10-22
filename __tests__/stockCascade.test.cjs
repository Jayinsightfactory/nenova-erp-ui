const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const helper=import('../lib/stockCascade.js');
test('caller transaction is reused and readback follows native success',async()=>{
  const {recalculateStockCascade}=await helper; const events=[],tq=async()=>{};
  const scope={orderYear:'2026',orderWeek:'19-01',uid:'fixture',prodKeys:[3074]};
  await recalculateStockCascade(tq,{},scope,{
    runNative:async args=>{assert.equal(args.orderYear,'2026');assert.equal(args.orderWeek,'19-01');
      await args.withTransactionFn(async q=>assert.equal(q,tq));events.push('native');},
    verify:async(q,types,document,keys)=>{assert.equal(q,tq);assert.deepEqual(document,{orderYear:'2026',orderWeek:'19-01'});assert.deepEqual(keys,[3074]);events.push('readback');},
  }); assert.deepEqual(events,['native','readback']);
});
for(const stage of ['native','readback'])test(`${stage} failure escapes to caller rollback`,async()=>{
  const {recalculateStockCascade}=await helper;let verified=false;
  await assert.rejects(recalculateStockCascade(async()=>{},{},{orderYear:'2026',orderWeek:'19-01',prodKeys:[3074]}, {
    runNative:async()=>{if(stage==='native')throw Error('native failed');},
    verify:async()=>{verified=true;throw Error('readback failed');},
  }),new RegExp(stage+' failed'));assert.equal(verified,stage==='readback');
});
test('deletion/decrease checks are before positive-only shortage policy',()=>{
  const estimate=fs.readFileSync('pages/api/estimate/update-date-quantity.js','utf8');
  assert.ok(estimate.indexOf('await verifyInvoiceStockReadback')<estimate.indexOf('if (!positiveFixedKeys.has'));
  const weekday=fs.readFileSync('lib/weekdayDistributionApply.js','utf8');
  assert.match(weekday,/assertNativeResult\(calculated\);\s*await verifyInvoiceStockReadback/);
  const legacy=fs.readFileSync('pages/api/shipment/stock-status.js','utf8');
  assert.match(legacy,/FIXED_SHIPMENT_SAFE_ROUTE_REQUIRED/);
  assert.match(legacy,/requireOrderYear\(week, year\)/);
});

function ghostHarness(rows){
 const source=fs.readFileSync('pages/api/shipment/ghost-master-cleanup.js','utf8')
   .replace(/^import .*;\r?\n/gm,'').replace(/export default[^;]+;/,'');
 let reads=0,writes=0;
 const query=async statement=>{if(/DELETE/.test(statement)){writes++;return {rowsAffected:[1]};}
   return {recordset:[rows[Math.min(reads++,rows.length-1)]]};};
 const handler=vm.runInNewContext(source+'\nhandler',{query,withTransaction:fn=>fn(query),sql:{Int:'Int'},console});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 return {run:()=>handler({method:'POST',body:{shipmentKey:1}},res),res,writes:()=>writes};
}
test('ghost cleanup positive: empty unfixed header deletes only after locked recheck',async()=>{
 const h=ghostHarness([{SmFix:0,FixedDetailCnt:0,VisCnt:0}]);await h.run();assert.equal(h.res.code,200);assert.equal(h.writes(),3);
});
for(const [label,rows] of [
 ['fixed detail under unfixed header',[{SmFix:0,FixedDetailCnt:1,VisCnt:0}]],
 ['fixed concurrently',[{SmFix:0,FixedDetailCnt:0,VisCnt:0},{SmFix:0,FixedDetailCnt:1,VisCnt:0}]],
 ['fixed header',[{SmFix:1,FixedDetailCnt:0,VisCnt:0}]],
 ['visible quantity',[{SmFix:0,FixedDetailCnt:0,VisCnt:1}]],
])test(`ghost cleanup blocks ${label}`,async()=>{const h=ghostHarness(rows);await h.run();assert.equal(h.writes(),0);assert.notEqual(h.res.code,200);});

for(const [label,body,expected] of [
 ['fixed delete',{week:'19-01',year:'2026',outQty:0},409],
 ['fixed decrease',{week:'19-01',year:'2026',outQty:1},409],
 ['missing year',{week:'19-01',outQty:0},400],
 ['cross-year disagreement',{week:'2026-19-01',year:'2025',outQty:0},400],
])test(`legacy endpoint ${label} performs no writes`,async()=>{
 const {requireOrderYear}=await import('../lib/orderUtils.js');
 const source=fs.readFileSync('pages/api/shipment/stock-status.js','utf8');
 const fn=source.slice(source.indexOf('async function updateOutQty('),source.indexOf('// ── DELETE: 수정내역'));
 let writes=0;
 const query=async(statement,params)=>{
  if(/\b(INSERT|UPDATE|DELETE)\b/.test(statement)){writes++;throw Error('unexpected write');}
  if(statement.includes('BaseOutDay'))return {recordset:[{BaseOutDay:0}]};
  assert.equal(params.yr.value,'2026');assert.equal(params.wk.value,'19-01');
  return {recordset:[{ShipmentKey:1}]};
 };
 const handler=vm.runInNewContext(fn+'\nupdateOutQty',{requireOrderYear,query,withTransaction:fn=>fn(query),sql:{Int:'Int',NVarChar:'NVarChar'}});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await handler({body:{custKey:1,prodKey:2,...body},user:{userId:'fixture'}},res);
 assert.equal(res.code,expected);assert.equal(writes,0);
});
test('every inline quantity save carries the queried row year, not the current year',()=>{
 const page=fs.readFileSync('pages/shipment/stock-status.js','utf8');
 const cells=[...page.matchAll(/<OutQtyCell[^>]+>/g)];assert.equal(cells.length,3);
 for(const [cell] of cells)assert.match(cell,/year=\{(?:r2|item)\.OrderYear\}/);
 assert.match(page,/week: wk, year, outQty: qty/g);
 assert.match(page,/pvEdit\.custName,pvEdit\.year/);
});
test('direct opening snapshot overwrite cannot bypass history or cascade',async()=>{
 const source=fs.readFileSync('pages/api/shipment/stock-status.js','utf8');
 const start=source.indexOf('async function saveStartStock('),next=source.indexOf('\nasync function ',start+1);
 const fn=source.slice(start,next<0?undefined:next);let writes=0;
 const handler=vm.runInNewContext(fn+'\nsaveStartStock',{withTransaction:()=>{writes++;throw Error('unexpected write');}});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await handler({body:{prodKey:3074,week:'2026-19-01',stock:0}},res);
 assert.equal(res.code,409);assert.equal(res.body.code,'DIRECT_STOCK_SNAPSHOT_WRITE_BLOCKED');assert.equal(writes,0);
});
