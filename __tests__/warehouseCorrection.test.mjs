import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {normalizedCorrection,buildCorrectionPlan} from '../lib/warehouseCorrectionPolicy.js';
import {prepareWarehouseCorrection,commitWarehouseCorrection} from '../lib/warehouseCorrection.js';

const types={Int:'int',NVarChar:'nvarchar',Float:'float'};
export const header={WarehouseKey:90,OrderYear:'2026',OrderWeek:'44-01',FarmName:'Farm A',InvoiceNo:'I-1',OrderNo:'A-1',InputDate:'2026-11-01',isDeleted:false,FileName:'old.xlsx'};
export const detail={WdetailKey:901,WarehouseKey:90,ProdKey:1,OrderCode:'C',BoxQuantity:1,BunchQuantity:10,SteamQuantity:100,OutQuantity:10,EstQuantity:100,UPrice:1,TPrice:100,SteamOf1Box:100,SteamOf1Bunch:10};
export const products=[{ProdKey:1,ProdName:'Flower A',OutUnit:'단',EstUnit:'송이',CountryFlower:'TEST',isDeleted:false},{ProdKey:2,ProdName:'Flower B',OutUnit:'단',EstUnit:'송이',CountryFlower:'TEST',isDeleted:false}];
export const farmInput={warehouseKey:90,orderYear:'2026',orderWeek:'44-01',mode:'FARM',farmName:'Farm B'};
export const replaceInput={...farmInput,mode:'REPLACE',farmName:'Farm A',fileName:'fixed.xlsx',fileMeta:{orderYear:'2026',orderWeek:'44-01',invoiceNo:'I-1',awb:'A-1',inputDate:'2026/11/01'},items:[{prodName:'Flower B',orderCode:'C',boxQty:1,bunchQty:10,steamQty:100,steamOf1Box:100,steamOf1Bunch:10,unitPrice:1,totalPrice:100}]};

function fixture({connection='',fixed=false,fail='',negative=false,gateBusy=false,gateReady=true}={}){
  let state={header:structuredClone(header),details:[structuredClone(detail)],stock:{1:10,2:0},audit:[],history:[],calculated:[]};const calls=[];
  const q=async(text,params={})=>{
    calls.push(text);const p=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,v.value]));let recordset=[];
    if(text.includes('correction:header'))recordset=state.header.OrderYear===p.year?[structuredClone(state.header)]:[];
    else if(text.includes('correction:details'))recordset=structuredClone(state.details);
    else if(text.includes('correction:products'))recordset=structuredClone(products);
    else if(text.includes('correction:farm */'))recordset=[{FarmKey:2,FarmName:p.farm}];
    else if(text.includes('correction:gate-read'))recordset=[{ProtocolVersion:2,Mode:gateBusy?'RUN':null,LockedAt:null,Action:null,OrderYear:null,OrderWeek:null,OwnerSessionID:null,OwnerToken:null,PendingCalc:0,CalcProdKey:null}];
    else if(text.includes('correction:capability'))recordset=[{ProtocolVersion:2,IsReady:gateReady?1:0}];
    else if(text.includes('correction:connections'))recordset=['FREIGHT','INVOICE','INVOICE_COST','FREIGHT_DETAIL','STOCK_TYPE','ARRIVAL','WEEK_COST','PROFIT','FARM_DISTRIBUTION'].map(Code=>({Code,Count:Code===connection?1:0}));
    else if(text.includes('DECLARE @products TABLE'))return {recordsets:[products.filter(v=>Object.values(p).includes(v.ProdKey)),[{CurrentYearWeek:'20264401',PreviousYearWeek:null,NextYearWeek:null}],fixed?[{Phase:'CURRENT_FIXED',OrderYearWeek:'20264401',CountryFlower:'TEST',ProdKey:1,ProdName:'Flower A'}]:[]]};
    else if(text.includes('correction:replay'))recordset=state.audit.filter(a=>a.op===p.op).map(a=>({Payload:a.payload}));
    else if(text.includes('correction:update-header'))state.header.FarmName=p.farm;
    else if(text.includes('correction:replace-details'))state.details=[];
    else if(text.includes('correction:insert-detail'))state.details.push(Object.fromEntries(['ProdKey','OrderCode','BoxQuantity','BunchQuantity','SteamQuantity','OutQuantity','EstQuantity','UPrice','TPrice','SteamOf1Box','SteamOf1Bunch'].map(k=>[k,p[k]])));
    else if(text.includes('correction:stock-delta')){state.stock[p.pk]+=p.delta;state.history.push(p.delta);recordset=[{ActualStock:state.stock[p.pk],ExpectedStock:state.stock[p.pk]}];}
    else if(text.includes('correction:calculate')){if(fail==='calculate')throw Error('injected calc failure');state.calculated.push(p.pk);recordset=[{result:0,returnCode:0}];}
    else if(text.includes('correction:negative'))recordset=negative?[{ProdKey:1,OrderYear:'2027',OrderWeek:'01-01',Stock:-1}]:[];
    else if(text.includes('correction:audit')){if(fail==='audit')throw Error('injected audit failure');state.audit.push({op:p.op,payload:p.payload});}
    return {recordset};
  };
  const transact=async fn=>{const before=structuredClone(state);try{return await fn(q);}catch(e){state=before;throw e;}};
  const preview=input=>prepareWarehouseCorrection({queryFn:q,types,input});
  const commit=(input,options={})=>commitWarehouseCorrection({withTransactionFn:transact,types,input,actor:'tester',gateFn:async()=>({}),verifyStockFn:async()=>({verified:true}),...options});
  return {q,preview,commit,get state(){return state;},calls};
}
const approved=async(f,input)=>({...input,baselineDigest:(await f.preview(input)).baselineDigest,operationId:randomUUID(),reason:'오입고 정정',confirmed:true});

