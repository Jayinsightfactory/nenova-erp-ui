const assert=require('node:assert/strict'),fs=require('node:fs');
const {transformSync}=require(`@next/swc-${process.platform}-${process.arch}${process.platform==='win32'?'-msvc':'-gnu'}`);
const sql={Int:'Int',MAX:-1,NVarChar:n=>`nvarchar(${n})`};
function load(file,deps){const m={exports:{}};const {code}=transformSync(fs.readFileSync(file,'utf8'),false,Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}})));new Function('require','module','exports',code)(name=>deps[name]||require(name),m,m.exports);return m.exports;}
const history=load('lib/productInputHistory.js',{});
const uploadIssues=load('lib/invoiceUploadIssue.js',{});
function response(){return {statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){return this;}};}
(async()=>{
 let queries=[];let allow=true;
 const issues=load('pages/api/import/upload-issues.js',{'../../../lib/invoiceUploadIssue':uploadIssues,'../../../lib/auth':{withAuth:x=>x},'../../../lib/invoiceReceiptAccess':{canManageInvoiceReceipt:()=>allow},'../../../lib/db':{sql,query:async()=>({recordset:[]}),withTransaction:async fn=>fn(async(s,p)=>{queries.push({s,p});return {recordset:[]};})}}).default;
 const req={method:'POST',user:{userId:'fixture'},body:{eventId:'11111111-1111-4111-8111-111111111111',fileName:'fixture.pdf',code:'MATCH_REQUIRED',count:2}};
 let res=response();await issues(req,res);assert.equal(res.body.success,true);assert.equal(queries.filter(q=>q.s.includes('INSERT')).length,1);assert.ok(queries.every(q=>!/(Warehouse|Stock|Shipment|OrderDetail)/.test(q.s)));
 allow=false;queries=[];res=response();await issues(req,res);assert.equal(res.statusCode,403);assert.equal(queries.length,0);
 allow=true;res=response();await issues({...req,body:{...req.body,count:-1}},res);assert.equal(res.statusCode,400);
 queries=[];res=response();await issues({...req,body:{...req.body,code:'REVIEW_BLOCKED',detail:'인쇄 날짜 확인 사유를 입력하세요.',actor:'spoof'}},res);
 assert.equal(res.body.success,true);const inserted=queries.find(q=>q.s.includes('INSERT'));assert.equal(inserted.p.actor.value,'fixture');assert.match(JSON.parse(inserted.p.payload.value).detail,/날짜/);
 const handler=load('pages/api/master/product-history.js',{'../../../lib/auth':{withAuth:x=>x},'../../../lib/db':{sql,query:async(s,p)=>{queries.push({s,p});return {recordset:[{LogKey:12,Actor:'fixture',ActionType:'PRODUCT_BULK_EDIT',Payload:JSON.stringify({changes:[{prodKey:1,prodName:'a',before:{BoxWeight:null},after:{BoxWeight:0}},{prodKey:2,prodName:'b',before:{},after:{}}]})}]};}},'../../../lib/productInputHistory':history}).default;
 res=response();await handler({method:'GET',query:{prodKey:'1'}},res);assert.equal(res.body.rows[0].changes.length,1);assert.equal(res.body.rows[0].changes[0].fields[0].after,0);
 res=response();await handler({method:'GET',query:{before:'bad'}},res);assert.equal(res.statusCode,400);
 // UI remains plain React text; errors do not acquire an ERP write callback.
 for(const name of ['components/catalog/ProductInputHistory.js','components/import-tools/InvoiceUploadIssues.js']){
  const source=fs.readFileSync(name,'utf8');transformSync(source,false,Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}})));assert.doesNotMatch(source,/dangerouslySetInnerHTML|\/commit|\/link-existing/);
 }
 console.log('audit API: permissions, bounded input, exact product filter, read-only history and audit-only writes passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
