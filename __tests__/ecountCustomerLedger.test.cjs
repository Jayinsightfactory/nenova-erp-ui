const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateLedger,validateFailure}=require('../lib/ecountLedgerValidation.cjs');
const policy=require('../lib/ecountCustomerLedgerPolicy.cjs');
const schedule=require('../lib/ecountLedgerSchedule.cjs');
const now=new Date('2026-10-27T02:00:00Z');
const sample=()=>({program:'E040723',mode:'voucher',individual:true,custKey:7,periodFrom:'2026-09-27',periodTo:'2026-10-27',opening:100,screenRowCount:2,rows:[{date:'2026-09-27',sales:30,receipt:0,balance:130,memo:'must not persist'},{date:'2026-10-27',sales:0,receipt:20,balance:110}],totals:{sales:30,receipt:20,balance:110}});
test('source opening-only report preserves positive/negative balance without inventing vouchers',async()=>{
 const {parseLedgerReport}=await import('../scripts/ecount-scraper/customer-ledger.mjs');
 for(const value of ['12,345','-123']){
  const source={headers:['일자','적요','판매','수금','잔액'],identity:'fixture',periods:['2026/09/27 ~ 2026/10/27'],rows:[['이월잔액','','',value]]};
  const p=parseLedgerReport(source,{custKey:7,sourceCode:'fixture'},policy.recentMonth(now),now);
  const ledger=validateLedger(p,now);assert.equal(ledger.balanceOnly,true);assert.equal(ledger.rows.length,0);assert.equal(ledger.totals.balance,Number(value.replace(',','')));
  assert.throws(()=>parseLedgerReport({...source,rows:[...source.rows,['2026/10/27','private memo','10','0','12355']]},{custKey:7,sourceCode:'fixture'},policy.recentMonth(now),now));
  assert.throws(()=>parseLedgerReport({...source,identity:'different'},{custKey:7,sourceCode:'fixture'},policy.recentMonth(now),now));
 }
});
test('failure status accepts only known reasons and drops source detail',()=>{
 const input={custKey:7,periodFrom:'2026-09-27',periodTo:'2026-10-27',failure:'LINK_CHECK_REQUIRED',sourceName:'private'};
 assert.equal(validateFailure(input,now).sourceName,undefined);
 assert.throws(()=>validateFailure({...input,failure:'private source error'},now));
 assert.throws(()=>validateFailure({...input,periodFrom:'2025-09-27'},now));
 assert.throws(()=>validateLedger({...sample(),balanceOnly:true},now));
});
test('failed refresh retains last good cross-year snapshot and a changed identity exposes neither',async()=>{
 const crypto=require('crypto');
 const codeHash=crypto.createHash('sha256').update('E040723:fixture').digest('hex');
 const period={periodFrom:'2025-12-01',periodTo:'2026-01-01'};
 const good={SnapshotKey:4,VerifyStatus:'GREEN',VerifyDetail:JSON.stringify({...validateLedger({...sample(),...period,rows:[{date:'2025-12-01',sales:30,receipt:0,balance:130},{date:'2026-01-01',sales:0,receipt:20,balance:110}]},new Date('2026-01-01T02:00:00Z')),codeHash,collectedAt:'2026-01-01T02:00:00Z'})};
 let latest={SnapshotKey:5,VerifyStatus:'RED',VerifyDetail:JSON.stringify({custKey:7,...period,codeHash,collectedAt:'2026-01-01T03:00:00Z',failure:'LINK_CHECK_REQUIRED'})};
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {readLedger};';
 const store=new Function('crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(crypto,async q=>({recordset:[q.includes("VerifyStatus='GREEN'")?good:latest]}),{NVarChar:'str'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
 const result=await store.readLedger({custKey:7,ecountCode:'fixture'});assert.equal(result.ledger.totals.balance,110);assert.equal(result.failure.reason,'LINK_CHECK_REQUIRED');
 const changed=await store.readLedger({custKey:7,ecountCode:'changed'});assert.equal(changed.ledger,null);assert.equal(changed.failure,null);
 latest={...latest,SnapshotKey:3};assert.equal((await store.readLedger({custKey:7,ecountCode:'fixture'})).failure,null);
 latest=good;assert.equal((await store.readLedger({custKey:7,ecountCode:'fixture'})).failure,null);
});
test('failure writes recheck current source identity and retain only safe attempt metadata',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {saveLedgerFailure};';
 const writes=[];const query=async(q,p)=>{if(q.includes('INSERT INTO WebEcountSnapshot')){writes.push(JSON.parse(p.payload.value));return {recordset:[{SnapshotKey:9}]};}return {recordset:[{CustKey:7,CustName:'private name',code:'1234567890',managerUserId:'alice',codeMatchCount:1}]};};
 const store=new Function('crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(require('crypto'),query,{NVarChar:()=>'',MAX:'max'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
 const p=policy.recentMonth();const input={custKey:7,periodFrom:p.from,periodTo:p.to,collectedAt:new Date().toISOString(),requestedCode:'1234567890',failure:'LINK_CHECK_REQUIRED',rawError:'private detail'};
 await store.saveLedgerFailure(input);assert.equal(writes.length,1);assert.equal(writes[0].failure,'LINK_CHECK_REQUIRED');assert.ok(!JSON.stringify(writes).includes('private'));assert.ok(!JSON.stringify(writes).includes('1234567890'));
 await assert.rejects(store.saveLedgerFailure({...input,requestedCode:'different'}));await assert.rejects(store.saveLedgerFailure({...input,collectedAt:'2020-01-01'}));assert.equal(writes.length,1);
});
test('failed customer popup is discarded before the next customer, with safe diagnostics',async()=>{
 const {collectLedgerBatch}=await import('../scripts/ecount-scraper/customer-ledger.mjs');
 let reset=false;const uploaded=[],logs=[];
 const r=await collectLedgerBatch({page:{goto:async url=>{assert.equal(url,'about:blank');reset=true;}},getBase:()=>'',work:{customers:[{custKey:1},{custKey:2}],period:{}},
 collect:async(_p,_b,c)=>{if(c.custKey===1)throw new Error('sensitive source detail');assert.equal(reset,true);return c;},upload:async p=>uploaded.push(p.custKey),log:s=>logs.push(s)});
 assert.deepEqual(r,{ok:1,failed:1,total:2});assert.deepEqual(uploaded,[2]);assert.ok(logs.every(s=>!s.includes('sensitive source detail')));
});
test('a closed browser cannot carry a failed lookup forward',async()=>{
 const {collectLedgerBatch}=await import('../scripts/ecount-scraper/customer-ledger.mjs');let calls=0;
 const r=await collectLedgerBatch({page:{goto:async()=>{throw new Error('closed');}},getBase:()=>'',work:{customers:[{custKey:1},{custKey:2}],period:{}},collect:async()=>{calls++;throw new Error('closed');},upload:async()=>assert.fail(),log:()=>{}});
 assert.equal(calls,1);assert.deepEqual(r,{ok:0,failed:2,total:2});
});
test('voucher totals and rolling balance; no source personal fields retained',()=>{
 const p=validateLedger({...sample(),customerName:'must not persist',observedCode:'secret'},now);
 assert.equal(p.rows.length,2);assert.equal(p.rows[0].memo,undefined);assert.equal(p.customerName,undefined);assert.equal(p.observedCode,undefined);
});
test('partial report, arithmetic tampering, summary mode, wrong period rejected',()=>{
 for(const mutate of [p=>p.rows.pop(),p=>p.rows[0].balance+=5,p=>p.totals.sales+=10,p=>p.individual=false,p=>p.mode='monthly',p=>p.periodFrom='2025-09-27',p=>p.rows[0].date='2026-09-26',p=>p.rows[0].sales=NaN]){
   const p=sample();mutate(p);assert.throws(()=>validateLedger(p,now));
 }
});
test('general ECOUNT snapshot APIs cannot expose the customer-scoped dataset',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountIngest.js'),'utf8');
 const code=source.slice(source.indexOf('export async function listEcountSnapshots')).replaceAll('export async function','async function')+'\nreturn {listEcountSnapshots,getEcountSnapshot};';
 const queries=[];
 const api=new Function('query','sql','ensureEcountTables',code)(async q=>{queries.push(q);return {recordset:[]};},{Int:'int',NVarChar:'str'},async()=>{});
 assert.equal(await api.getEcountSnapshot(999),null);await api.listEcountSnapshots('ledger723');await api.listEcountSnapshots(null);
 for(const q of queries.filter(q=>q.includes('FROM WebEcountSnapshot')))assert.match(q,/Dataset<>'ledger723'/);
});
test('verified empty is distinct from missing source and from zero balance',()=>{
 const p={...sample(),rows:[],screenRowCount:0,empty:true,opening:null,totals:null};
 assert.equal(validateLedger(p,now).totals,null);assert.throws(()=>validateLedger({...p,empty:false},now));
 assert.throws(()=>validateLedger({...p,totals:{sales:0,receipt:0,balance:0}},now));
});
test('cross-year and leap-day voucher validation',()=>{
 const p={...sample(),periodFrom:'2026-12-01',periodTo:'2027-01-01',screenRowCount:1,rows:[{date:'2027-01-01',sales:30,receipt:20,balance:110}]};
 assert.equal(validateLedger(p,new Date('2027-01-01T00:00:00Z')).rows.length,1);
 assert.throws(()=>validateLedger({...p,rows:[{...p.rows[0],date:'2026-01-01'}]},new Date('2027-01-01T00:00:00Z')));
});
function loadHandler(deps){
 let code=fs.readFileSync(path.join(__dirname,'../pages/api/ecount/customer-ledger.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function handler','async function handler').replace('export default withAuth(handler);','return handler;');
 return new Function(...Object.keys(deps),code)(...Object.values(deps));
}
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(data){this.data=data;return this;}};}
test('API checks fresh owner scope before every ledger read, including forged admin query',async()=>{
 let owner='alice',reads=0;
 const deps={ledgerCustomers:async uid=>uid===owner?[{custKey:7,name:'fixture',active:true,managerUserId:owner,ecountCode:'fixture-code',codeMatchCount:1,linked:true}]:[],readLedger:async()=>{reads++;return {ledger:{rows:[]}};},readLedgerRefreshRequest:async()=>null,...policy,...schedule};
 const handler=loadHandler(deps);
 for(const [uid,key,status] of [['alice','7',200],['bob','7',403],['alice','8',403],['alice','7 OR 1=1',400]]){
   const res=response();await handler({method:'GET',user:{userId:uid,authority:1},query:{custKey:key,userId:'alice'}},res);assert.equal(res.statusCode,status);
 }
 owner='bob';const res=response();await handler({method:'GET',user:{userId:'alice'},query:{custKey:'7'}},res);assert.equal(res.statusCode,403);assert.equal(reads,1);
});
test('API list strips source identifiers and unavailable owner yields no customers',async()=>{
 const handler=loadHandler({ledgerCustomers:async uid=>uid==='alice'?[{custKey:7,name:'fixture',managerName:'담당자 A',linked:true,ecountCode:'private',managerUserId:'alice'}]:[],readLedger:()=>assert.fail(),readLedgerRefreshRequest:async()=>null,...policy,...schedule});
 const res=response();await handler({method:'GET',user:{userId:'alice'},query:{}},res);
 assert.deepEqual(res.data.customers,[{custKey:7,name:'fixture',managerName:'담당자 A',linked:true,refreshable:true}]);assert.equal(res.headers['Cache-Control'],'private, no-store');
 const inactive=response();await handler({method:'GET',user:{userId:'inactive'},query:{}},inactive);assert.deepEqual(inactive.data.customers,[]);
});
test('SS3 lists all active customers and reads other managers’ uniquely linked snapshots',async()=>{
 const customers=[
  {custKey:7,name:'fixture-a',active:true,managerUserId:'alice',managerMatchCount:1,codeMatchCount:1,ecountCode:'1234567890',linked:true},
  {custKey:8,name:'fixture-b',active:true,managerUserId:null,managerMatchCount:0,codeMatchCount:0,ecountCode:'',linked:false},
 ];
 const scopes=[];
 const handler=loadHandler({ledgerCustomers:async(uid,all)=>{scopes.push([uid,all]);return all?customers:[];},readLedger:async customer=>({ledger:{custKey:customer.custKey,rows:[]}}),readLedgerRefreshRequest:async()=>null,...policy,...schedule});
 const list=response();await handler({method:'GET',user:{userId:'nenovaSS3'},query:{}},list);
 assert.deepEqual(scopes[0],['nenovaSS3',true]);assert.equal(list.data.scope,'all');
 assert.deepEqual(list.data.customers,[{custKey:7,name:'fixture-a',managerName:'담당자 미확인',linked:true,refreshable:true},{custKey:8,name:'fixture-b',managerName:'담당자 미확인',linked:false,refreshable:false}]);
 const detail=response();await handler({method:'GET',user:{userId:'nenovaSS3'},query:{custKey:'7'}},detail);
 assert.equal(detail.statusCode,200);assert.equal(detail.data.ledger.custKey,7);
 const unlinked=response();await handler({method:'GET',user:{userId:'nenovaSS3'},query:{custKey:'8'}},unlinked);
 assert.equal(unlinked.statusCode,409);
 const other=response();await handler({method:'GET',user:{userId:'alice'},query:{custKey:'7'}},other);
 assert.equal(other.statusCode,403);
});
test('all-customer lookup requires a live admin UserInfo row and does not change owner-only callers',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8');
 const code=source.slice(source.indexOf('export async function ledgerCustomers'),source.indexOf('export async function readLedger')).replace('export async function','async function')+'\nreturn ledgerCustomers;';
 const queries=[];const lookup=new Function('query','sql',code)(async(text,params)=>{queries.push({text,params});return {recordset:[]};},{NVarChar:'nvarchar',Bit:'bit'});
 await lookup('nenovaSS3',true);await lookup('alice',false);
 assert.match(queries[0].text,/EXISTS \(SELECT 1 FROM UserInfo adminUser WHERE ISNULL\(adminUser\.isDeleted,0\)=0 AND adminUser\.UserID=@uid\)/);
 assert.equal(queries[0].params.uid.value,'nenovaSS3');assert.equal(queries[0].params.allActive.value,true);
 assert.match(queries[1].text,/owner\.matches=1 AND \(@uid IS NULL OR owner\.UserID=@uid\)/);
 assert.equal(queries[1].params.allActive.value,false);
});
test('manual refresh API rechecks the live owner, accepts only linked customers and returns no source identity',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../pages/api/ecount/customer-ledger-refresh.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default withAuth(handler);','return handler;');
 const calls=[];
 const handler=new Function('isLedgerAdmin','ledgerCustomers','readLedgerRefreshRequest','requestLedgerRefresh',source)(policy.isLedgerAdmin,
  async(uid,all)=>uid==='alice'||all?[{custKey:7,linked:true,managerMatchCount:1,ecountCode:'1234567890'},{custKey:8,linked:true,managerMatchCount:0}]:[],
  async key=>({status:'PENDING',requestedAt:'2026-10-27T00:00:00.000Z'}),
  async(uid,key)=>{calls.push([uid,key]);return {status:'PENDING',requestedAt:'2026-10-27T00:00:00.000Z'};});
 const ok=response();await handler({method:'POST',user:{userId:'alice'},body:{custKey:7}},ok);
 assert.equal(ok.statusCode,200);assert.deepEqual(calls,[['alice',7]]);assert.equal(JSON.stringify(ok.data).includes('1234567890'),false);
 const other=response();await handler({method:'POST',user:{userId:'bob'},body:{custKey:7}},other);assert.equal(other.statusCode,403);assert.equal(calls.length,1);
 const adminReadOnly=response();await handler({method:'POST',user:{userId:'nenovaSS3'},body:{custKey:7}},adminReadOnly);assert.equal(adminReadOnly.statusCode,200);assert.equal(calls.length,2);
 const unassigned=response();await handler({method:'POST',user:{userId:'nenovaSS3'},body:{custKey:8}},unassigned);assert.equal(unassigned.statusCode,403);assert.equal(calls.length,2);
 const invalid=response();await handler({method:'POST',user:{userId:'alice'},body:{custKey:'7 OR 1=1'}},invalid);assert.equal(invalid.statusCode,400);
 const status=response();await handler({method:'GET',user:{userId:'alice'},query:{custKey:'7'}},status);assert.equal(status.data.request.status,'PENDING');
 const anonymous=response();await handler({method:'POST',body:{custKey:7}},anonymous);assert.equal(anonymous.statusCode,401);
});
test('refresh queue writes append-only web events, deduplicates pending requests and enforces cooldown/window',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {requestLedgerRefresh};';
 let current=null,nextKey=100;const writes=[];
 const query=async(q,p)=>{
  if(q.includes('FROM Customer c'))return {recordset:p.uid.value==='alice'?[{CustKey:7,CustName:'private customer',code:'1234567890',managerUserId:'alice',codeMatchCount:1}]:[]};
  if(q.includes('SELECT TOP (1) SnapshotKey,VerifyStatus,VerifyDetail'))return {recordset:current?[current]:[]};
  if(q.includes('INSERT INTO WebEcountSnapshot')){
   const row={SnapshotKey:nextKey++,VerifyStatus:p.status.value,VerifyDetail:p.payload.value};current=row;writes.push({row,params:p});return {recordset:[{SnapshotKey:row.SnapshotKey}]};
  }
  assert.fail(`unexpected query ${q}`);
 };
 const sql={MAX:'max',Int:'int',NVarChar:()=> 'nvarchar'};
 const store=new Function('crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness','isRefreshRequestAllowed',source)(require('crypto'),query,sql,policy.recentMonth,validateLedger,validateFailure,schedule.freshness,schedule.isRefreshRequestAllowed);
 const now=Date.parse('2026-10-27T00:00:00Z');
 const first=await store.requestLedgerRefresh('alice',7,now);assert.equal(first.status,'PENDING');assert.equal(writes.length,1);
 assert.equal(writes[0].row.VerifyStatus,'AMBER');assert.equal(writes[0].params.note.value,'refresh-request:7');
 assert.equal(writes[0].row.VerifyDetail.includes('alice'),false);assert.equal(writes[0].row.VerifyDetail.includes('1234567890'),false);
 assert.equal((await store.requestLedgerRefresh('alice',7,now+1000)).status,'PENDING');assert.equal(writes.length,1);
 await assert.rejects(store.requestLedgerRefresh('bob',7,now+2000),{message:'CUSTOMER_FORBIDDEN'});
 await assert.rejects(store.requestLedgerRefresh('alice',7,Date.parse('2026-10-27T09:00:00Z')),{message:'REQUEST_WINDOW_CLOSED'});
 current={SnapshotKey:500,VerifyStatus:'GREEN',VerifyDetail:JSON.stringify({kind:'LEDGER_REFRESH_REQUEST',state:'COMPLETE',custKey:7,requestedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()})};
 await assert.rejects(store.requestLedgerRefresh('alice',7,now+30000),{message:'REQUEST_RATE_LIMIT'});
});
test('collector queue endpoint requires automation auth and exposes only the one claimed request to the worker',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../pages/api/ecount/customer-ledger-sync.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default async function handler','async function handler').replace(/export const config=.*;/,'')+'\nreturn handler;';
 let claims=0,finished=[];
 const handler=new Function('crypto','getAutomationToken','checkAutomationAuth','ledgerCustomers','saveLedger','saveLedgerFailure','claimNextLedgerRefresh','finishLedgerRefreshRequest','recentMonth','isRefreshRequestAllowed',source)(require('crypto'),()=>'',req=>({ok:req.authorized}),async()=>[],async()=>({snapshotKey:1}),async()=>({snapshotKey:2}),async()=>{claims++;return {requestId:55,custKey:7,sourceCode:'1234567890',period:{from:'2026-09-27',to:'2026-10-27'}};},async(id,success)=>{finished.push([id,success]);return {status:success?'COMPLETE':'FAILED'};},policy.recentMonth,()=>true);
 const denied=response();await handler({method:'GET',query:{queue:'refresh'}},denied);assert.equal(denied.statusCode,401);assert.equal(claims,0);
 const claimed=response();await handler({method:'GET',authorized:true,query:{queue:'refresh'}},claimed);assert.deepEqual(claimed.data.refreshRequest,{requestId:55,custKey:7,sourceCode:'1234567890',period:{from:'2026-09-27',to:'2026-10-27'}});assert.equal(claims,1);
 const complete=response();await handler({method:'POST',authorized:true,body:{refreshRequestId:55,refreshSuccess:true}},complete);assert.deepEqual(finished,[[55,true]]);assert.equal(complete.data.status,'COMPLETE');
});
