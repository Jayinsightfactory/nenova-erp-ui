// Actual local UI, all APIs intercepted with synthetic data. No ERP connection or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');

const root=process.cwd(),paced=process.argv.includes('--paced-dry-run'),dry=process.argv.includes('--dry-run')||paced;
async function main(){
 fs.mkdirSync('.verify',{recursive:true});
 const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8')),workflow=registry.workflows.find(w=>w.id==='import-country-orders');
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://localhost:${port}`,secret=crypto.randomUUID(),log=fs.openSync('.verify/country-orders-guide-server.log','w');
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret,PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED:'1'},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 let browser,page,rec,stopped=false;
 try{
  for(let n=0;n<120;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===119)throw Error('Local server startup failed');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});page.setDefaultTimeout(20000);
  const user={userId:'guide',userName:'연습 담당자',authority:1,deptName:'수입부',accountActive:true};
  await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'1h'}),url:base});
  const cycles = Array.from({length:6}, (_, offset) => ({ key: '2026/' + (46+offset), year:2026, majorWeek:String(46+offset), startDate:'2026-11-12', endDate:'2026-11-18' }));
  const week = {key:'2026/46-01',orderWeek:'46-01'};
  const row = {OrderYear:2026, OrderWeek:week.orderWeek, CustKey:1, CustName:'연습 업체', CustOrderCode:'CL21', ProdKey:1, ProdName:'연습 튤립', FlowerName:'튤립', CounName:'네덜란드', OutUnit:'송이', OutQuantity:150, BoxQuantity:0, BunchQuantity:15, SteamQuantity:150, SourceRowCount:1};
  const downloadDir = path.resolve('.verify/country-orders',crypto.randomUUID());
  fs.mkdirSync(downloadDir,{recursive:true});
  const client=await page.createCDPSession(); await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  const details=[];
  await page.setRequestInterception(true);
  page.on('request',async req=>{
    const url=new URL(req.url());
    if(url.protocol==='blob:') return req.continue();
    if(url.origin!==base)return req.abort();
    if(!url.pathname.startsWith('/api/'))return req.continue();
    let data={success:true,items:[],rows:[],products:[],data:[],value:null,revision:0,history:[],user};
    if(url.pathname.endsWith('/country-orders')){
      const country=url.searchParams.get('country'),exact=url.searchParams.get('orderWeek');
      if(exact)details.push(exact);
      data={success:true,readOnly:true,cycles,scope:country?{country,counName:'네덜란드',year:2026,majorWeek:'46',scopeKey:country+'/2026/46'}:null,subweeks:country?[week]:[],rows:exact?[row]:[],warnings:[]};
    }
    await req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(base+'/import/tools',{waitUntil:'networkidle0',timeout:150000});
  await page.waitForSelector('[aria-controls="import-panel-orders"]');
  await page.click('[aria-controls="import-panel-orders"]');
  const country='.pedidos-auto [aria-label="국가"] button:nth-child(2)',cycle='.pedidos-cycles button',sub='.pedidos-subweeks[aria-label="실제 주문 세부차수"] button',down='.pedidos-auto-actions button:not([disabled])';
  await page.waitForSelector(country,{visible:true});
  const countryButton=await page.evaluate(()=>[...document.querySelectorAll('[aria-label="국가"] button')].findIndex(b=>b.textContent.includes('네덜란드'))+1);
  assert(countryButton);
  rec=dry?{chapter(){},focus:async()=>{},unfocus:async()=>{},caption:async()=>{},pause:async()=>{},stop:async()=>({})}:await createWorkflowGuideRecorder(page,{workflowId:workflow.id,guideId:'import',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true});
  const steps=[
   ['country','국가 선택','[aria-label="국가"] button:nth-child('+countryButton+')','네덜란드를 선택하면 차수 버튼이 나타납니다.'],
   ['cycle','차수 선택',cycle,'2026년 46차를 선택해 실제 주문이 있는 세부차수를 확인합니다.'],
   ['week','세부차수 조회',sub,'46-01차를 누르면 해당 세부차수의 품목과 주문 수량을 불러옵니다.'],
   ['review','송이 수 확인·수정','.pedidos-review-input','전산 원수량 150송이를 확인하고 이번 발주 수량을 140송이로 수정합니다.'],
   ['download','엑셀 다운로드',down,'파일명이 표시된 다운로드 버튼을 눌러 발주서를 저장합니다.']];
  for(const [i,[scenario,label,selector,description]] of steps.entries()){
    await page.waitForSelector(selector,{visible:true});
    if(i===3) {await page.waitForFunction(()=>document.querySelector('.pedidos-auto-actions button')?.textContent.includes('.xlsx')); assert.deepEqual(details,[week.orderWeek]);}
    if(i===2)assert.equal(details.length,0);
    const title=(i+1)+'. '+label;
    await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));
    rec.chapter(scenario,title);await rec.caption(title+' · '+description);await rec.pause(2300);await rec.focus(selector,i+1);
    await page.focus(selector);
    if(scenario==='review'){await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('140',{delay:150});await page.keyboard.press('Tab');assert.equal(await page.$eval(selector,n=>n.value),'140');}else await page.keyboard.press('Enter');await rec.pause(2800);await rec.unfocus();
  }
  let filename;
  for(let n=0;n<50&&!filename;n++){filename=fs.readdirSync(downloadDir).find(f=>f.endsWith('.xlsx'));if(!filename)await new Promise(r=>setTimeout(r,100));}
  assert(filename,'browser saved XLSX');const XLSX=require('xlsx'),wb=XLSX.readFile(path.join(downloadDir,filename));assert(Object.values(wb.Sheets[wb.SheetNames[0]]).some(c=>c?.v===140));
  const result=await rec.stop();stopped=true;
  if(!dry){workflow.guides[0].chapters=result.chapters;workflow.guides[0].status='ready';fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');}
  console.log('PASS keyboard country, cycle, subweek, browser download, XLSX quantity 140');
 }finally{await browser?.close();if(server.pid && server.exitCode===null) require('node:child_process').spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
