import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx-js-style';
import {createCountryOrderHistoryStore} from '../lib/countryOrderHistoryStore.js';
import {createCountryOrderHistoryHandler} from '../lib/countryOrderHistoryApi.js';
import {buildCountryOrderMatrix} from '../lib/countryOrderSource.js';
import {generateCompactCountryOrders} from '../lib/countryOrderPresentation.js';
import {serializePedidosWorkbook} from '../lib/importPedidos.js';
import {withCountryOrderEta} from '../lib/countryOrderEta.js';
const scope={country:'China',year:2026,orderWeek:'46-02'};
const selection={sourceKey:'message-1/row-1',custKey:'1',prodKey:2};
const item={...selection,scope,rawCustomer:'업체1',rawProduct:'ROSE Test',unit:'bunches',quantity:20,at:'2026-11-19T02:00:00Z',kind:'addition'};
const options={farms:['Melody','CLOUD'],split:false,selected:{}};
const matrix=qty=>buildCountryOrderMatrix({success:true,readOnly:true,scope:{...scope,majorWeek:'46',counName:'중국',scopeKey:'China/2026/46'},subweeks:[{orderWeek:scope.orderWeek}],rows:[{OrderYear:scope.year,OrderWeek:scope.orderWeek,CustKey:1,CustName:'업체1',CustOrderCode:'CL1',ProdKey:2,ProdName:'ROSE Test',FlowerName:'장미',CounName:'중국',OutUnit:'단',OutQuantity:qty,BunchQuantity:qty,SteamQuantity:qty*10,SourceRowCount:1}]},scope.orderWeek);
function response(){return {code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;},end(){return this;}};}
test('actual generator→immutable XLSX→explicit delivery→reopen same bytes; 100/120/partial and no paid/ERP writers',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'country-order-api-test-'));
  try{
    const store=createCountryOrderHistoryStore({root});let qty=100,queriedAt='2026-11-19T01:00:00Z',events=[],reads=0;
    const handler=createCountryOrderHistoryHandler({store,secret:'isolated-test-only-secret',canAccess:user=>user?.userId==='fixture',readCurrent:async()=>{reads++;return{matrix:matrix(qty),queriedAt,details:[],events};},readMessages:async()=>[{id:'message-1',text:'TEST_ONLY 추가20단',items:[item]}],generate:(m,opts,eta)=>generateCompactCountryOrders(m,opts).map(output=>({...output,bytes:Buffer.from(serializePedidosWorkbook(eta?withCountryOrderEta(output.workbook,scope.orderWeek,eta):output.workbook))}))});
    async function call(body,method='POST',query={}){const res=response();await handler({method,user:{userId:'fixture'},body,query},res);return res;}
    const first=await call({action:'preview',scope,selections:[],options});assert.equal(first.code,200);assert.equal((await store.list(scope)).length,0);
    const filename=first.body.outputs[0].filename;
    const request={action:'download',scope,selections:[],options,filename,id:first.body.outputIds[filename],previewToken:first.body.previewToken,eta:'2026-11-26'};
    const download=await call(request);assert.equal(download.code,200);const bytes=Buffer.from(download.body.file,'base64');
    const workbook=XLSX.read(bytes,{type:'buffer'});const cells=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1});assert.match(cells[0][0],/2026/);assert.ok(cells.some(row=>row.includes(100)));assert.equal(download.body.record.deliveredAt,null);
    const beforeReads=reads;assert.deepEqual((await call(request)).body.file,download.body.file);assert.equal(reads,beforeReads);
    assert.equal((await call({...request,eta:'2026-11-27'})).code,409,'an immutable operation cannot silently change ETA');
    assert.equal((await call({...request,id:'00000000-0000-4000-8000-000000000001',previewToken:request.previewToken+'tamper'})).code,409,'tampered preview never archives');
    assert.equal((await call({action:'preview',scope,selections:[],options,expectedFingerprint:'stale'})).code,409,'stale native/baseline evidence requires explicit requery');
    assert.equal((await store.list(scope)).length,1);
    const saved=download.body.record;assert.equal((await call({action:'delivered',scope,id:saved.id,sha256:saved.sha256,confirmed:true})).code,200);
    const reopened=await call(null,'GET',{...scope,id:saved.id,file:'1'});assert.equal(reopened.code,200);assert.ok(reopened.body.equals(bytes));
    assert.equal(reopened.headers['X-Content-SHA256'],saved.sha256);
    qty=120;queriedAt='2026-11-19T03:00:00Z';events=[{id:'history:1',scope,custKey:1,prodKey:2,unit:'bunches',orderDetailKey:9,kind:'increase',before:100,after:120,at:'2026-11-19T02:05:00Z'}];
    const registered=await call({action:'preview',scope,selections:[selection],decisions:{[item.sourceKey]:{mode:'registered',eventId:'history:1'}},options});assert.equal(registered.code,200);assert.equal(registered.body.outputs[0].totalQuantity,120);
    // New store instance represents reopening on the same durable storage;
    // the old original must not be regenerated using the now-changed ERP.
    const restarted=createCountryOrderHistoryStore({root});
    const original=await restarted.read(scope,saved.id);
    assert.ok(original.deliveredAt);assert.equal(createHash('sha256').update(original.bytes).digest('hex'),saved.sha256);
    assert.ok(original.bytes.equals(bytes));
    const originalWorkbook=XLSX.read(Buffer.from(original.bytes),{type:'buffer'});
    assert.deepEqual(XLSX.utils.sheet_to_json(originalWorkbook.Sheets[originalWorkbook.SheetNames[0]],{header:1}),cells);
    qty=100;events=[];
    const fresh=await call({action:'preview',scope,selections:[selection,selection],decisions:{[item.sourceKey]:{mode:'new',confirmed:true}},options});assert.equal(fresh.code,200);assert.equal(fresh.body.outputs[0].totalQuantity,120);assert.equal(fresh.body.reconciliation.duplicateCount,1);
    qty=110;assert.equal((await call({action:'preview',scope,selections:[selection],decisions:{[item.sourceKey]:{mode:'new',confirmed:true}},options})).code,409);
    const prior=await call(null,'GET',{...scope,year:2025,historyOnly:'1'});assert.deepEqual(prior.body.history,[]);
    const denied=response();await handler({method:'POST',user:{userId:'sales'},body:request},denied);assert.equal(denied.code,403);
  }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});

test('China 2026/46-02 unavailable chat source is an error, never a healthy zero or downloadable preview',async()=>{
  const actualScope={country:'China',year:2026,orderWeek:'46-02'};let generated=0;
  const handler=createCountryOrderHistoryHandler({
    store:{list:async()=>[],withScopeLock:async(_scope,operation)=>operation()},secret:'test-only',canAccess:()=>true,
    readCurrent:async incoming=>{assert.deepEqual(incoming,actualScope);return{queriedAt:'2026-11-19T08:00:00Z',matrix:{scope:actualScope,customers:[],rows:[]},details:[],events:[]};},
    readMessages:async()=>{throw Error('private upstream failure must not leak');},
    generate:()=>{generated++;return[];}
  });
  for(const method of ['GET','POST']){
    const res=response();await handler({method,user:{userId:'fixture'},query:actualScope,body:{action:'preview',scope:actualScope,selections:[]}},res);
    assert.equal(res.code,500);assert.equal(res.body.code,'COUNTRY_ORDER_HISTORY_UNAVAILABLE');
    assert.equal(Object.hasOwn(res.body,'messages'),false);assert.equal(Object.hasOwn(res.body,'outputs'),false);
    assert.doesNotMatch(res.body.error,/private upstream/);
  }
  assert.equal(generated,0);
});
