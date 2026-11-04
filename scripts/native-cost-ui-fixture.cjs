// Loopback-only fixture: all API requests terminate here, no DB connection.
const http = require('node:http'), crypto = require('node:crypto'), { spawn } = require('node:child_process'), jwt = require('jsonwebtoken');
(async () => {
  const { createNativeCostWorkbook } = await import('../lib/invoiceReceiptCostExport.js');
  const { createNativeCostHandler } = await import('../lib/nativeCostHttp.js');
  const secret = crypto.randomBytes(32).toString('hex'), user = { userId:'fixture-user', userName:'테스트 담당자', authority:1, deptName:'테스트' };
  const token = jwt.sign(user, secret, { expiresIn:'2h' });
  const counts = { read:0, preview:0, download:0, blockedWrites:0 };
  let raw = process.env.NATIVE_COST_FIXTURE ? JSON.parse(require('node:fs').readFileSync(process.env.NATIVE_COST_FIXTURE, 'utf8')) : [1,2].map(i => ({ WarehouseKey:90001, OrderYear:'2026', OrderWeek:'43-01', FarmName:'TEST_ONLY FARM', InvoiceNo:'격리 계산 시험',
    InputDate:'2026-10-20', GrossWeight:20, ChargeableWeight:25, WdetailKey:91000+i, ProdKey:92000+i,
    ProdName:`테스트 수국 ${i}`, CounName:'중국', FlowerName:'수국', OutUnit:'단', BoxQuantity:1, BunchQuantity:20, SteamQuantity:200,
    OutQuantity:20, UPrice:10*i, TPrice:200*i, SteamOf1Bunch:10, SteamOf1Box:200 }));
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
    if(sql.includes('nl-cost:readonly-customer-comparison'))return {recordsets:[
      [{CustKey:999999,OrderCode:'CL2'}],[],raw.map(r=>({...r}))]}; // TEST_ONLY: no customer-order evidence.
    return { recordset: raw.filter(r=>r.WarehouseKey===p.warehouseKey.value && r.OrderYear===p.orderYear.value && r.OrderWeek===p.orderWeek.value) };
  };
  const child = spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H','127.0.0.1','-p','19430'],{
    env:{...process.env,DB_SERVER:'',DB_USER:'',DB_PASSWORD:'',NEXT_DIST_DIR:'.next',JWT_SECRET:secret},stdio:['ignore','ignore','ignore'],windowsHide:true });
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://127.0.0.1');
    const send = (value,status=200) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(url.pathname==='/fixture-status') return send(counts);
    if(url.pathname.startsWith('/api/')) {
      let body='';for await(const chunk of req) body+=chunk;
      let payload={};try {payload=JSON.parse(body||'{}');}catch{}
      if(url.pathname==='/api/import/receipts/native-cost') {
        if(payload.action==='preview')counts.preview++;
        const handler=createNativeCostHandler({queryFn,types,authorize:u=>u===user,generate:async result=>{
          const testResult={...result,input:{...result.input,exchangeRateType:'TEST_ONLY',
            estimateSource:`TEST_ONLY 격리 재생. 고객 주문은 합성 시험자료. ${result.input.estimateSource||''}`}};
          const bytes=await createNativeCostWorkbook(testResult);counts.download++;return bytes;
        }});
        res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(v));};res.send=v=>res.end(v);
        return handler({method:req.method,query:Object.fromEntries(url.searchParams),body:payload,user},res);
      }
      if(req.method!=='GET'){counts.blockedWrites++;return send({success:false,error:'Fixture blocks writes'},409);}
      if(url.pathname==='/api/auth/me')return send({success:true,user});
      if(url.pathname==='/api/import/receipts/warehouse-list')return send({success:true,
        scope:{orderYear:url.searchParams.get('orderYear'),orderWeek:url.searchParams.get('orderWeek')},
        rows:raw.filter(r=>String(r.OrderYear)===url.searchParams.get('orderYear')&&r.OrderWeek===url.searchParams.get('orderWeek'))
          .filter((r,i,a)=>a.findIndex(x=>x.WarehouseKey===r.WarehouseKey)===i),hasMore:false});
      if(url.pathname==='/api/import/tools/state')return send({success:true,value:null,revision:0,history:[]});
      if(url.pathname==='/api/import/tools/product-matches')return send({success:true,products:[],value:{version:1,entries:[]},revision:1});
      return send({success:true,items:[],history:[],events:[],entries:[],documents:[]});
    }
    const upstream=http.request({hostname:'127.0.0.1',port:19430,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:19430',cookie:`nenovaToken=${token}`,authorization:`Bearer ${token}`}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    upstream.on('error',()=>{res.writeHead(503);res.end('Starting isolated app');});req.pipe(upstream);
  });
  server.listen(19431,'127.0.0.1',()=>console.log('NATIVE_UI_FIXTURE http://127.0.0.1:19431/import/tools?popup=1'));
  const stop=()=>{child.kill();server.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
