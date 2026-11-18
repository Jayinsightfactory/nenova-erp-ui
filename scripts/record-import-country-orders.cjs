// Actual local UI, all APIs intercepted with synthetic data. No ERP connection or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');

const root=process.cwd(),paced=process.argv.includes('--paced-dry-run'),dry=process.argv.includes('--dry-run')||paced;
async function main(){
 fs.mkdirSync('.verify',{recursive:true});
 const {classifyImportFeed}=await import('../lib/importKakaoOrderText.js');
 const sampleMessage=(id,text)=>({id,time:'2026년 11월 18일 오전 9:10',text,sender:'연습 담당자',items:[]});
 const sampleMessages=[...['주광','미우','일신'].map((customer,i)=>sampleMessage(String(i),'46-1 콜 카네이션 발주 추가\n'+customer+'\nMoon Light '+[1,2,1][i]+'박스')),sampleMessage('white','46-1 콜 수국 발주 추가\n화이트 2박스'),sampleMessage('duplicate','46-1 콜 카네이션 발주 추가\n주광\nMoon Light 1박스'),sampleMessage('noise','이번에 온 3박스가 포장 불량입니다'),sampleMessage('cancel','46-1 콜 카네이션 발주 취소\n별도품종 1박스')];
 const sampleFeed=classifyImportFeed({from:'2026-11-17',to:'2026-11-18',latest:'2026년 11월 18일 오전 9:10',messages:sampleMessages});
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
  const addDays=days=>new Date(Date.parse('2026-11-12T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const cycles = Array.from({length:6}, (_, offset) => ({ key: '2026/' + (46+offset), year:2026, majorWeek:String(46+offset), startDate:addDays(offset*7), endDate:addDays(offset*7+6) }));
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
    if(url.pathname.endsWith('/kakao-additions')) data=sampleFeed;
    if(url.pathname.endsWith('/country-orders')){
      const country=url.searchParams.get('country'),exact=url.searchParams.get('orderWeek');
      if(exact)details.push(exact);
      const counName=country==='China'?'중국':'네덜란드';
      const sourceRows=country==='China'?[{...row,CounName:counName,ProdName:'ROSE / 연습 화이트 50cm',FlowerName:'장미',OutUnit:'단',OutQuantity:15},{...row,CounName:counName,ProdKey:2,ProdName:'ROSE / 연습 핑크 50cm',FlowerName:'장미',OutUnit:'단',OutQuantity:10}]:[row];
      data={success:true,readOnly:true,cycles,scope:country?{country,counName,year:2026,majorWeek:'46',scopeKey:country+'/2026/46'}:null,subweeks:country?[week]:[],rows:exact?sourceRows:[],warnings:[],diagnostics:{hiddenOrderCount:0}};
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
   ['download','다운로드·ETA 창 열기',down,'파일명이 표시된 다운로드 버튼을 누르면 ETA 입력 창이 열립니다.'],
   ['eta','ETA 날짜 입력','[aria-labelledby="pedidos-eta-title"] input[type="text"]','달력으로 날짜를 선택하거나 아래에 직접 입력합니다. 2026-11-16과 영문 요일을 확인합니다.'],
   ['save','ETA 저장·엑셀 다운로드','[aria-labelledby="pedidos-eta-title"] button[type="submit"]','ETA를 기본값으로 저장하고 엑셀을 내려받습니다. 전산 주문 수량은 바뀌지 않습니다.']];
  for(const [i,[scenario,label,selector,description]] of steps.entries()){
    await page.waitForSelector(selector,{visible:true});
    if(i===3) {await page.waitForFunction(()=>document.querySelector('.pedidos-auto-actions button')?.textContent.includes('.xlsx')); assert.deepEqual(details,[week.orderWeek]);}
    if(i===2)assert.equal(details.length,0);
    const title=(i+1)+'. '+label;
    await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));
    rec.chapter(scenario,title);await rec.caption(title+' · '+description);await rec.pause(2300);await rec.focus(selector,i+1);
    await page.focus(selector);
    if(scenario==='review'||scenario==='eta'){await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(scenario==='eta'?'2026-11-16':'140',{delay:150});await page.keyboard.press('Tab');assert.equal(await page.$eval(selector,n=>n.value),scenario==='eta'?'2026-11-16':'140');if(scenario==='eta')assert((await page.$eval('[aria-labelledby="pedidos-eta-title"]',n=>n.textContent)).includes('ETA (2026,11,16 Monday)'));}else await page.keyboard.press('Enter');await rec.pause(2800);await rec.unfocus();
  }
  let filename;
  for(let n=0;n<50&&!filename;n++){filename=fs.readdirSync(downloadDir).find(f=>f.endsWith('.xlsx'));if(!filename)await new Promise(r=>setTimeout(r,100));}
  assert(filename,'browser saved XLSX');const XLSX=require('xlsx'),wb=XLSX.readFile(path.join(downloadDir,filename));assert(Object.values(wb.Sheets[wb.SheetNames[0]]).some(c=>c?.v===140));
  assert(wb.Sheets[wb.SheetNames[0]].A1.v.endsWith('Semana 46-01차 ETA (2026,11,16 Monday)'));
  await page.click(down);await page.waitForSelector('[aria-labelledby="pedidos-eta-title"]');
  assert.equal(await page.$eval('[aria-labelledby="pedidos-eta-title"] input[type="date"]',n=>n.value),'2026-11-16');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[aria-labelledby="pedidos-eta-title"]'));
  const chinaIndex=await page.evaluate(()=>[...document.querySelectorAll('[aria-label="국가"] button')].findIndex(button=>button.textContent.includes('중국'))+1);
  const farmSteps=[
   ['china','중국 발주 조회','[aria-label="국가"] button:nth-child('+chinaIndex+')','중국을 선택하고 차수와 세부차수를 다시 선택합니다.'],
   ['china-cycle','중국 차수 선택',cycle,'2026년 46차를 선택합니다.'],
   ['china-week','중국 세부차수 선택',sub,'46-01차의 모든 품목과 업체 수량을 불러옵니다.'],
   ['farm','기본 수신명 수정','.pedidos-farms input[type="text"]','기본값 Melody는 유지됩니다. 이번에는 HUBFRESH로 바꿉니다. 농장명을 검색하거나 직접 입력할 수 있습니다.'],
   ['split','농장별 파일 나누기','.pedidos-split-toggle input','나누기를 켜면 농장 1에 체크한 품목과 미선택 품목의 파일이 나뉩니다. 기본 상태에서는 나누지 않습니다.'],
   ['assign','농장 1 품목 선택','.pedidos-matrix input[aria-label="ROSE / 연습 화이트 50cm 농장 1 HUBFRESH"]','화이트 품목을 농장 1로 선택합니다. 체크한 품목 전체 업체 수량은 HUBFRESH, 나머지는 CLOUD 파일에 들어갑니다.'],
   ['farm-download','농장별 파일 확인',down,'두 농장 파일이 따로 나타납니다. HUBFRESH 파일을 열어 ETA를 확인합니다.'],
   ['farm-save','농장 파일 다운로드','[aria-labelledby="pedidos-eta-title"] button[type="submit"]','확인한 ETA로 다운로드합니다. 첫 시트는 업체별 발주표이며 뒤쪽에 기존 국가 양식도 보존됩니다.']];
  for(const [offset,[scenario,label,selector,description]] of farmSteps.entries()){
    await page.waitForSelector(selector,{visible:true});
    await page.$eval(selector,node=>node.scrollIntoView({block:'center'}));
    const number=steps.length+offset+1;rec.chapter(scenario,number+'. '+label);await rec.caption(number+'. '+label+' · '+description);await rec.pause(2300);await rec.focus(selector,number);
    await page.focus(selector);
    if(scenario==='farm'){assert.deepEqual(await page.$$eval('.pedidos-farms input[type="text"]',nodes=>nodes.map(node=>node.value)),['Melody','CLOUD']);await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('HUBFRESH',{delay:150});await page.keyboard.press('Tab');}
    else await page.keyboard.press(['assign','split'].includes(scenario)?'Space':'Enter');
    if(scenario==='assign')await page.waitForFunction(()=>document.querySelectorAll('.pedidos-auto-actions button').length>=3&&document.querySelector('.pedidos-auto-actions').textContent.includes('HUBFRESH')&&document.querySelector('.pedidos-auto-actions').textContent.includes('CLOUD'));
    await rec.pause(2800);await rec.unfocus();
  }
  let farmFile;for(let n=0;n<50&&!farmFile;n++){farmFile=fs.readdirSync(downloadDir).find(name=>name.includes('HUBFRESH')&&name.endsWith('.xlsx'));if(!farmFile)await new Promise(resolve=>setTimeout(resolve,100));}
  assert(farmFile,'farm download saved');const farmWb=XLSX.readFile(path.join(downloadDir,farmFile));assert.equal(farmWb.SheetNames[0],'업체별 발주');assert.equal(farmWb.Sheets['업체별 발주'].C5.v,15);
  for(const [n,id,label,selector,caption,key] of [
    [16,'chat','최근 2일 카톡 확인','.kakao-additions > button','최근 2일 원문을 분석해 추가 발주만 표시합니다. 일반 대화와 중복은 제외하고 취소는 검토로 분리합니다.','Enter'],
    [17,'sum','품목군 선택·자동 합계','.kakao-additions select','콜롬비아 카네이션을 선택하면 Moon Light 4박스와 업체별 주광 1, 미우 2, 일신 1을 확인할 수 있습니다.',null],
    [18,'copy','농장 전달용 복사','.kakao-additions .kakao-table + button','합계와 비고를 복사해 농장에 전달합니다.','Enter']
  ]){
    await page.waitForSelector(selector,{visible:true});
    await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));
    rec.chapter(id,n+'. '+label);await rec.caption(n+'. '+label+' · '+caption);await rec.pause(2300);await rec.focus(selector,n);
    if(id==='sum')await page.select(selector,'콜롬비아 · 카네이션');if(key){await page.focus(selector);await page.keyboard.press(key);}await rec.pause(2800);await rec.unfocus();
  }
  assert((await page.$eval('.kakao-table',el=>el.textContent)).includes('주광 1, 미우 2, 일신 1'));
  assert.equal(await page.$$eval('.kakao-order-message',nodes=>nodes.length),3);
  assert(!(await page.$eval('.kakao-additions',n=>n.textContent)).includes('이번에 온 3박스'));
  assert((await page.$eval('.kakao-counts',n=>n.textContent)).includes('중복 제외 1건'));
  assert.equal(await page.$('.kakao-additions input[type="date"]'),null);
  assert(await page.$eval('.kakao-additions details',node=>node.open));
  await page.click('.kakao-additions > button');
  await page.waitForNetworkIdle();
  assert(await page.$eval('.kakao-additions input[type="checkbox"]',node=>node.checked));
  assert((await page.$eval('.kakao-table',node=>node.textContent)).includes('주광 1, 미우 2, 일신 1'));

  assert.equal(await page.$eval('.kakao-table tbody tr td:nth-child(3)',n=>n.textContent),'4 박스');
  await page.click('.kakao-additions input[type="checkbox"]');
  assert.equal(await page.$eval('.kakao-table tbody tr td:nth-child(3)',n=>n.textContent),'3 박스');
  await page.click('.kakao-additions > button');await page.waitForNetworkIdle();
  assert.equal(await page.$eval('.kakao-additions input[type="checkbox"]',n=>n.checked),false);
  assert.equal(await page.$eval('.kakao-table tbody tr td:nth-child(3)',n=>n.textContent),'3 박스');
  console.log('PASS initial automatic total4, customer remarks, manual exclusion3 preserved after refresh');
  const result=await rec.stop();stopped=true;
  await page.select('.kakao-additions select','');
  const reviewButton=await page.$('.kakao-additions > button[aria-expanded]');await reviewButton.focus();await page.keyboard.press('Enter');
  await page.waitForSelector('[aria-label="카톡 발주 검토"]');
  assert.equal(await page.$eval('[aria-label="카톡 발주 검토"] input[type="checkbox"]',n=>n.checked),false);
  assert((await page.$eval('[aria-label="카톡 발주 검토"]',n=>n.textContent)).includes('취소'));
  console.log('PASS raw classification, group filter, noise/duplicate exclusion and cancellation review UI');
  // A previously explicit inclusion must not survive a newly collected cancellation.
  await page.click('.kakao-additions input[type="checkbox"]');
  Object.assign(sampleFeed,classifyImportFeed({from:'2026-11-17',to:'2026-11-18',messages:[...sampleMessages,sampleMessage('new-cancel','46-1 콜 카네이션 발주 취소\nMoon Light 1박스')]}));
  await page.click('.kakao-additions > button');await page.waitForNetworkIdle();
  assert(!(await page.$eval('.kakao-table',n=>n.textContent)).includes('Moon Light'));
  assert(await page.$$eval('[aria-label="카톡 발주 검토"] input[type="checkbox"]',nodes=>nodes.length>=4&&nodes.every(n=>!n.checked)));
  console.log('PASS live refresh invalidates prior inclusion when a related cancellation arrives');
  if(!dry){workflow.guides[0].chapters=result.chapters;workflow.guides[0].status='ready';fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');}
  if(dry){
    await page.evaluate(title=>{const heading=[...document.querySelectorAll('h3')].find(node=>node.textContent===title);if(!heading)throw Error('Guide heading missing');heading.closest('details').id='country-order-guide-test';},workflow.title);
    await page.focus('#country-order-guide-test > summary');await page.keyboard.press('Enter');
    await page.$eval('#country-order-guide-test video',video=>{video.muted=true;return video.play();});
    await page.waitForFunction(()=>document.querySelector('#country-order-guide-test video').currentTime>.3);
    const chapters=await page.$$('#country-order-guide-test nav button');assert.equal(chapters.length,workflow.guides[0].chapters.length);
    await chapters[5].focus();await page.keyboard.press('Enter');
    assert(await page.$eval('#country-order-guide-test video',video=>video.currentTime>50));
    await page.$eval('#country-order-guide-test video',video=>{video.textTracks[0].mode='showing';});
    await page.waitForFunction(()=>document.querySelector('#country-order-guide-test video track').readyState===2);
    assert(await page.$eval('#country-order-guide-test video',video=>video.textTracks[0].language==='ko'));
    await page.setViewport({width:390,height:844});
    assert(await page.$eval('.kakao-additions',node=>{const r=node.getBoundingClientRect();return r.width<=innerWidth&&r.left>=0&&r.right<=innerWidth+1;}));
    assert(await page.$eval('#country-order-guide-test video',video=>{const rect=video.getBoundingClientRect();return rect.width<=innerWidth;}));
    console.log('PASS actual guide player MP4 playback, registered chapters, Korean captions, keyboard and 390px');
  }
  console.log('PASS keyboard country/cycle/subweek, ETA manual/date sync, stored default, Escape, browser download, XLSX quantity140/title');
 }finally{await browser?.close();if(server.pid && server.exitCode===null) require('node:child_process').spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
