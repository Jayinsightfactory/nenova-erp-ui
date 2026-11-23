// Loopback-only fixture: all API requests terminate here, no DB connection.
const http = require('node:http'), crypto = require('node:crypto'), { spawn } = require('node:child_process'), jwt = require('jsonwebtoken');
(async () => {
  const {createArrivalWeekCostHandler}=await import('../lib/arrivalWeekCostHttp.js');
  const { createNativeCostWorkbook } = await import('../lib/invoiceReceiptCostExport.js');
  const { createNativeCostHandler } = await import('../lib/nativeCostHttp.js');
  const { fetchLiveInvoiceRate } = await import('../lib/invoiceLiveExchangeRate.js');
  const appPort=Number(process.env.NATIVE_APP_PORT||19430),uiPort=Number(process.env.NATIVE_UI_PORT||19431);
  const secret = crypto.randomBytes(32).toString('hex'), user = { userId:'fixture-user', userName:'테스트 담당자', authority:1, deptName:'테스트' };
  const token = jwt.sign(user, secret, { expiresIn:'2h' });
  const counts = { read:0, preview:0, download:0, blockedWrites:0 };
  let raw=[1,2,3,4,5].map(i=>({WarehouseKey:99000+i,OrderYear:'2026',OrderWeek:'46-01',OrderNo:i<3?'7846951926'+i:'01441369974',FarmName:i<3?'Cloudland':'연습 농장 '+i,InvoiceNo:'TEST_ONLY-'+i,FileName:'TEST_ONLY-'+i+'.xlsx',InputDate:'2026-11-09',GrossWeight:i<3?100:null,ChargeableWeight:i<3?120:null,WdetailKey:99100+i,ProdKey:99200+i,OrderCode:'1',ProdName:i<3?'ROSE CHINA TEST_ONLY':i===3?'HYDRANGEA TEST_ONLY':i===4?'CARNATION TEST_ONLY':'ROSE TEST_ONLY',CounName:i<3?'중국':'콜롬비아',FlowerName:i===3?'수국':i===4?'카네이션':'장미',OutUnit:i<3?'단':'송이',BoxQuantity:1,BunchQuantity:10,SteamQuantity:100,OutQuantity:i<3?10:100,UPrice:i<3?2:1,TPrice:i<3?20:100,SteamOf1Bunch:10,SteamOf1Box:100}));
  // Replay a previously read-only normalized snapshot without opening MSSQL.
  if(!Array.isArray(raw)&&Array.isArray(raw.lines)){
    const s=raw,header={WarehouseKey:s.warehouseKey,OrderYear:s.orderYear,OrderWeek:s.orderWeek,
      FarmName:s.farmName,InvoiceNo:s.invoiceNo,InputDate:s.inputDate,GrossWeight:s.gw,ChargeableWeight:s.cw};
    raw=s.lines.map(l=>({...header,WdetailKey:l.wdetailKey,ProdKey:l.prodKey,ProdName:l.originalName,
      CounName:l.originName||l.country,FlowerName:l.flowerName,ProductDeleted:l.productDeleted,
      BoxQuantity:l.boxQuantity,BunchQuantity:l.bunchQuantity,SteamQuantity:l.stemQuantity,
      OutQuantity:l.outQuantity,OutUnit:l.outUnit,UPrice:l.unitPrice,TPrice:l.lineAmount,
      TariffRate:l.tariffRate,SteamOf1Bunch:l.stemsPerBunch,SteamOf1Box:l.stemsPerBox}));
    raw.push(...s.excluded.map(l=>({...header,WdetailKey:l.key,ProdName:l.name,OutQuantity:l.quantity,TPrice:l.amount})));
  }
  if(!Array.isArray(raw)||!raw.length)throw Error('Fixture requires nonempty receipt rows');
  const types = { Int:1, NVarChar:n=>n }, queryFn = async (sql,p) => {
    if (/\b(INSERT|UPDATE|DELETE|EXEC|MERGE)\b/i.test(sql)) throw new Error('Write blocked');
    counts.read++;
    if(sql.includes('invoice-expenses:committed-scope'))return {recordset:[]};
    if(sql.includes('nl-cost:readonly-customer-comparison'))return {recordsets:[
      [{CustKey:999999,OrderCode:'CL2'}],[],raw.map(r=>({...r}))]}; // TEST_ONLY: no customer-order evidence.
    return { recordset: raw.filter(r=>(!p.warehouseKey||r.WarehouseKey===p.warehouseKey.value)&&r.OrderYear===p.orderYear.value&&r.OrderWeek===p.orderWeek.value) };
  };
  const child = spawn(process.execPath,[require.resolve('next/dist/bin/next'),...(process.env.NATIVE_FIXTURE_DEV==='1'?['dev','--webpack']:['start']),'-H','127.0.0.1','-p',String(appPort)],{
    env:{...process.env,DB_SERVER:'',DB_USER:'',DB_PASSWORD:'',NEXT_DIST_DIR:'.next',JWT_SECRET:secret},stdio:['ignore','ignore','ignore'],windowsHide:true });
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://127.0.0.1');
    const send = (value,status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(url.pathname==='/fixture-status') return send(counts);
    if(url.pathname.startsWith('/api/')) {
      let body='';for await(const chunk of req) body+=chunk;
      let payload={};try {payload=JSON.parse(body||'{}');}catch{}
      if(process.env.CONTRACT_RECEIPT_FIXTURE==='1'&&url.pathname==='/api/import/receipts/auto-fill'&&req.method==='POST')return /^\d{4}$/.test(String(payload.orderYear||''))?send({success:true,resolution:{farm:{farmKey:1,farmName:'Cloudland TEST_ONLY'},inputDate:payload.rawMetadata?.invoiceUploadDate||'',transportMode:'AIR',issues:[],source:{basis:'TEST_ONLY'}}}):send({success:false,error:'인보이스 연도를 확인하세요.'},400);
      if(process.env.CONTRACT_RECEIPT_FIXTURE==='1'&&req.method==='GET'&&/^\/api\/import\/receipts\/[a-f0-9-]{36}$/.test(url.pathname))return send({success:false,code:'INVOICE_DOCUMENT_NOT_FOUND',error:'TEST_ONLY document not saved'},404);
      if(url.pathname==='/api/import/receipts/week-cost') {
        if(payload.action==='preview')counts.preview++;if(payload.action==='download')counts.download++;
        res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(v));};res.send=v=>res.end(v);
        return createArrivalWeekCostHandler({queryFn,types,authorize:u=>u===user})({method:req.method,body:payload,user},res);
      }
      if(url.pathname==='/api/import/receipts/native-cost') {
        if(payload.action==='preview')counts.preview++;
        const handler=createNativeCostHandler({queryFn,types,authorize:u=>u===user,generate:async result=>{
          const testResult={...result,input:{...result.input,exchangeRateType:'TEST_ONLY',
            estimateSource:`TEST_ONLY 격리 재생. 고객 주문은 합성 시험자료. ${result.input.estimateSource||''}`}};
          const bytes=await createNativeCostWorkbook(testResult);counts.download++;counts.downloadBytes=bytes.length;return bytes;
        }});
        res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(v));};res.send=v=>res.end(v);
        return handler({method:req.method,query:Object.fromEntries(url.searchParams),body:payload,user},res);
      }
      if(req.method!=='GET'){counts.blockedWrites++;return send({success:false,error:'Fixture blocks writes'},409);}
      if(url.pathname==='/api/import/receipts/live-exchange-rate'){
        try{return send({success:true,...await fetchLiveInvoiceRate(url.searchParams.get('currency'))});}
        catch{return send({success:false,error:'시험 환율 조회 실패'},503);}
      }
      if(url.pathname==='/api/auth/me')return send({success:true,user});
      if(url.pathname==='/api/import/receipts/warehouse-list')return send({success:true,
        scope:{orderYear:url.searchParams.get('orderYear'),orderWeek:url.searchParams.get('orderWeek')},
        rows:raw.filter(r=>String(r.OrderYear)===url.searchParams.get('orderYear')&&r.OrderWeek===url.searchParams.get('orderWeek'))
          .filter((r,i,a)=>a.findIndex(x=>x.WarehouseKey===r.WarehouseKey)===i),hasMore:false});
      if(url.pathname==='/api/import/tools/state')return send({success:true,value:null,revision:0,history:[]});
      if(url.pathname==='/api/import/tools/product-matches')return send({success:true,products:[],value:{version:1,entries:[]},revision:1});
      return send({success:true,items:[],history:[],events:[],entries:[],documents:[]});
    }
    const upstream=http.request({hostname:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${appPort}`,cookie:`nenovaToken=${token}`,authorization:`Bearer ${token}`}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    upstream.on('error',()=>{res.writeHead(503);res.end('Starting isolated app');});req.pipe(upstream);
  });
  server.listen(uiPort,'127.0.0.1',()=>console.log(`NATIVE_UI_FIXTURE http://127.0.0.1:${uiPort}/import/tools?popup=1`));
  const stop=()=>{child.kill();server.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
