// Reuse only the live invocation-owned fixture for read-only shared cost QA.
const http=require('node:http'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const sql=require('mssql');
(async()=>{
 const status=await (await fetch('http://127.0.0.1:19422/__test/status')).json();
 assert.equal(status.testOnly,true);assert.match(status.database,/^NenovaInvoiceFixture_\d{8}_[a-f0-9]+$/);
 const inspected=spawnSync('docker',['inspect','nenova-estimate-sql-test-20260826'],{encoding:'utf8',windowsHide:true});
 assert.equal(inspected.status,0);const container=JSON.parse(inspected.stdout)[0];
 assert.equal(container.Mounts.length,0);
 const password=container.Config.Env.find(v=>v.startsWith('MSSQL_SA_PASSWORD=')).split('=').slice(1).join('=');
 const pool=await sql.connect({server:'127.0.0.1',port:14339,user:'sa',password,database:status.database,options:{encrypt:false,trustServerCertificate:true}});
 const queryFn=async(statement,params={})=>{
   assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|EXEC)\b/i.test(statement),'READ_ONLY_QUERY_REQUIRED');
   const request=pool.request();for(const [key,p] of Object.entries(params))request.input(key,p.type,p.value);return request.query(statement);
 };
 const {createSharedAwbHandler}=await import('../lib/invoiceSharedAwbApi.js');
 const handler=createSharedAwbHandler({queryFn,types:sql,authorize:()=>true});
 http.createServer(async(req,res)=>{
   if(req.url==='/api/import/receipts/shared-awb-cost'){
     try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
       const adapter={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(v){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));},send(v){res.end(v);}};
       await handler({method:req.method,body,user:{}},adapter);
     }catch{res.writeHead(500);res.end('Isolated read-only calculation failed');}return;
   }
   // No mutations are forwarded to the receipt fixture from this cost-only UI.
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(403);res.end('READ_ONLY_FIXTURE');return;}
   const upstream=http.request({hostname:'127.0.0.1',port:19422,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:19422'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   upstream.on('error',()=>{res.writeHead(503);res.end();});req.pipe(upstream);
 }).listen(19424,'127.0.0.1',()=>console.log('READ_ONLY_COST_UI_READY http://127.0.0.1:19424/import/tools?popup=1'));
})().catch(()=>{console.error('READ_ONLY_FIXTURE_START_FAILED');process.exitCode=1;});
