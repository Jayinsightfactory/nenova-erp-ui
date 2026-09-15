import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizePivotExeRange } from '../lib/pivotExeRange.js';
const range = normalizePivotExeRange({ fromYear: 2025, fromWeek: '36-1', toYear: 2026, toWeek: '35-2' });
assert.equal(range.weekFrom, '20253601');
assert.equal(range.weekTo, '20263502');
assert.equal(normalizePivotExeRange({fromYear:2026,fromWeek:'37-01a',toYear:2026,toWeek:'37-02b'}).weekFrom,'20263701A');
for (const extra of [{fromYear:undefined},{fromYear:''},{fromYear:0},{fromYear:2026},{fromWeek:'37-00'},{toWeek:"35-02';DELETE"},{fromYear:['2025']}]) {
  assert.throws(()=>normalizePivotExeRange({fromYear:2025,fromWeek:'36-01',toYear:2026,toWeek:'35-02',...extra}));
}
const api=fs.readFileSync(new URL('../pages/api/stats/pivot-exe.js',import.meta.url),'utf8');
assert.match(api,/withAuth/);
assert.match(api,/req\.method !== 'GET'/);
assert.match(api,/sqlQuantityPivotGetData\(\)/);
assert.match(api,/range\.weekFrom/);
assert.match(api,/range\.weekTo/);
assert.doesNotMatch(api,/\b(?:INSERT\s+INTO|UPDATE\s+dbo|DELETE\s+FROM|ALTER\s+|EXEC\s+dbo)\b/i);
console.log('pivotExeRange: cross-year, explicit endpoint, near-miss, readonly API contract passed');

// Execute handler branches with a fake DB. No credentials/network/ERP mutations.
const calls=[];
let failDb=false;
let fakeRows=[{OrderYear:'2025',OrderWeek:'36-01',ProdKey:12,Quantity:0.125}];
const context={normalizePivotExeRange,sql:{NVarChar:'NVarChar'},withAuth:h=>h,
  sqlQuantityPivotGetData:()=> 'EXE_READ_ONLY_QUERY',
  sqlPivotExeDistributionCosts:()=> 'DIST_READ_ONLY_QUERY',
  getArrivalCostsForWeekRange:async()=>({12:{arrivalCost:17000}}),
  enrichPivotExeRows:(rows)=>rows.map(row=>({...row,DistCost:null,ArrivalCost:17000})),
  query:async(q,p)=>{calls.push({q,p});if(failDb)throw Error('private database detail');return {recordset:fakeRows};},
  console:{error:()=>{}},handler:null};
vm.runInNewContext(api.replace(/^import .*;\r?\n/gm,'').replace('export default withAuth','handler = withAuth'),context);
const request=async(method,query)=>{
  const response={headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(body){this.body=body;return this;}};
  await context.handler({method,query},response);
  return response;
};
let response=await request('POST',{});
assert.equal(response.code,405);assert.equal(calls.length,0);
response=await request('GET',{});assert.equal(response.code,400);assert.equal(calls.length,0);
response=await request('GET',{fromYear:2025,fromWeek:'36-01',toYear:2026,toWeek:'35-02'});
assert.equal(response.code,200);assert.equal(calls[0].p.weekFrom.value,'20253601');assert.equal(calls[0].p.weekTo.value,'20263502');
assert.equal(response.body.rows[0].Quantity,0.125);assert.equal(response.body.rows[0].ArrivalCost,17000);assert.match(response.headers['Cache-Control'],/no-store/);
response=await request('GET',{mode:'weeks'});assert.equal(response.code,200);assert.match(calls.find(call=>/FROM StockMaster/.test(call.q)).q,/FROM StockMaster/);
failDb=true;
response=await request('GET',{mode:'weeks'});assert.equal(response.code,500);assert.doesNotMatch(response.body.error,/private/);
response=await request('GET',{fromYear:2025,fromWeek:'36-01',toYear:2026,toWeek:'35-02'});assert.equal(response.code,500);assert.doesNotMatch(response.body.error,/private/);
failDb=false;fakeRows=Array(200001).fill({});
response=await request('GET',{fromYear:2025,fromWeek:'36-01',toYear:2026,toWeek:'35-02'});assert.equal(response.code,422);assert.equal(response.body.rows,undefined);
console.log('pivotExe API branches passed: no POST, no query on invalid scope, bound endpoints, exact numbers, failure and size guards');
