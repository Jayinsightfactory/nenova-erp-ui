// Explicit isolated test server. No app .env, SQL client, provider or production request.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const jwt=require('jsonwebtoken');
async function main(){
  const {createCountryOrderHistoryStore}=await import('../lib/countryOrderHistoryStore.js');
  const {createCountryOrderHistoryHandler}=await import('../lib/countryOrderHistoryApi.js');
  const {createCountryOrderSourceHandler}=await import('../lib/countryOrderSourceApi.js');
  const {buildCountryOrderMatrix}=await import('../lib/countryOrderSource.js');
  const {generateCompactCountryOrders}=await import('../lib/countryOrderPresentation.js');
  const {serializePedidosWorkbook}=await import('../lib/importPedidos.js');
  const {withCountryOrderEta}=await import('../lib/countryOrderEta.js');
  const port=Number(process.env.COUNTRY_FIXTURE_PORT||19483),nextPort=port+1;
  const output=path.resolve('.verify/country-order-desktop',crypto.randomUUID());fs.mkdirSync(output,{recursive:true});
  const secret=crypto.randomUUID(),scope={country:'China',year:2026,orderWeek:'47-02'};
  const user={userId:'fixture-country',userName:'TEST_ONLY 연습 계정',deptName:'수입부',authority:1,accountActive:true};
  const cookie='nenovaToken='+jwt.sign(user,secret,{expiresIn:'2h'});
  let scenario='registered',queries=0,fixturePosts=0;
  const rawRows=quantity=>[{OrderYear:2026,OrderWeek:'47-02',CustKey:1,CustName:'TEST_ONLY 업체A',CustOrderCode:'CL1',ProdKey:2,ProdName:'ROSE / TEST_ONLY A',FlowerName:'장미',CounName:'중국',OutUnit:'단',OutQuantity:quantity,BunchQuantity:quantity,SteamQuantity:quantity*10,SourceRowCount:1},{OrderYear:2026,OrderWeek:'47-02',CustKey:3,CustName:'TEST_ONLY 업체B',CustOrderCode:'CL3',ProdKey:4,ProdName:'ROSE / TEST_ONLY B',FlowerName:'장미',CounName:'중국',OutUnit:'단',OutQuantity:50,BunchQuantity:50,SteamQuantity:500,SourceRowCount:1}];
  const matrix=quantity=>buildCountryOrderMatrix({success:true,readOnly:true,scope:{...scope,majorWeek:'47',counName:'중국',scopeKey:'China/2026/47'},subweeks:[{orderWeek:'47-02'}],rows:rawRows(quantity)},'47-02');
  const generated=(m,options={},eta)=>generateCompactCountryOrders(m,options).map(output=>({...output,bytes:Buffer.from(serializePedidosWorkbook(eta?withCountryOrderEta(output.workbook,'47-02',eta):output.workbook))}));
  const store=createCountryOrderHistoryStore({root:path.join(output,'history')});
  const initial=generated(matrix(100))[0];
  const initialRows=matrix(100).rows.flatMap(row=>matrix(100).customers.map(customer=>({custKey:customer.key,customer:customer.name,prodKey:row.prodKey,product:row.name,unit:row.unit,quantity:row.quantities[customer.key]??0})));
  const seed=await store.save({scope,id:crypto.randomUUID(),filename:initial.filename,bytes:initial.bytes,rows:initialRows,sourceKeys:[],queriedAt:'2026-11-19T01:00:00Z',actor:user.userId});
  await store.markDelivered({scope,id:seed.id,sha256:seed.sha256,actor:user.userId,confirmed:true});
  const sourceItem={sourceKey:'TEST_ONLY-message-1/row-1',scope,rawCustomer:'TEST_ONLY 업체A',rawProduct:'ROSE / TEST_ONLY A',customer:'TEST_ONLY 업체A',product:'ROSE / TEST_ONLY A',unit:'bunches',quantity:20,at:'2026-11-19T02:00:00Z',kind:'addition'};
  const messages=[{id:'TEST_ONLY-message-1',time:'2026년 11월 19일 오전 11:00',text:'TEST_ONLY 격리 연습 자료\n2026년 47-02 중국 추가 발주\nTEST_ONLY 업체A\nROSE / TEST_ONLY A 20단 추가',items:[sourceItem]}];
  const quantity=()=>scenario==='partial'?110:scenario==='chat-only'?100:120;
  const events=()=>scenario==='registered'?[{id:'history:TEST_ONLY-1',scope,custKey:1,prodKey:2,unit:'bunches',orderDetailKey:91001,kind:'increase',before:100,after:120,at:'2026-11-19T02:05:00Z'}]:scenario==='partial'?[{id:'history:TEST_ONLY-partial',scope,custKey:1,prodKey:2,unit:'bunches',orderDetailKey:91001,kind:'increase',before:100,after:110,at:'2026-11-19T02:05:00Z'}]:[];
  const historyHandler=createCountryOrderHistoryHandler({store,secret,canAccess:actor=>actor?.userId===user.userId,readCurrent:async()=>{queries++;return{matrix:matrix(quantity()),queriedAt:'2026-11-19T03:00:00Z',details:[{orderDetailKey:91001,custKey:1,prodKey:2,quantity:quantity(),unit:'bunches'}],events:events()};},readMessages:async()=>messages,generate:generated});
  const calendar=Array.from({length:6},(_,index)=>({OrderYearWeek:'2026'+(47+index),WeekDay:5,BaseYmd:new Date(Date.UTC(2026,10,19+index*7)).toISOString().slice(0,10)}));
  const sourceHandler=createCountryOrderSourceHandler({types:{NVarChar:()=>null},now:()=>new Date('2026-11-19T03:00:00Z'),queryFn:async(statement)=>({recordset:statement.includes('FROM PeriodDay')?calendar:statement.includes('HiddenCount')?[{HiddenCount:0}]:statement.includes('SELECT DISTINCT')?[{OrderWeek:'47-02'}]:rawRows(quantity())})});
  const menus=JSON.parse(fs.readFileSync('desktop/menu.json','utf8'));
  const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const childEnv={...process.env,JWT_SECRET:secret,DB_SERVER:'',DB_USER:'',DB_PASSWORD:'',DB_NAME:'',ORBIT_OWNER_TOKEN:'',ANTHROPIC_API_KEY:'',PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED:'1',NENOVA_PENDING_STOCK_RECOVERY:'0'};
  const log=fs.openSync(path.join(output,'next.log'),'w');
  const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(nextPort)],{env:childEnv,stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1:'+port);
      if(url.pathname==='/fixture/status')return json(res,{fixtureOnly:true,scenario,queries,fixturePosts,output,nextPid:child.pid,productionWrites:0,paidCalls:0});
      if(url.pathname==='/fixture/control'&&req.method==='POST'){const body=JSON.parse(await bodyOf(req));if(!['registered','chat-only','partial'].includes(body.scenario))return json(res,{error:'invalid scenario'},400);scenario=body.scenario;return json(res,{fixtureOnly:true,scenario});}
      if(url.pathname==='/api/import/tools/country-orders'||url.pathname==='/api/import/tools/country-order-history'){
        if(req.method!=='GET')fixturePosts++;
        const body=req.method==='POST'?JSON.parse(await bodyOf(req)):undefined;
        const response={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(value){res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));return this;},send(value){res.end(value);return this;},end(){res.end();return this;}};
        return await (url.pathname.endsWith('country-orders')?sourceHandler:historyHandler)({method:req.method,user,query:Object.fromEntries(url.searchParams),body},response);
      }
      if(url.pathname==='/api/auth/me')return json(res,{success:true,user});
      if(url.pathname==='/api/desktop/bootstrap')return json(res,{success:true,schemaVersion:1,user,webVersion:'TEST_ONLY country-order-history',menuVersion:'a'.repeat(64),menus});
      if(url.pathname==='/api/import/tools/kakao-additions')return json(res,{messages:[],review:[],stats:{scanned:0,selected:0,review:0,excluded:0,duplicates:0},orderDays:[]});
      if(url.pathname.startsWith('/api/'))return json(res,{success:true,user,value:null,revision:0,history:[],rows:[],items:[],products:[],data:[],farms:[{FarmName:'Melody'},{FarmName:'CLOUD'}],favorites:[],ownerId:user.userId,date:'2026-11-19',tasks:[],guidance:[],feedback:[],events:[],sources:[],totals:{}});
      const target='http://127.0.0.1:'+nextPort+url.pathname+url.search;
      const response=await fetch(target,{headers:{cookie},redirect:'manual'});res.statusCode=response.status;for(const [key,value]of response.headers)if(!['connection','transfer-encoding','content-encoding','content-length'].includes(key))res.setHeader(key,value);res.end(Buffer.from(await response.arrayBuffer()));
    }catch{json(res,{error:'ISOLATED_FIXTURE_FAILURE'},500);}
  });
  server.listen(port,'127.0.0.1',()=>{fs.writeFileSync(path.join(output,'status.json'),JSON.stringify({port,nextPort,pid:process.pid,nextPid:child.pid,output}));console.log('FIXTURE_READY '+JSON.stringify({url:'http://127.0.0.1:'+port,output,pid:process.pid,nextPid:child.pid,productionWrites:0,paidCalls:0}));});
  const stop=()=>{server.close();if(child.exitCode===null)child.kill();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
async function bodyOf(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>3*1024*1024)throw Error('limit');}return text;}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
