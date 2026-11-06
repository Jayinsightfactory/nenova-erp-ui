// Actual local UI, all APIs intercepted with synthetic data. No ERP connection or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const {runProfitAuxScopeSmoke}=require('./lib/profit-aux-scope-smoke.cjs');
const root=process.cwd(),paced=process.argv.includes('--paced-dry-run'),dry=process.argv.includes('--dry-run')||paced;
async function main(){
 fs.mkdirSync('.verify',{recursive:true});
 const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8')),workflow=registry.workflows.find(w=>w.id==='profit-explicit-query');
 const {materializeProfitPayload}=await import('../lib/profitReportStoredCalculation.js');
 const {buildMonthlyProfitSummary}=await import('../lib/profitReportMonthly.js');
 const fixture=(year,major)=>({...materializeProfitPayload({orderYear:year,major,rows:[{category:'중국',variant:'normal',currency:'CNY',auto:{N:10000000+Number(major)*1000,L:0,O:0,Q:100,S:0,E:100000,F:50000,H:0,R:200},manual:{H:0,R:200,AC:0,AJ:0},source:{H:'manual',R:'manual'},stock:{evidenceValue:50000},beginStock:{evidenceValue:100000},inventoryValuation:{begin:{value:100000,method:'confirmed_snapshot'},end:{value:50000,method:'confirmed_snapshot'}}}],note:'연습용 보고서 비고 · 운영 자료 아님',audit:{issues:[],status:'ready'},stockWeeks:{begin:'41-01',end:'42-01'}}),success:true,major,orderYear:year,readMode:Number(major)<44?'stored':'live',financialReadPolicy:{frozen:Number(major)<44,label:Number(major)<44?'과거 저장 원본 금액 고정 · 현재 원가 미반영':'최근 업무차수 · 전체 최신 원천 조회'},snapshot:Number(major)<44?{state:'fresh',servedFrom:'snapshot',versionNo:1,savedAt:'2026-11-03T00:00:00Z'}:{state:'live',servedFrom:'live',needsRefresh:false}});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://localhost:${port}`,secret=crypto.randomUUID(),log=fs.openSync('.verify/profit-query-guide-server.log','w');
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret,PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED:'1'},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 let browser,page,rec,stopped=false;
 try{
  for(let n=0;n<120;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===119)throw Error('Local server startup failed');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});page.setDefaultTimeout(90000);
  const user={userId:'guide',userName:'연습 담당자',authority:1,deptName:'경영지원',accountActive:true};
  await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'1h'}),url:base});
  let financial=[];const errors=[],navigations=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()){navigations.push(frame.url());console.log(JSON.stringify({navigation:frame.url()}));}});
  await page.setRequestInterception(true);page.on('request',async request=>{
   try{
    const url=new URL(request.url());if(url.origin!==base)return request.abort();if(!url.pathname.startsWith('/api/'))return request.continue();
    assert(['GET','HEAD'].includes(request.method()),'No write requests allowed in report guide');
    let data={success:true,items:[],rows:[],data:[],history:[],issues:[],adjustments:[],rates:[],user};
    if(url.pathname.startsWith('/api/sales/')&&!url.searchParams.has('context'))financial.push({path:url.pathname,year:url.searchParams.get('year'),week:url.searchParams.get('week')});
    if(url.pathname==='/api/sales/profit-report'){
     if(url.searchParams.has('context'))data={success:true,current:{orderYear:'2026',major:'45'},previous:{orderYear:'2026',major:'44'}};
     else if(url.searchParams.get('period')==='annual')data={success:true,...buildMonthlyProfitSummary([{major:'42',period:{startDate:'2026-10-14',endDate:'2026-10-20'},totals:fixture('2026','42').totals}],'2026'),currentPeriod:{orderYear:'2026',major:'45'},lastIncludedMajor:'43',excludedLivePeriods:[],includeLive:false};
     else{data=fixture(url.searchParams.get('year'),url.searchParams.get('week'));if(url.searchParams.get('week')==='43')await new Promise(r=>setTimeout(r,900));}
    }
    if(url.pathname==='/api/sales/profit-report-confirm')data={success:true,initialized:true,history:[]};
    if(url.pathname==='/api/sales/profit-analysis')data={ok:true,categories:[],orderYear:url.searchParams.get('year'),major:url.searchParams.get('week')};
    if(url.pathname==='/api/sales/profit-workbook')data={success:true,source:'live',subTabs:[],rows:[],purchaseCountries:[],snapshots:[],access:{}};
    if(url.pathname==='/api/sales/profit-stock-adjustment-notes')data={ok:true,orderYear:url.searchParams.get('year'),major:url.searchParams.get('week'),items:[],text:'연습 자료: 해당 차수의 현재 원장 참고 이력이 없습니다.'};
    return await request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }catch(error){if(!request.isInterceptResolutionHandled())await request.abort().catch(()=>{});}
  });
  await page.goto(base+'/sales/profit-report?year=2026&week=42',{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('[data-testid="profit-query-empty"]');assert.equal(financial.length,0,'entry makes no financial requests');
  const baselineNavigations=navigations.length;
  const click=async text=>{const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text),text);assert(await h.asElement(),`button ${text}`);await h.evaluate(async n=>{n.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});const box=await h.asElement().boundingBox();assert(box);const point={x:box.x+box.width/2,y:box.y+box.height/2};assert(await h.evaluate((n,p)=>n.contains(document.elementFromPoint(p.x,p.y)),point),`click target ${text}`);await page.mouse.move(point.x,point.y);await page.mouse.click(point.x,point.y);await h.dispose();await new Promise(r=>setTimeout(r,80));};
  const fill=async(label,value)=>{const h=await page.$(`input[aria-label="${label}"]`);assert(h,label);await h.click();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await h.type(value,{delay:40});await page.waitForFunction((label,value)=>document.querySelector(`input[aria-label="${label}"]`)?.value===value,{},label,value);await h.dispose();};
  rec=dry?{chapter(){},caption:async()=>{},pause:async()=>{},stop:async()=>({chapters:[]})}:await createWorkflowGuideRecorder(page,{workflowId:workflow.id,guideId:'report',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true,ffmpegPath:process.env.FFMPEG_PATH||'ffmpeg',ffprobePath:process.env.FFPROBE_PATH||'ffprobe'});
  const hold=async(text,seconds=6)=>{console.log(JSON.stringify({guideStep:text.split('\n')[0]}));await rec.caption(text);if(!dry)await rec.pause(seconds*1000);else if(paced)await new Promise(r=>setTimeout(r,seconds*1000));};
  rec.chapter('query','연도·차수 선택 후 조회');await hold('주차별 매출이익은 화면을 열기만 해서는 조회하지 않습니다.\n연도와 차수를 확인하고 조회를 누릅니다.');await click('조회');await page.waitForSelector('[data-testid="profit-financial-basis"]');await hold('과거 차수는 저장된 원본 금액을 고정해서 보여줍니다.\n현재 원가를 과거 매출·이익에 섞지 않습니다.');
  rec.chapter('scope','조건 변경과 재조회');await new Promise(r=>setTimeout(r,400));const count=financial.length;await fill('보고서 차수','43');await page.waitForSelector('[data-testid="profit-query-empty"]');assert.equal(financial.length,count);assert(await page.$eval('[data-testid="profit-print-button"]',b=>b.disabled));await hold('차수를 바꾸면 이전 표는 사라지고 출력도 잠깁니다.\n조건 선택만으로는 다시 조회하지 않습니다.');
  await click('조회');await fill('보고서 차수','44');await click('조회');await page.waitForSelector('[data-testid="profit-financial-basis"]');await new Promise(r=>setTimeout(r,1200));assert.equal(await page.$eval('[aria-label="보고서 차수"]',n=>n.value),'44');assert((await page.$eval('[data-testid="profit-financial-basis"]',n=>n.textContent)).includes('최근'));await hold('최근 업무차수는 전체 최신 원천으로 조회합니다.\n빠르게 조건을 바꿔도 늦은 이전 응답은 현재 표를 덮지 않습니다.');
  rec.chapter('views','차수별·월별도 직접 조회');const beforeViews=financial.length;await click('차수별');await fill('시작 차수','42');await fill('마지막 차수','43');assert.equal(financial.length,beforeViews);await hold('차수별 비교도 연도와 범위를 고른 뒤 조회합니다.\n보기 탭을 바꾸거나 범위만 입력해도 자동 조회하지 않습니다.');await click('조회');await page.waitForFunction(()=>!document.querySelector('[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]').disabled);await click('월별');const beforeMonth=financial.length;await new Promise(r=>setTimeout(r,300));assert.equal(financial.length,beforeMonth);await hold('월별 화면도 조회를 눌러 불러옵니다.\n최신 차수 포함 선택은 다음 조회에 반영됩니다.');await click('조회');await page.waitForFunction(()=>document.body.textContent.includes('포함 차수'));
  rec.chapter('output','조회 범위와 출력 확인');await click('카테고리별');await fill('보고서 차수','42');await click('조회');await page.waitForSelector('[data-testid="profit-financial-basis"]');await hold('조회한 연도·차수를 확인한 뒤 엑셀·인쇄를 선택합니다.\n화면과 출력은 같은 저장·확정 또는 최신 조회 기준을 사용합니다.',8);
  await page.screenshot({path:'.verify/profit-explicit-query-ui.png'});assert.deepEqual(errors,[]);assert.equal(navigations.length,baselineNavigations,'Guide must not reload during the workflow');const result=await rec.stop();stopped=true;
  if(!dry){const guide=workflow.guides[0];guide.status='ready';guide.chapters=result.chapters;fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');}
  await runProfitAuxScopeSmoke({page,click,financial});assert.deepEqual(errors,[]);assert.equal(navigations.length,baselineNavigations,'Auxiliary regression must not reload');
  console.log(JSON.stringify({result:'PASS',dry,financialRequests:financial.length,entryFinancialRequests:0,allApisSynthetic:true,productionWrites:0}));
 }finally{if(rec&&!stopped){await page?.screenshot({path:'.verify/profit-guide-failure.png'}).catch(()=>{});if(page)console.log(JSON.stringify({failedState:await page.evaluate(()=>({title:document.querySelector('h1')?.textContent,inputs:[...document.querySelectorAll('input[aria-label]')].map(n=>({label:n.getAttribute('aria-label'),value:n.value})),output:document.querySelector('[data-testid="profit-weeks-output"]')?.textContent,alerts:[...document.querySelectorAll('[role="alert"]')].map(n=>n.textContent)})).catch(()=>null)}));await rec.stop().catch(()=>{});}await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
