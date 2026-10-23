// Local-only interactive Computer Use fixture. No production configuration or API forwarding.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
module.exports=async function({pool,sql,query,writer,documents,ctx,protectedSnapshot,protectedBefore,catalog,upsertPackingErpMatch,farms=[{FarmKey:7102,FarmName:'HUBFRESH'}],cachedAnalysis=null}){
 assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const root=path.resolve(__dirname,'..'),secret=randomUUID(),env={...process.env,JWT_SECRET:secret};
 for(const k of Object.keys(env))if(/^(DB_|MSSQL|SQL_|NENOVAWEB_SERVICE)/.test(k))delete env[k];
 assert.ok(!fs.existsSync(path.join(root,'.env.local'))&&!fs.existsSync(path.join(root,'.env')));
 const internalPort=19421,publicPort=19422;
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','-p',String(internalPort)],{cwd:root,env,stdio:'ignore',windowsHide:true});
 const token=require('jsonwebtoken').sign({userId:'invoice-fixture',authority:1,accountActive:true},secret,{expiresIn:'4h'});
 const {appendUploadIssue}=await import('../lib/invoiceUploadIssue.js');
 const costs=await import('../lib/invoiceReceiptCost.js');
 const {exportCurrentInvoiceCost}=await import('../lib/invoiceReceiptCostExport.js');
 const {appendInvoiceReceiptStageEvent}=await import('../lib/invoiceReceiptStageLog.js');
 const {readInvoiceReceiptEligibility}=await import('../lib/invoiceReceiptEligibility.js');
 const {WAREHOUSE_BOX_SQL,boxSummaryYear}=await import('../lib/warehouseBoxSummary.js');
 let stop;const done=new Promise(r=>stop=r);const events=[];const shared=new Map();
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:'+publicPort),route=u.pathname,method=req.method;
  const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
  if(route==='/__test/status')return send({testOnly:true,database:pool.config.database,events});
  if(route==='/__test/stop'&&method==='POST'){send({success:true});return stop();}
  if(!route.startsWith('/api/')){
   if(!(route==='/import/tools'||route==='/incoming/boxes'||route.startsWith('/_next/')||route.startsWith('/fonts/')||route.startsWith('/images/')||route.endsWith('.ico')||route.endsWith('.svg')||route.endsWith('.js')||route.endsWith('.wasm')))return send({error:'TEST_ROUTE_NOT_ALLOWED'},403);
   const h={...req.headers,host:'127.0.0.1:'+internalPort,cookie:'nenovaToken='+token};
   const upstream=http.request({hostname:'127.0.0.1',port:internalPort,path:req.url,method,headers:h},r=>{res.writeHead(r.statusCode,{...r.headers,'set-cookie':'nenovaToken='+token+'; Path=/; HttpOnly; SameSite=Strict','content-security-policy':"connect-src 'self' blob: data:; form-action 'self';"});r.pipe(res);});upstream.on('error',()=>send({error:'LOCAL_FRONTEND_UNAVAILABLE'},503));req.pipe(upstream);return;
  }
  try{
   const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();const body=raw?JSON.parse(raw):{};const id=route.split('/')[4];let d;
   if(route==='/api/auth/me')d={success:true,user:{userId:'invoice-fixture',authority:1,accountActive:true}};
   else if(route==='/api/warehouse/boxes')d={success:true,rows:(await query(pool,WAREHOUSE_BOX_SQL,{year:{type:sql.NVarChar,value:boxSummaryYear(u.searchParams.get('year'))}})).recordset};
   else if(route==='/api/import/tools/product-matches'){if(method==='POST')catalog.value=upsertPackingErpMatch(catalog.value,body,catalog.products);d={...catalog,success:true,scope:'team',revision:1};}
   else if(route==='/api/import/upload-issues'){if(method==='POST')await appendUploadIssue({withTransaction:ctx.withTransactionFn,sql,actor:'invoice-fixture',input:body});d={success:true,rows:(await query(pool,"SELECT LogKey,Actor,Payload FROM SystemActionLog")).recordset.map(x=>({id:x.LogKey,actor:x.Actor,...JSON.parse(x.Payload)}))};}
   else if(route==='/api/import/tools/parse-pdf'&&method==='POST'){
    assert.ok(cachedAnalysis,'NO_APPROVED_CACHED_ANALYSIS');assert.equal(body.country,cachedAnalysis.country);
    const hash=createHash('sha256').update(Buffer.from(body.pdfBase64,'base64')).digest('hex');assert.equal(hash,cachedAnalysis.sourceHash,'SOURCE_HASH_MISMATCH');
    d={...cachedAnalysis.ai,source:'cache',cacheSaved:true};
   }
   else if(route==='/api/arrival-cost')d={success:true,farms};
   else if(route==='/api/import/tools/state'){const key=u.searchParams.get('key')||body.key||'';if(method==='POST')shared.set(key,body.value);d={success:true,value:shared.get(key)||null,revision:0,history:[]};}
   else if(route==='/api/import/tools/upload-history')d={success:true,record:{id:'isolated-only'},rows:[]};
   else if(route==='/api/import/receipts/drafts'&&method==='POST')d={success:true,document:await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,input:body,actor:'invoice-fixture'})};
   else if(route==='/api/import/receipts/eligibility')d={success:true,eligibility:await readInvoiceReceiptEligibility({queryFn:ctx.queryFn,types:sql,...body})};
   else if(route.startsWith('/api/import/receipts/')&&route.endsWith('/preview'))d={success:true,preview:await writer.previewInvoiceReceipt({queryFn:ctx.queryFn,types:sql,documentId:id,revision:body.revision})};
   else if(route.startsWith('/api/import/receipts/')&&route.endsWith('/commit'))d={success:true,result:await ctx.create({...body,documentId:id,actor:'invoice-fixture'})};
   else if(route.startsWith('/api/import/receipts/')&&route.endsWith('/cost-revisions'))d={success:true,cost:await costs.saveInvoiceCostRevision({withTransactionFn:ctx.withTransactionFn,types:sql,documentId:id,revision:body.revision,actor:'invoice-fixture',input:body.input,reason:body.reason})};
   else if(route==='/api/warehouse/invoice-costs')d={success:true,costs:await costs.readInvoiceCosts({queryFn:ctx.queryFn,types:sql,warehouseKey:u.searchParams.get('warehouseKey')})};
   else if(route.startsWith('/api/import/receipts/')&&route.endsWith('/stage-events'))d={success:true,...await appendInvoiceReceiptStageEvent({withTransactionFn:ctx.withTransactionFn,types:sql,documentId:id,actor:'invoice-fixture',input:body})};
   else if(route.startsWith('/api/import/receipts/')&&route.endsWith('/cost-export')){const out=await exportCurrentInvoiceCost({queryFn:ctx.queryFn,types:sql,documentId:id,warehouseKey:u.searchParams.get('warehouseKey'),costRevisionId:u.searchParams.get('costRevisionId')});events.push({route,method,status:200,bytes:out.buffer.length});res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${out.filename}"`});res.end(out.buffer);return;}
   else if(route.startsWith('/api/import/receipts/')&&route.split('/').length===5&&id!=='drafts'){if(method==='PATCH')await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,input:body,actor:'invoice-fixture',documentId:id});d={success:true,document:await documents.getInvoiceDocument({queryFn:ctx.queryFn,types:sql,documentId:id})};}
   else if(method==='GET')d={success:true,rows:[],items:[],documents:[],value:null,revision:0};
   else return send({success:false,error:'LOCAL_FIXTURE_ENDPOINT_NOT_IMPLEMENTED',route},501);
   events.push({route,method,status:200});send(d);
  }catch(e){events.push({route,method,status:400,code:e.code,message:e.message});console.log('TEST_API_ERROR',route,e.code,e.message);send({success:false,code:e.code,error:e.message,issues:e.issues},400);}
 });
 try{for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:'+internalPort);break;}catch{}await new Promise(r=>setTimeout(r,300));}
  await new Promise((r,j)=>server.once('error',j).listen(publicPort,'127.0.0.1',r));console.log('NATIVE_UI_READY http://127.0.0.1:19422/import/tools?popup=1');await done;
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore);console.log('PROTECTED_ORDER_SHIPMENT_UNCHANGED');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));child.kill();}
};
