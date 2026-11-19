import test from 'node:test';
import assert from 'node:assert/strict';
import {createColombiaWeekCostHandler} from '../lib/colombiaWeekCostApi.js';
const scope={country:'CO',orderYear:'2026',orderWeek:'46-02'};
const hash='a'.repeat(64),awb='01441369974';
const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}});
function setup(){
 const calls={prepare:0,generate:0,preserve:0};
 const prepared={scope,baselineDigest:'baseline',issues:[],awbs:[{awb,members:[{warehouseKey:1}],manifest:{awb}}],documents:[{warehouseKey:1,invoiceNo:'TEST_ONLY',receiptLines:[{lineId:'original',actualQuantity:100}]}],excluded:[]};
 const calculation={status:'CALCULATED',scope,versionHash:hash,customsSources:[],lines:[]};
 const dependencies={authorize:user=>user?.allowed===true,prepare:async()=>{calls.prepare++;return prepared;},calculate:()=>calculation,generate:async()=>{calls.generate++;return Buffer.from('TEST_ONLY');},preserve:async options=>{calls.preserve++;calls.snapshot=options.snapshot;return{bytes:await options.createWorkbook(),metadata:{scope,versionHash:hash,sha256:'b'.repeat(64)}};},readVersion:async options=>{calls.read=options;return null;}};
 const request={method:'POST',user:{userId:'TEST_ONLY',allowed:true},body:{...scope,action:'download',baselineDigest:'baseline',versionHash:hash,awbInputs:[{awb,input:{gw:100}}],customsPools:[]}};
 return {calls,prepared,dependencies,request};
}
test('authorization/method/body checked before any ERP source read',async()=>{
 const s=setup(),handler=createColombiaWeekCostHandler(s.dependencies);
 for(const [req,status] of [[{...s.request,method:'GET'},405],[{...s.request,user:{}},403],[{...s.request,body:[]},400],[{...s.request,body:{...s.request.body,lineInputs:{}}},400]]){const res=response();await handler(req,res);assert.equal(res.statusCode,status);}
 assert.equal(s.calls.prepare,0);assert.equal(s.calls.preserve,0);
});
test('server source projection and two freshness fences; downloadable one-version identity',async()=>{
 const s=setup();s.request.body.calculation={lines:[{actualQuantity:99999}]};const res=response();await createColombiaWeekCostHandler(s.dependencies)(s.request,res);
 assert.equal(res.statusCode,200);assert.equal(s.calls.prepare,3);assert.equal(s.calls.generate,1);assert.equal(s.calls.snapshot.rows[0].rows[0].actualQuantity,100);assert.equal(res.headers['X-Cost-Version'],hash);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('stale source/version and ambiguous rows block archive; unknown or duplicate AWB never added',async()=>{
 for(const change of [s=>s.request.body.baselineDigest='old',s=>s.request.body.versionHash='old',s=>s.prepared.issues.push({code:'UNKNOWN_GROUP'}),s=>s.request.body.awbInputs.push({awb:'16017338005',input:{}}),s=>s.request.body.awbInputs.push({awb,input:{}})]){
  const s=setup();change(s);const res=response();await createColombiaWeekCostHandler(s.dependencies)(s.request,res);assert.ok(res.statusCode>=400);assert.equal(s.calls.preserve,0);
 }
});
test('late source during generation fails before original publication; internal errors do not expose secrets',async()=>{
 const s=setup();s.dependencies.prepare=async()=>{s.calls.prepare++;return{...s.prepared,baselineDigest:s.calls.prepare>1?'late':'baseline'};};const res=response();await createColombiaWeekCostHandler(s.dependencies)(s.request,res);assert.equal(res.statusCode,409);assert.match(res.body.error,/保管|보관/);
 const next=setup();next.dependencies.prepare=async()=>{throw Error('private SQL credentials');};const failure=response();await createColombiaWeekCostHandler(next.dependencies)(next.request,failure);assert.equal(failure.statusCode,500);assert.doesNotMatch(failure.body.error,/credentials/);
});
test('historical original access stays owner/exact-scope bound and does not query current ERP',async()=>{
 const s=setup();s.request.body={...scope,action:'openVersion',versionHash:hash};const res=response();await createColombiaWeekCostHandler(s.dependencies)(s.request,res);assert.equal(res.statusCode,404);assert.equal(s.calls.prepare,0);assert.equal(s.calls.read.owner,'TEST_ONLY');assert.deepEqual(s.calls.read.scope,scope);
});
test('nonzero legacy expense cannot disappear or cross AWB; explicit zero weight references need no blanket confirmation',async()=>{
 const s=setup();s.prepared.excluded=[{wdetailKey:101,awb,amount:15},{wdetailKey:102,awb,amount:0}];
 const handler=createColombiaWeekCostHandler(s.dependencies),missing=response();await handler(s.request,missing);assert.equal(missing.statusCode,422);assert.equal(s.calls.preserve,0);
 s.request.body.expenseDecisions=[{wdetailKey:101,confirmed:true,treatment:'INCLUDED_IN_AWB_INPUT',awb:'16017338005',evidence:'TEST_ONLY bill'}];
 const crossed=response();await handler(s.request,crossed);assert.equal(crossed.statusCode,422);
 s.request.body.expenseDecisions[0].awb=awb;const accepted=response();await handler(s.request,accepted);assert.equal(accepted.statusCode,200);assert.equal(s.calls.snapshot.expenseDecisions.length,1);
});
