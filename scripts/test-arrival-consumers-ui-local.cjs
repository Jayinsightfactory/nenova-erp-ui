// Real Next pages with read-only isolated SQL cost readers. Non-cost hotel headers are fixtures.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
module.exports=async function({all,products,saved,readAll}){
 const {pool,ctx,sql}=all;assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);assert.match(pool.config.database,/^NenovaInvoiceFixture_/);
 const root=path.resolve(__dirname,'..'),secret=randomUUID(),env={...process.env,JWT_SECRET:secret};
 for(const k of Object.keys(env))if(/^(DB_|MSSQL|SQL_|NENOVAWEB_SERVICE)/.test(k))delete env[k];
 assert(!fs.existsSync(path.join(root,'.env.local'))&&!fs.existsSync(path.join(root,'.env')));
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','-p','19441'],{cwd:root,env,stdio:'ignore',windowsHide:true});
 const token=require('jsonwebtoken').sign({userId:'invoice-fixture',authority:1,accountActive:true},secret,{expiresIn:'2h'});
 const {PNL_PARTNERS}=await import('../lib/raumPnlPartner.js');
 const {loadLatestArrivalReferences}=await import('../lib/latestArrivalReference.js');
 const {exportCurrentInvoiceCost}=await import('../lib/invoiceReceiptCostExport.js');
 let stop;const done=new Promise(r=>stop=r);const events=[];
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:19442'),route=u.pathname;
  const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
  if(route==='/__test/stop'&&req.method==='POST'){send({ok:true});return stop();}
  if(req.method!=='GET')return send({error:'READ_ONLY_TEST'},405);
  if(route==='/__test/status')return send({isolated:true,events});
  if(!route.startsWith('/api/')){
   if(!['/incoming','/raum/pnl','/catalog','/stats/pivot'].includes(route)&&!route.startsWith('/_next/')&&!/\.(ico|svg|png|woff2?)$/.test(route))return send({error:'NOT_ALLOWED'},403);
   const upstream=http.request({hostname:'127.0.0.1',port:19441,path:req.url,headers:{...req.headers,host:'127.0.0.1:19441',cookie:'nenovaToken='+token}},r=>{res.writeHead(r.statusCode,{...r.headers,'set-cookie':'nenovaToken='+token+'; Path=/; HttpOnly; SameSite=Strict','content-security-policy':"connect-src 'self' blob: data:; form-action 'self';"});r.pipe(res);});upstream.on('error',()=>send({error:'FRONTEND_NOT_READY'},503));return upstream.end();
  }
  try{
   let data={success:true,rows:[],items:[]};
   if(route==='/api/auth/me')data={success:true,user:{userId:'invoice-fixture',authority:1,accountActive:true}};
   else if(route==='/api/arrival-cost/latest')data={success:true,references:await loadLatestArrivalReferences({orderYear:u.searchParams.get('orderYear'),items:JSON.parse(u.searchParams.get('items'))},ctx.queryFn)};
   else if(route==='/api/warehouse')data={success:true,masters:(await ctx.queryFn(`SELECT * FROM WarehouseMaster WHERE WarehouseKey=${saved.warehouseKey}`)).recordset.map(r=>({...r,totalBox:48,totalBunch:1440,totalSteam:1440}))};
   else if(route===`/api/warehouse/${saved.warehouseKey}`)data={success:true,items:(await ctx.queryFn(`SELECT d.*,p.ProdName,p.OutUnit FROM WarehouseDetail d JOIN Product p ON p.ProdKey=d.ProdKey WHERE WarehouseKey=${saved.warehouseKey}`)).recordset};
   else if(route==='/api/warehouse/invoice-costs')data={success:true,costs:await all.costs.readInvoiceCosts({queryFn:ctx.queryFn,types:sql,warehouseKey:saved.warehouseKey})};
   else if(route==='/api/raum/pnl-hotels')data={success:true,partners:Object.values(PNL_PARTNERS)};
   else if(route==='/api/raum/pnl'){
    const partner=u.searchParams.get('partner')||'raum',master={PnlKey:1,PartnerCode:partner,OrderYear:'2026',MajorWeek:43,Title:'TEST_ONLY 원가 연동 검증',QuoteDate:'2026-10-20',NenovaPct:50,ItemCount:6,CostTotal:600,SaleTotal:1200};
    if(u.searchParams.get('view')==='list')data={success:true,list:[master]};
    else{const rows=await readAll();data={success:true,master,items:products.map((p,i)=>({itemKey:i+1,major:43,prodKey:p.ProdKey,prodName:p.ProdName,name:p.ProdName,unit:'송이',qty:1,byBranch:{},costPrice:100,salePrice:200,arrivalHistory:rows.find(r=>r.prodKey===p.ProdKey).hotel})),images:[]};}
   }
   else if(route==='/api/catalog/bootstrap'){
    const rows=await readAll();data={success:true,products:products.map(p=>({...p,...rows.find(r=>r.prodKey===p.ProdKey).catalog,saleUnit:'송이',arrivalUnit:'송이'})),customers:[],flowers:[],arrivalStats:{total:6,withArrival:6,latestWeek:'43-2',fromUpload:0,skipped:false},costMeta:{latestWeek:'43-2'},uploadMeta:{count:0}};
   }
   else if(route==='/api/catalog/images')data={success:true,images:[]};
   else if(route==='/api/catalog/drafts')data={success:true,drafts:[]};
   else if(route==='/api/stats/pivot-weeks')data={success:true,weeks:['43-02']};
   else if(route==='/api/stats/pivot-data'){
    const rows=await readAll();data={success:true,orderYear:'2026',weekStart:'43-02',weekEnd:'43-02',weeks:['43-02'],customers:[],farms:['Florentina Export S.A.S'],rows:products.map(p=>{const r=rows.find(r=>r.prodKey===p.ProdKey);return{prodKey:p.ProdKey,prodName:p.ProdName,country:'콜롬비아',flower:'수국',unit:p.OutUnit,prevStock:0,orders:{},outOrders:{},costOrders:{},distCostOrders:{},totalOrder:0,incoming:{'Florentina Export S.A.S':1},totalIncoming:1,stockAdjust:0,confirmedOut:0,noneOut:0,curStock:1,cost:0,inPrice:0,inTotal:0,arrivalCost:r.pivot.arrivalCost,arrivalMeta:{displayUnit:r.pivot.unit,source:'승인 인보이스',arrivalWeek:r.pivot.sourceWeek}};})};
   }
   else if(route==='/api/test-cost-download'){
    const out=await exportCurrentInvoiceCost({queryFn:ctx.queryFn,types:sql,documentId:saved.documentId,warehouseKey:String(saved.warehouseKey),costRevisionId:saved.currentActual.costRevisionId});res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="TEST_ONLY-cost.xlsx"'});res.end(out.buffer);return;
   }
   events.push({route,status:200});send(data);
  }catch(e){events.push({route,status:400,error:e.message});send({success:false,error:e.message},400);}
 });
 try{for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:19441');break;}catch{}await new Promise(r=>setTimeout(r,300));}
 await new Promise((r,j)=>server.once('error',j).listen(19442,'127.0.0.1',r));console.log('ARRIVAL_NATIVE_PAGES_READY http://127.0.0.1:19442/incoming?week=43-02');await done;
 fs.writeFileSync(path.join(root,'.local-arrival-e2e/native-events.json'),JSON.stringify(events,null,2));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));child.kill();}
};
