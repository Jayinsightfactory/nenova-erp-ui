const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../lib/shipmentStatement.cjs');
function handler(deps){const src=fs.readFileSync('pages/api/shipment/statement.js','utf8').replace(/^import .*;\r?\n/gm,'').split('export default')[0].replace('export function','function')+'\nmodule.exports=statementHandler;';const box={module:{exports:{}},core,console};vm.runInNewContext(src,box);return box.module.exports(deps);}
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(d){this.body=d;return this;},send(d){this.body=d;return this;},end(){return this;}});
test('API rejects anonymous, missing year/customer/version, unsupported method before storage',async()=>{
 let calls=0;const h=handler({save:async()=>{calls++;}});
 for(const [req,status] of [[{method:'GET',query:{}},401],[{method:'GET',query:{week:45},user:{userId:'u'}},400],[{method:'DELETE',query:{},user:{userId:'u'}},405],[{method:'POST',query:{year:'2026',week:45},user:{userId:'u'}},400],[{method:'GET',query:{year:'2026',week:45,custKey:7,action:'download'},user:{userId:'u'}},400]]){const r=res();await h(req,r);assert.equal(r.code,status);}assert.equal(calls,0);
});
test('API uses selected year/customer and authenticated actor; exact saved export version',async()=>{
 let seen;const h=handler({save:async(s,b,u)=>{seen={s,b,u};return {version:2};},read:async(s,o)=>{assert.equal(s.year,'2025');assert.equal(o.revision,1);return {source:{customer:{name:'연습업체'}}};},export:()=>Buffer.from('xlsx')});
 const r=res();await h({method:'POST',query:{year:'2026',week:45,custKey:7},body:{draft:{}},user:{userId:'staff'}},r);assert.equal(r.code,200);assert.equal(seen.s.custKey,7);assert.equal(seen.u.userId,'staff');const x=res();await h({method:'GET',query:{year:'2025',week:45,custKey:7,action:'download',version:'1'},user:{userId:'staff'}},x);assert.equal(x.code,200);assert.match(x.headers['Content-Disposition'],/2025/);
});
test('source fencing rejects changed ERP before web save; core SQL preserves native NULL and year',()=>{
 const src=fs.readFileSync('lib/shipmentStatementService.js','utf8');assert.match(src,/sm.OrderYear=@year AND sm.OrderWeek LIKE @prefix/);assert.doesNotMatch(src,/sd\.CustKey\s*=/);assert.ok(src.indexOf('hash!==body.sourceHash')<src.indexOf('return store.save'));
});
test('production service revalidates source hash, version and shared allocations before publishing',async()=>{
 const src=fs.readFileSync('lib/shipmentStatementService.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export (const|async function)/g,'$1')+'\nmodule.exports={loadStatementSource,saveStatement,sourceHash};';
 let published=0;const row={OrderYear:'2026',OrderWeek:'45-03',CustKey:7,ProdKey:1,SdetailKey:11,OutQuantity:3,Cost:0,OutUnit:'단',CounName:'콜롬비아',FlowerName:'장미',ProdName:'문라이트'};
 const dates=Array.from({length:7},(_,i)=>({WeekDay:new Date(Date.UTC(2026,10,4+i)).getUTCDay()+1,Date:new Date(Date.UTC(2026,10,4+i)).toISOString().slice(0,10)}));
 const q=async(sql)=>({recordset:sql.includes('SELECT CustKey')?[{CustKey:7,CustName:'연습',Manager:'지원',BaseOutDay:0}]:sql.includes('FROM PeriodDay')?dates:[row]});
 const types={NVarChar:()=>0,Int:0,ISOLATION_LEVEL:{SERIALIZABLE:4}};
 const box={module:{exports:{}},createHash:require('crypto').createHash,core,sql:types,query:q,withTransaction:fn=>fn(q),store:{save:async()=>{published++;return {version:1};}}};vm.runInNewContext(src,box);const service=box.module.exports,input={year:'2026',week:45,custKey:7};
 const source=await service.loadStatementSource(input);assert.equal(source.customer.baseDay,'수');
 const payload={expectedVersion:0,sourceHash:service.sourceHash(source),draft:{defaultDay:'일',groups:[],entries:{}}};await service.saveStatement(input,payload,{userId:'staff'});assert.equal(published,1);
 row.OutQuantity=4;await assert.rejects(()=>service.saveStatement(input,payload,{userId:'staff'}),{statusCode:409});assert.equal(published,1);
 row.OutQuantity=3;const id=source.rows[0].id;await assert.rejects(()=>service.saveStatement(input,{...payload,draft:{...payload.draft,entries:{[id]:{수:4}}}},{userId:'staff'}),{statusCode:400});assert.equal(published,1);
});
