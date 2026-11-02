const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateLedger,validateFailure}=require('../lib/ecountLedgerValidation.cjs');
const policy=require('../lib/ecountCustomerLedgerPolicy.cjs');
const schedule=require('../lib/ecountLedgerSchedule.cjs');
const now=new Date('2026-10-27T02:00:00Z');
const sample=()=>({program:'E040723',mode:'voucher',basis:'relation-v1',individual:true,custKey:7,periodFrom:'2026-09-27',periodTo:'2026-10-27',opening:100,screenRowCount:2,rows:[{date:'2026-09-27',sales:30,receipt:0,balance:130,memo:'must not persist'},{date:'2026-10-27',sales:0,receipt:20,balance:110}],totals:{sales:30,receipt:20,balance:110}});
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
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(require('../lib/ecountVerifiedCustomerLinks.cjs'),crypto,async q=>({recordset:[q.includes("VerifyStatus='GREEN'")?good:latest]}),{NVarChar:'str'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
 const result=await store.readLedger({custKey:7,ecountCode:'fixture'});assert.equal(result.ledger.totals.balance,110);assert.equal(result.failure.reason,'LINK_CHECK_REQUIRED');
 const changed=await store.readLedger({custKey:7,ecountCode:'changed'});assert.equal(changed.ledger,null);assert.equal(changed.failure,null);
 latest={...latest,SnapshotKey:3};assert.equal((await store.readLedger({custKey:7,ecountCode:'fixture'})).failure,null);
 latest=good;assert.equal((await store.readLedger({custKey:7,ecountCode:'fixture'})).failure,null);
});
test('failure writes recheck current source identity and retain only safe attempt metadata',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {saveLedgerFailure};';
 const writes=[];const query=async(q,p)=>{if(q.includes('INSERT INTO WebEcountSnapshot')){writes.push(JSON.parse(p.payload.value));return {recordset:[{SnapshotKey:9}]};}return {recordset:[{CustKey:7,CustName:'private name',code:'1234567890',managerUserId:'alice',managerMatchCount:1,accountActive:1,codeMatchCount:1}]};};
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(require('../lib/ecountVerifiedCustomerLinks.cjs'),require('crypto'),query,{NVarChar:()=>'',MAX:'max'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
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
 deps={readLedgerWeekComparison:async()=>null,...deps};
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
test('all-customer collision detection precedes owner filtering and inactive accounts stay blocked',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8');
 const code=source.slice(source.indexOf('export async function ledgerCustomers'),source.indexOf('export async function readLedger')).replace('export async function','async function')+'\nreturn ledgerCustomers;';
 const lookup=new Function('links','query','sql',code)(require('../lib/ecountVerifiedCustomerLinks.cjs'),async(_q,p)=>({recordset:[
  {CustKey:7,CustName:'A',code:'1234567890',managerUserId:'alice',managerMatchCount:1,codeMatchCount:1,accountActive:p.uid.value==='inactive'?0:1},
  {CustKey:8,CustName:'B',code:'1234567890',managerUserId:'bob',managerMatchCount:1,codeMatchCount:1,accountActive:p.uid.value==='inactive'?0:1}
 ]}),{NVarChar:'nvarchar',Bit:'bit'});
 assert.equal((await lookup('nenovaSS3',true)).length,2);
 const own=await lookup('alice',false);assert.equal(own.length,1);assert.equal(own[0].linked,false);
 assert.deepEqual(await lookup('inactive',true),[]);assert.deepEqual(await lookup('unknown',false),[]);
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
  if(q.includes('FROM Customer c'))return {recordset:p.uid.value==='alice'?[{CustKey:7,CustName:'private customer',code:'1234567890',managerUserId:'alice',managerMatchCount:1,accountActive:1,codeMatchCount:1}]:[]};
  if(q.includes('SELECT TOP (1) SnapshotKey,VerifyStatus,VerifyDetail'))return {recordset:current?[current]:[]};
  if(q.includes('INSERT INTO WebEcountSnapshot')){
   const row={SnapshotKey:nextKey++,VerifyStatus:p.status.value,VerifyDetail:p.payload.value};current=row;writes.push({row,params:p});return {recordset:[{SnapshotKey:row.SnapshotKey}]};
  }
  assert.fail(`unexpected query ${q}`);
 };
 const sql={MAX:'max',Int:'int',NVarChar:()=> 'nvarchar'};
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness','isRefreshRequestAllowed',source)(require('../lib/ecountVerifiedCustomerLinks.cjs'),require('crypto'),query,sql,policy.recentMonth,validateLedger,validateFailure,schedule.freshness,schedule.isRefreshRequestAllowed);
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

const verifiedLinks=require('../lib/ecountVerifiedCustomerLinks.cjs');
const linkedRows=()=>[
 {CustKey:1,CustName:'Old',code:'local-shared',managerUserId:'alice',managerMatchCount:1,accountActive:1,codeMatchCount:2},
 {CustKey:2,CustName:'Current',code:'local-shared',managerUserId:'alice',managerMatchCount:1,accountActive:1,codeMatchCount:2},
];
const linkedEntries=()=>linkedRows().map(r=>({custKey:r.CustKey,name:r.CustName,canonicalKey:2,lookupName:'Current',lookupQuery:'Cur',sourceHash:verifiedLinks.fingerprint('verified-source'),localIdentityHash:verifiedLinks.localIdentityHash(r.code)}));
test('verified aliases use one canonical source; collisions and changed identities fail closed',()=>{
 const rows=linkedRows(),entries=linkedEntries();const linked=verifiedLinks.resolveLinks(rows,entries);
 assert.ok(linked.every(c=>c.linked&&c.canonicalKey===2&&c.sharedLedgerName==='Current'));
 assert.equal(linked.filter(c=>c.linked&&c.canonicalKey===c.custKey).length,1);
 const mutations=[r=>r.pop(),r=>r[1].code='changed',r=>r[1].CustName='changed',r=>r[0].managerUserId='bob',r=>r[1].managerMatchCount=2];
 for(const change of mutations){const altered=linkedRows();change(altered);assert.equal(verifiedLinks.resolveLinks(altered,entries)[0].linked,false);}
 const conflict={...entries[1],custKey:3,name:'Third',canonicalKey:3};
 assert.ok(verifiedLinks.resolveLinks([...rows,{...rows[1],CustKey:3,CustName:'Third'}],[...entries,conflict]).every(c=>!c.linked));
 assert.ok(verifiedLinks.resolveLinks(rows,[]).every(c=>!c.linked));
});
test('reviewed lookup selects exact hash, never first same-name row; wrong/duplicate results rejected',async()=>{
 const {selectVerifiedCode,parseLedgerReport}=await import('../scripts/ecount-scraper/customer-ledger.mjs');
 const customer={custKey:2,lookupName:'Same',sourceCode:'sha256:'+verifiedLinks.fingerprint('second')};
 const candidates=[{name:'Same',code:'first'},{name:'Same',code:'second'}];
 assert.equal(selectVerifiedCode(candidates,customer),'second');
 for(const invalid of [[candidates[0]],[candidates[1],candidates[1]],[{name:'Other',code:'second'}]])assert.throws(()=>selectVerifiedCode(invalid,customer));
 const source={headers:['일자','적요','판매','수금','잔액'],identity:'second',periods:['2025/12/01 ~ 2026/01/01'],rows:[['이월잔액','','','100']]};
 const report=parseLedgerReport(source,customer,{from:'2025-12-01',to:'2026-01-01'},new Date('2026-01-01T02:00:00Z'));
 assert.equal(report.totals.balance,100);assert.equal(report.observedCode,customer.sourceCode);
 assert.throws(()=>parseLedgerReport({...source,identity:'first'},customer,{from:'2025-12-01',to:'2026-01-01'}));
});
test('alias reads the canonical cross-year snapshot and both names deduplicate one refresh queue',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {readLedger,requestLedgerRefresh};';
 const links={...verifiedLinks,resolveLinks:rows=>verifiedLinks.resolveLinks(rows,linkedEntries())};
 let event=null;const notes=[],writes=[];
 const sql={NVarChar:()=>'',MAX:'max'};
 const query=async(q,p)=>{
  if(q.includes('FROM Customer c'))return {recordset:linkedRows()};
  if(q.includes('INSERT INTO WebEcountSnapshot')){writes.push(p.note.value);event={VerifyDetail:p.payload.value};return {recordset:[{SnapshotKey:1}]};}
  if(p.scope){notes.push(p.scope.value);return {recordset:[]};}
  return {recordset:event?[event]:[]};
 };
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness','isRefreshRequestAllowed',source)(links,require('crypto'),query,sql,policy.recentMonth,validateLedger,validateFailure,schedule.freshness,schedule.isRefreshRequestAllowed);
 const customers=links.resolveLinks(linkedRows());for(const c of customers)await store.readLedger(c);
 assert.ok(notes.every(n=>n==='customer:2'));
 const time=Date.parse('2026-10-29T02:00:00Z');await store.requestLedgerRefresh('alice',1,time);await store.requestLedgerRefresh('alice',2,time);
 assert.deepEqual(writes,['refresh-request:2']);
 await assert.rejects(store.requestLedgerRefresh('bob',1,time),{message:'CUSTOMER_FORBIDDEN'});
});

test('only canonical customer can ingest a verified source; alias cannot create a second balance',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {saveLedger};';
 const links={...verifiedLinks,resolveLinks:rows=>verifiedLinks.resolveLinks(rows,linkedEntries())};const writes=[];
 const query=async(q,p)=>{if(q.includes('FROM Customer c'))return {recordset:linkedRows()};assert.match(q,/INSERT INTO WebEcountSnapshot/);writes.push(JSON.parse(p.payload.value));return {recordset:[{SnapshotKey:9}]};};
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(links,require('crypto'),query,{NVarChar:()=>'',MAX:'max'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
 const period=policy.recentMonth();const input={...sample(),custKey:2,periodFrom:period.from,periodTo:period.to,rows:[],screenRowCount:0,opening:100,totals:{sales:0,receipt:0,balance:100},balanceOnly:true,collectedAt:new Date().toISOString(),observedCode:'sha256:'+links.fingerprint('verified-source'),observedBusinessIdentity:'verified-source'};
 await assert.rejects(store.saveLedger({...input,custKey:1}),{message:'SOURCE_IDENTITY_MISMATCH'});
 await assert.rejects(store.saveLedger({...input,observedBusinessIdentity:'wrong'}),{message:'SOURCE_IDENTITY_MISMATCH'});
 await store.saveLedger(input);assert.equal(writes.length,1);assert.equal(writes[0].custKey,2);assert.equal(writes[0].codeHash,links.fingerprint('verified-source'));assert.ok(!JSON.stringify(writes).includes('verified-source'));
});

test('Mikael relation basis preserves actual 4997800 without old individual opening carry',async()=>{
 const {parseLedgerReport}=await import('../scripts/ecount-scraper/customer-ledger.mjs');
 const values=[['2026/09/29',4574500,0],['2026/10/03',0,4574500],['2026/10/06',9373000,0],['2026/10/10',0,9373000],['2026/10/13',6764100,0],['2026/10/17',0,6714100],['2026/10/20',6339900,0],['2026/10/24',0,6339900],['2026/10/27',4947800,0]];
 let balance=0,sales=0,receipt=0;const rows=values.map(([date,s,r])=>{balance+=s-r;sales+=s;receipt+=r;return [date,'',String(s),String(r),String(balance)];});
 const source={headers:['일자','적요','판매','수금','잔액'],identity:'fixture',periods:['2026/09/29 ~ 2026/10/29'],rows:[['이월잔액','','','0'],...rows,['합계',String(sales),String(receipt),String(balance)]]};
 const result=parseLedgerReport(source,{custKey:13,sourceCode:'fixture'},{from:'2026-09-29',to:'2026-10-29'},new Date('2026-10-29T07:00:00Z'));
 assert.equal(result.basis,'relation-v1');assert.equal(result.opening,0);assert.equal(result.totals.balance,4997800);
});
test('old verified individual snapshot stays visible as labelled reference after basis correction',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {readLedger};';
 const {basis,...legacy}=sample();const row={SnapshotKey:4,VerifyDetail:JSON.stringify({...legacy,custKey:7,codeHash:verifiedLinks.fingerprint('fixture'),collectedAt:'2026-10-27T02:00:00Z'})};
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(verifiedLinks,require('crypto'),async()=>({recordset:[row]}),{NVarChar:'str'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
 const result=await store.readLedger({custKey:7,ecountCode:'fixture'});assert.equal(result.ledger.totals.balance,110);assert.equal(result.basisChanged,true);assert.equal(result.receipts,null);assert.equal(result.takenAt,'2026-10-27T02:00:00Z');
});

test('delayed refresh success/failure never replaces a different customer or manager selection',async()=>{
 const page=fs.readFileSync(path.join(__dirname,'../pages/ecount/customer-ledger.js'),'utf8');
 const selection=page.slice(page.indexOf('  function selectManager('),page.indexOf('  function navigateButtons('));
 const refresh=page.slice(page.indexOf('  async function requestRefresh('),page.indexOf('  useEffect('));
 for(const change of ['none','customer','manager','away-back','unmount','failed-other']){
  let finish;const gate=new Promise((resolve,reject)=>{finish=change==='failed-other'?()=>reject(new Error('old customer error')):()=>resolve({ok:true,json:async()=>({success:true,request:{status:'PENDING'}})});});
  const loads=[],data=[],errors=[],posted=[];const selectionId={current:0},requestId={current:0};
  const deps={selected:'13',manager:'',selectionId,requestId,fetch:async(_url,options)=>{posted.push(JSON.parse(options.body));return gate;},setRequesting:()=>{},setError:e=>errors.push(e),setData:d=>data.push(d),load:async key=>loads.push(key),setSelected:()=>{},setManager:()=>{},messages:{}};
  const actions=new Function(...Object.keys(deps),selection+refresh+'\nreturn {selectCustomer,selectManager,requestRefresh};')(...Object.values(deps));
  const pending=actions.requestRefresh();
  if(['customer','away-back','failed-other'].includes(change))actions.selectCustomer('446');
  if(change==='away-back')actions.selectCustomer('13');
  if(change==='manager')actions.selectManager('other');
  if(change==='unmount')selectionId.current++;
  finish();await pending;
  assert.deepEqual(posted,[{custKey:'13'}]);
  assert.deepEqual(loads,change==='none'?['13']:[]);
  assert.equal(data.filter(v=>typeof v==='function').length,change==='none'?1:0);
  assert.ok(errors.every(e=>e===''));
 }
});

test('completed requests do not claim fresh success for missing or retained legacy data',()=>{
 const {displayRefreshStatus}=policy;
 const completed={refreshRequest:{status:'COMPLETE'}};
 assert.equal(displayRefreshStatus(completed),null);
 assert.equal(displayRefreshStatus({...completed,ledger:{},basisChanged:true}),null);
 assert.equal(displayRefreshStatus({...completed,ledger:{},basisChanged:false}),'COMPLETE');
 for(const status of ['PENDING','RUNNING','FAILED'])assert.equal(displayRefreshStatus({refreshRequest:{status},ledger:{},basisChanged:true}),status);
});
test('business-hour restriction changes refresh availability but never data retention',()=>{
 for(const [time,allowed] of [['2026-10-29T08:59:59Z',true],['2026-10-29T09:00:00Z',false],['2026-10-30T23:00:00Z',false],['2026-11-01T23:00:00Z',true]]){
  assert.equal(schedule.freshness('2026-10-29T08:00:00Z',Date.parse(time)).requestAllowed,allowed);
 }
});

test('retained cross-year reference preserves its original period and amounts',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/ecountCustomerLedgerStore.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nreturn {readLedger};';
 const {basis,...legacy}=sample();const payload={...legacy,periodFrom:'2025-12-01',periodTo:'2026-01-01',rows:[{date:'2025-12-01',sales:30,receipt:0,balance:130},{date:'2026-01-01',sales:0,receipt:20,balance:110}],codeHash:verifiedLinks.fingerprint('fixture'),collectedAt:'2026-01-01T02:00:00Z'};
 const row={SnapshotKey:4,VerifyDetail:JSON.stringify(payload)};
 const store=new Function('links','crypto','query','sql','recentMonth','validateLedger','validateFailure','freshness',source)(verifiedLinks,require('crypto'),async()=>({recordset:[row]}),{NVarChar:'str'},policy.recentMonth,validateLedger,validateFailure,schedule.freshness);
 const result=await store.readLedger({custKey:7,ecountCode:'fixture'});
 assert.equal(result.basisChanged,true);assert.deepEqual(result.period,{from:'2025-12-01',to:'2026-01-01'});assert.equal(result.ledger.totals.balance,110);assert.equal(result.takenAt,payload.collectedAt);
});


test('source session recovery coalesces concurrent login and ignores late failures from the old session',async()=>{
 const {singleFlight,withSessionRecovery}=require('../lib/ecountCollectorRecovery.cjs');
 let calls=0,release;const recovery=singleFlight(async()=>{calls++;await new Promise(r=>release=r);});
 const a=recovery(),b=recovery();await Promise.resolve();assert.equal(calls,1);release();await Promise.all([a,b]);assert.equal(recovery.version(),1);
 let failOld,tries=0;const late=withSessionRecovery(async()=>{if(++tries===1)return new Promise((_r,reject)=>failOld=reject);return 'fresh';},recovery);
 const c=recovery();await Promise.resolve();release();await c;failOld(new Error('LOGIN_EXPIRED'));assert.equal(await late,'fresh');assert.equal(calls,2);
});
test('ledger retries current customer with renewed base and uploads exactly once; repeated auth failure is bounded',async()=>{
 const {collectLedgerBatch}=await import('../scripts/ecount-scraper/customer-ledger.mjs');
 let base='old',recoveries=0,attempts=0;const uploaded=[],failures=[];
 const result=await collectLedgerBatch({page:{goto:async()=>{}},getBase:()=>base,work:{customers:[{custKey:1},{custKey:2}],period:{}},recoverSession:async()=>{recoveries++;base='new';},collect:async(_p,b,c)=>{attempts++;if(b==='old')throw new Error('LOGIN_EXPIRED');return c;},upload:async p=>uploaded.push(p.custKey),recordFailure:async p=>failures.push(p),log:()=>{}});
 assert.deepEqual(result,{ok:2,failed:0,total:2});assert.deepEqual(uploaded,[1,2]);assert.equal(recoveries,1);assert.equal(attempts,3);assert.equal(failures.length,0);
 const {withSessionRecovery}=require('../lib/ecountCollectorRecovery.cjs');let retries=0,relogin=0;
 await assert.rejects(withSessionRecovery(async()=>{retries++;throw new Error('LOGIN_EXPIRED');},async()=>{relogin++;}),/LOGIN_EXPIRED/);assert.equal(retries,2);assert.equal(relogin,1);
 await assert.rejects(withSessionRecovery(async()=>{throw new Error('SOURCE_IDENTITY_MISMATCH');},async()=>assert.fail()),/SOURCE_IDENTITY_MISMATCH/);
});
test('explicit recovery marker is recent, business-hours only and never replayed across restart/year boundary',()=>{
 const {recoveryRequestId,isSourceLoginUrl}=require('../lib/ecountCollectorRecovery.cjs');
 const id='00000000-0000-0000-0000-000000000001';
 for(const date of ['2025-11-03T09:00:00+09:00','2026-11-02T09:00:00+09:00','2027-01-04T09:00:00+09:00']){
  const now=Date.parse(date),request={id,requestedAt:new Date(now-1000).toISOString()};
  assert.equal(recoveryRequestId(request,null,now),id);assert.equal(recoveryRequestId(request,id,now),null);
  assert.equal(recoveryRequestId({...request,requestedAt:new Date(now-600000).toISOString()},null,now),null);
  assert.equal(recoveryRequestId({...request,requestedAt:new Date(now+1).toISOString()},null,now),null);
 }
 for(const date of ['2026-11-01T09:00:00+09:00','2026-11-02T18:00:00+09:00']){const now=Date.parse(date);assert.equal(recoveryRequestId({id,requestedAt:new Date(now).toISOString()},null,now),null);}
 for(const requestedAt of [null,{},2])assert.equal(recoveryRequestId({id,requestedAt},null,Date.now()),null);
 assert.equal(isSourceLoginUrl('https://login.ecount.com/'),true);assert.equal(isSourceLoginUrl('https://logincc.ecount.com/ec56/view/erp'),false);assert.equal(isSourceLoginUrl('https://login.ecount.com.evil.invalid/'),false);
});
test('bank login expiry is propagated before or after ledger, never uploaded as a completed reconciliation',async()=>{
 const {collectLedgerWithBank}=await import('../scripts/ecount-scraper/pending-receipts.mjs');
 for(const failAt of [1,2]){let calls=0;await assert.rejects(collectLedgerWithBank({page:{},bankPage:{},base:'',customer:{},period:{},history:{},collectLedger:async()=>({}),collectBank:async()=>{if(++calls===failAt)throw new Error('LOGIN_EXPIRED');return {};} }),/LOGIN_EXPIRED/);assert.equal(calls,failAt);}
});

test('actual dispatcher consumes explicit recovery before collection and does not replay it on tick or restart',async()=>{
 const recovery=require('../lib/ecountCollectorRecovery.cjs'),fixed=Date.parse('2026-11-02T09:00:00+09:00');
 const marker={id:'00000000-0000-0000-0000-000000000002',requestedAt:new Date(fixed).toISOString()};
 let state={lastAttempt:fixed-3600000},temp,tick,batches=0;
 const disk={readFileSync:name=>JSON.stringify(name==='state'?state:marker),writeFileSync:(name,value)=>{assert.equal(name,'state.tmp');temp=JSON.parse(value);},renameSync:(a,b)=>{assert.equal(a,'state.tmp');assert.equal(b,'state');state=temp;}};
 const code=fs.readFileSync(path.join(__dirname,'../scripts/ecount-scraper/customer-ledger.mjs'),'utf8');
 const body=code.slice(code.indexOf('export function startCustomerLedgerSchedule')).replace('export function','return function');
 const start=new Function('fs','STATE','RECOVERY_REQUEST','schedule','recovery','api','collectBankSnapshot','collectLedgerBatch','collectLedgerWithBank','collectCustomerLedger','setInterval','clearInterval','console',body)(disk,'state','request',{dueSlot:()=>null,isRefreshRequestAllowed:()=>true},{...recovery,recoveryRequestId:(r,id)=>recovery.recoveryRequestId(r,id,fixed)},async(_base,_body,suffix)=>suffix?{refreshRequest:null}:{customers:[{custKey:1}],period:{}},async()=>({}),async()=>{assert.equal(state.lastRecoveryId,marker.id);batches++;return {ok:1,failed:0};},()=>{},()=>{},fn=>{tick=fn;return 1;},()=>{}, {log:()=>{}});
 const ctx={newPage:async()=>({close:async()=>{}})};const flush=()=>new Promise(setImmediate);
 start(ctx,()=>'', '');await flush();assert.equal(batches,1);tick();await flush();assert.equal(batches,1);
 start(ctx,()=>'', '');await flush();assert.equal(batches,1);assert.equal(state.lastAttempt,fixed-3600000);
});

test('45-minute budget defers only untouched customers without marking them failed or uploading twice',async()=>{
 const {collectLedgerBatch}=await import('../scripts/ecount-scraper/customer-ledger.mjs');let clock=0;const uploads=[],deferred=[];
 const r=await collectLedgerBatch({page:{},getBase:()=>'',work:{customers:[{custKey:1},{custKey:2},{custKey:3}],period:{}},now:()=>clock,collect:async(_p,_b,c)=>{clock=45*60000+1;return c;},upload:async p=>uploads.push(p.custKey),recordFailure:()=>assert.fail(),onDeferred:async keys=>deferred.push(keys),log:()=>{}});
 assert.deepEqual(r,{ok:1,failed:0,total:3,deferred:2});assert.deepEqual(uploads,[1]);assert.deepEqual(deferred,[[2,3]]);
});
test('continuation excludes malformed keys, stale days and cross-year periods',()=>{
 const {makeContinuation,continuationEligible}=require('../lib/ecountCollectorRecovery.cjs');const now=Date.parse('2026-12-31T17:30:00+09:00'),work={period:{from:'2026-11-30',to:'2026-12-31'}};
 const c=makeContinuation(work,[2,3],now);assert.equal(continuationEligible(c,now),true);assert.equal(continuationEligible(c,Date.parse('2027-01-01T09:00:00+09:00')),false);assert.equal(continuationEligible(c,Date.parse('2025-12-31T09:00:00+09:00')),false);assert.equal(continuationEligible(c,Date.parse('2026-12-31T18:00:00+09:00')),false);
 for(const keys of [[2,2],[-1],['2'],[]])assert.equal(makeContinuation(work,keys,now),null);
});
test('actual dispatcher prioritizes manual refresh then resumes only deferred canonical keys across restart',async()=>{
 const real=require('../lib/ecountCollectorRecovery.cjs'),fixed=Date.parse('2026-11-02T09:00:00+09:00'),work={customers:[{custKey:1},{custKey:2},{custKey:3}],period:{from:'2026-10-02',to:'2026-11-02'}};
 const marker={id:'00000000-0000-0000-0000-000000000003',requestedAt:new Date(fixed).toISOString()};
 let state={lastAttempt:fixed,lastRecoveryId:marker.id,continuation:real.makeContinuation(work,[2,3],fixed)},temp,tick,queued={requestId:9,custKey:9,period:work.period};const batches=[],uploads=[];
 const disk={readFileSync:name=>JSON.stringify(name==='state'?state:marker),writeFileSync:(_name,value)=>temp=JSON.parse(value),renameSync:()=>state=temp};
 const api=async(_url,body,suffix)=>{if(suffix){const r=queued;queued=null;return {refreshRequest:r};}if(body){if(body.custKey)uploads.push(body.custKey);return {};}return {...work,customers:[...work.customers]};};
 const batch=async args=>{batches.push(args.work.customers.map(c=>c.custKey));if(batches.length===1){await args.onDeferred([3]);return {ok:1,failed:0,deferred:1};}return {ok:1,failed:0};};
 const code=fs.readFileSync(path.join(__dirname,'../scripts/ecount-scraper/customer-ledger.mjs'),'utf8'),body=code.slice(code.indexOf('export function startCustomerLedgerSchedule')).replace('export function','return function');
 const recovery={...real,recoveryRequestId:(r,id)=>real.recoveryRequestId(r,id,fixed),continuationEligible:c=>real.continuationEligible(c,fixed),makeContinuation:(w,k)=>real.makeContinuation(w,k,fixed)};
 const start=new Function('fs','STATE','RECOVERY_REQUEST','schedule','recovery','api','collectBankSnapshot','collectLedgerBatch','collectLedgerWithBank','collectCustomerLedger','setInterval','clearInterval','console',body)(disk,'state','request',{dueSlot:()=>null,isRefreshRequestAllowed:()=>true},recovery,api,async()=>({}),batch,async({customer})=>({custKey:customer.custKey}),()=>{},fn=>{tick=fn;return 1;},()=>{}, {log:()=>{}});
 const ctx={newPage:async()=>({close:async()=>{}})},flush=()=>new Promise(setImmediate);
 start(ctx,()=>'', '');await flush();assert.deepEqual(uploads,[9]);assert.equal(batches.length,0);assert.deepEqual(state.continuation.keys,[2,3]);
 tick();await flush();assert.deepEqual(batches,[[2,3]]);assert.deepEqual(state.continuation.keys,[3]);
 start(ctx,()=>'', '');await flush();assert.deepEqual(batches,[[2,3],[3]]);assert.equal(state.continuation,null);tick();await flush();assert.equal(batches.length,2);
});
