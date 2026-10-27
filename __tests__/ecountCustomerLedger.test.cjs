const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateLedger}=require('../lib/ecountLedgerValidation.cjs');
const policy=require('../lib/ecountCustomerLedgerPolicy.cjs');
const schedule=require('../lib/ecountLedgerSchedule.cjs');
const now=new Date('2026-10-27T02:00:00Z');
const sample=()=>({program:'E040723',mode:'voucher',individual:true,custKey:7,periodFrom:'2026-09-27',periodTo:'2026-10-27',opening:100,screenRowCount:2,rows:[{date:'2026-09-27',sales:30,receipt:0,balance:130,memo:'must not persist'},{date:'2026-10-27',sales:0,receipt:20,balance:110}],totals:{sales:30,receipt:20,balance:110}});
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