test('FARM preserves detail, stock; A→B subtracts old and adds new, distinct native units',()=>{
  const farm=buildCorrectionPlan(normalizedCorrection(farmInput),header,[detail],products);assert.equal(farm.detailsChanged,false);assert.equal(farm.changes[0].delta,0);
  const plan=buildCorrectionPlan(normalizedCorrection(replaceInput),header,[detail],products);assert.deepEqual(plan.changes.map(c=>c.delta),[-10,10]);assert.equal(plan.after[0].EstQuantity,100);
});
test('explicit zero preserved, omitted/invalid/negative rejected, cross-year same week rejected',()=>{
  const zero={...replaceInput,items:[{...replaceInput.items[0],bunchQty:0,steamQty:0,totalPrice:0}]};assert.equal(normalizedCorrection(zero).items[0].bunchQty,0);
  for(const value of [undefined,null,'',false,-1,NaN,Infinity])assert.throws(()=>normalizedCorrection({...replaceInput,items:[{...replaceInput.items[0],bunchQty:value}]}));
  assert.throws(()=>normalizedCorrection({...farmInput,orderYear:'2025'}));assert.throws(()=>buildCorrectionPlan(normalizedCorrection(farmInput),{...header,OrderYear:'2027'},[detail],products));
  assert.throws(()=>normalizedCorrection({...farmInput,items:[]}));
});
test('file identity mismatch, ambiguous and unknown products fail before writing',()=>{
  for(const key of ['orderYear','orderWeek','invoiceNo','awb','inputDate'])assert.throws(()=>buildCorrectionPlan(normalizedCorrection({...replaceInput,fileMeta:{...replaceInput.fileMeta,[key]:'wrong'}}),header,[detail],products));
  assert.throws(()=>buildCorrectionPlan(normalizedCorrection(replaceInput),header,[detail],[products[0]]));
  assert.throws(()=>buildCorrectionPlan(normalizedCorrection(replaceInput),header,[detail],[...products,products[1]]));
});
test('all linkage blockers and native fixed blocker share preview/commit policy',async()=>{
  for(const connection of ['FREIGHT','INVOICE','INVOICE_COST','FREIGHT_DETAIL','STOCK_TYPE','ARRIVAL','WEEK_COST','PROFIT','FARM_DISTRIBUTION']){
    const f=fixture({connection});assert.equal((await f.preview(replaceInput)).canCommit,false);await assert.rejects(()=>f.commit({...replaceInput,baselineDigest:'a'.repeat(64),operationId:randomUUID(),reason:'fix',confirmed:true}));assert.equal(f.calls.some(t=>t.includes('correction:update-header')),false);
  }
  assert.equal((await fixture({fixed:true}).preview(farmInput)).canCommit,false);
});
test('atomic A→B, native calculations for both products, same-operation retry once',async()=>{
  const f=fixture(),input=await approved(f,replaceInput);const result=await f.commit(input);assert.equal(result.warehouseKey,90);assert.deepEqual(f.state.stock,{1:0,2:10});assert.deepEqual(f.state.calculated,[1,2]);
  assert.equal((await f.commit(input)).replayed,true);assert.equal(f.state.audit.length,1);assert.equal(f.state.history.length,2);
  await assert.rejects(()=>f.commit({...input,reason:'different'}),{code:'CORRECTION_OPERATION_CONFLICT'});
});
test('farm-only preserves exact detail keys and all stock',async()=>{
  const f=fixture();await f.commit(await approved(f,farmInput));assert.deepEqual(f.state.details,[detail]);assert.deepEqual(f.state.calculated,[]);assert.deepEqual(f.state.history,[]);
});
test('calculation/audit/readback/negative future stock failures roll back everything',async()=>{
  for(const options of [{fail:'calculate'},{fail:'audit'},{negative:true},{}]){
    const f=fixture(options),before=structuredClone(f.state),input=await approved(f,replaceInput);
    await assert.rejects(()=>f.commit(input,Object.keys(options).length?{}:{verifyStockFn:async()=>{throw Error('readback mismatch');}}));assert.deepEqual(f.state,before);
  }
});
test('stale master, no explicit confirmation, missing reason and invalid op cannot write',async()=>{
  const f=fixture(),input=await approved(f,replaceInput);f.state.header.InvoiceNo='changed';await assert.rejects(()=>f.commit(input));assert.equal(f.state.audit.length,0);
  for(const patch of [{confirmed:false},{reason:''},{operationId:'bad'},{baselineDigest:''}])await assert.rejects(()=>f.commit({...input,...patch}));
});
test('preview blocks busy/incomplete native gate, missing file metadata preserves existing identity',async()=>{
  for(const options of [{gateBusy:true},{gateReady:false}])assert.equal((await fixture(options).preview(farmInput)).canCommit,false);
  assert.equal((await fixture().preview({...replaceInput,fileMeta:{}})).canCommit,true);
});
test('API denies unauthorized users and unsupported actions before any work; GET cannot override dependencies',async()=>{
  let reads=0,writes=0;
  const source=fs.readFileSync(new URL('../pages/api/warehouse/correction.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'').replace('export const config','const config').replace('export default withAuth','const handler=withAuth');
  const handler=new Function('withAuth','query','withTransaction','sql','canManageInvoiceReceipt','readWarehouseCorrection','prepareWarehouseCorrection','commitWarehouseCorrection',`${source}; return handler;`)(
    h=>h,()=>{},()=>{},types,u=>u?.allowed===true,async args=>{reads++;assert.equal(typeof args.queryFn,'function');return {};},async()=>({canCommit:true,baselineDigest:'a'.repeat(64),issues:[],plan:{changes:[],before:[],after:[]},receipt:{header:{FarmName:'A'}},request:{farmName:'B'}}),async()=>{writes++;return {};});
  const response=()=>({statusCode:200,body:null,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},end(){}});
  for(const method of ['GET','POST']){const res=response();await handler({method,user:{},body:{action:'commit'},query:{}},res);assert.equal(res.statusCode,403);}
  assert.equal(reads+writes,0);
  const unsupported=response();await handler({method:'DELETE',user:{allowed:true}},unsupported);assert.equal(unsupported.statusCode,405);
  const read=response();await handler({method:'GET',user:{allowed:true,userId:'tester'},query:{queryFn:'spoof',types:'spoof'}},read);assert.equal(reads,1);assert.equal(read.body.draftOwner,'tester');
  const unknown=response();await handler({method:'POST',user:{allowed:true},body:{action:'delete'}},unknown);assert.equal(unknown.statusCode,400);assert.equal(writes,0);
});
