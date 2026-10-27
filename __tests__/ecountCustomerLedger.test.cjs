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
 const deps={ledgerCustomers:async uid=>uid===owner?[{custKey:7,name:'fixture',active:true,managerUserId:owner,ecountCode:'fixture-code',codeMatchCount:1,linked:true}]:[],readLedger:async()=>{reads++;return {ledger:{rows:[]}};},...policy,...schedule};
 const handler=loadHandler(deps);
 for(const [uid,key,status] of [['alice','7',200],['bob','7',403],['alice','8',403],['alice','7 OR 1=1',400]]){
   const res=response();await handler({method:'GET',user:{userId:uid,authority:1},query:{custKey:key,userId:'alice'}},res);assert.equal(res.statusCode,status);
 }
 owner='bob';const res=response();await handler({method:'GET',user:{userId:'alice'},query:{custKey:'7'}},res);assert.equal(res.statusCode,403);assert.equal(reads,1);
});
test('API list strips source identifiers and unavailable owner yields no customers',async()=>{
 const handler=loadHandler({ledgerCustomers:async uid=>uid==='alice'?[{custKey:7,name:'fixture',linked:true,ecountCode:'private',managerUserId:'alice'}]:[],readLedger:()=>assert.fail(),...policy,...schedule});
 const res=response();await handler({method:'GET',user:{userId:'alice'},query:{}},res);
 assert.deepEqual(res.data.customers,[{custKey:7,name:'fixture',linked:true}]);assert.equal(res.headers['Cache-Control'],'private, no-store');
 const inactive=response();await handler({method:'GET',user:{userId:'inactive'},query:{}},inactive);assert.deepEqual(inactive.data.customers,[]);
});
