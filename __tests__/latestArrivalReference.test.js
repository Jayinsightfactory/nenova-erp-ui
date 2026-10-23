import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectLatestArrivalReferences,latestArrivalScalar,loadLatestArrivalReferences,latestArrivalKey } from '../lib/latestArrivalReference.js';

const ref={orderYear:'2026',week:'9-2',unit:'단',cost:1200,sourceKind:'EXCEL'};
test('numeric latest, same year, explicit as-of and all farms preserved',()=>{
 const rows=[ref,{...ref,week:'40-01',cost:1400},{...ref,week:'40-1',farm:'B',cost:1500},{...ref,orderYear:'2025',week:'52-2',cost:9999}];
 assert.equal(selectLatestArrivalReferences(rows,'2026').length,2);
 assert.equal(latestArrivalScalar(selectLatestArrivalReferences(rows,'2026')).arrivalCost,1500);
 assert.equal(selectLatestArrivalReferences(rows,'2026','10-1')[0].cost,1200);
 assert.deepEqual(selectLatestArrivalReferences(rows,'2027'),[]);
 assert.throws(()=>selectLatestArrivalReferences(rows,'2026','bad'));
});
test('latest invalid unit cannot hide behind an old valid value; input unchanged',()=>{
 const rows=[ref,{...ref,week:'40-1',cost:null,conversionError:'단위 확인'}],before=JSON.stringify(rows);
 assert.equal(latestArrivalScalar(selectLatestArrivalReferences(rows,'2026')),null);
 assert.equal(latestArrivalScalar([{...ref,unit:'송이'},ref]),null);
 assert.equal(latestArrivalScalar([{...ref,cost:0}]).arrivalCost,0);
 assert.equal(JSON.stringify(rows),before);
});
test('real shared loader executes SELECT only and isolates product/year/units',async()=>{
 const calls=[];
 const source={OrderYear:'2026',OrderWeek:'42-01',ProdKey:1,ArrivalLineKey:1,ArrivalUnit:'단',SelectedArrivalCostKRW:1200,OutUnit:'단',EstUnit:'송이',SteamOf1Bunch:10};
 const query=async(sql,params)=>{
  assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|EXEC|CREATE|ALTER)\b/i);calls.push({sql,params});
  if(sql.includes('arrival-invoice:schema')) return {recordset:[{Available:0}]};
  if(sql.includes('WebArrivalCostLine')) return {recordset:[source,{...source,OrderYear:'2025',SelectedArrivalCostKRW:9999}]};
  return {recordset:[{ProdKey:1,OutUnit:'단',EstUnit:'송이',SteamOf1Bunch:10}]};
 };
 const items=[{prodKey:1,unit:'단'},{prodKey:1,unit:'송이'},{prodKey:2,unit:'단'}];
 const result=await loadLatestArrivalReferences({orderYear:'2026',items},query);
 assert.equal(result[latestArrivalKey(items[0])][0].cost,1200);
 assert.equal(result[latestArrivalKey(items[1])][0].cost,120);
 assert.deepEqual(result[latestArrivalKey(items[2])],[]);
 assert.equal(calls.find(call=>call.sql.includes('WebArrivalCostLine')).params.yr.value,'2026');
 await assert.rejects(()=>loadLatestArrivalReferences({orderYear:'bad',items},query),/연도/);
 await assert.rejects(()=>loadLatestArrivalReferences({orderYear:'2026',items},async()=>{throw Error('read failure')}),/read failure/);
});
test('all reference consumers use shared loader without changing accounting writers',()=>{
 for(const file of ['pages/api/catalog/bootstrap.js','lib/pivotStats.js','lib/pivotArrivalLedger.js'])
  assert.match(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/loadLatestArrival/);
 for(const file of ['pages/incoming.js','pages/freight.js','pages/sales/profit-report.js'])
  assert.match(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/LatestArrivalReference/);
 for(const file of ['lib/raumPnl.js','lib/profitReport.js','lib/pivotFreightArrival.js','lib/invoiceReceiptCost.js'])
  assert.doesNotMatch(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/loadLatestArrival/);
});
