// Invocation-owned loopback app/API, temporary shared-store root, synthetic users.
// Every API is handled by the fixture; ERP/provider mutations are forbidden.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),puppeteer=require('puppeteer-core'),ExcelJS=require('exceljs');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const recording=process.argv.includes('--record-guide');
const root=process.cwd(),output=path.join(root,'.verify/cloud-cost-edit-ui');fs.mkdirSync(output,{recursive:true});
const freePort=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
(async()=>{
 const appPort=await freePort(),uiPort=await freePort(),base='http://127.0.0.1:'+uiPort;
 const log=fs.openSync(path.join(output,'server.log'),'w');
 const fixture=spawn(process.execPath,['scripts/arrival-week-cost-ui-fixture.cjs'],{cwd:root,env:{...process.env,CLOUD_EDIT_FIXTURE:'1',NATIVE_FIXTURE_DEV:'1',NATIVE_APP_PORT:String(appPort),NATIVE_UI_PORT:String(uiPort),DB_SERVER:'',DB_USER:'',DB_PASSWORD:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 let browser,rec,pageForGuide;
 const step=async(id,n,text,selector)=>{if(!rec)return;await pageForGuide.$eval(selector,n=>n.scrollIntoView({block:'center',behavior:'instant'}));rec.chapter(id,`${n}. ${text}`);await rec.caption(`${n}. ${text}`);await rec.pause(1400);await rec.focus(selector,n);await rec.pause(1400);};
 const end=async()=>{if(rec){await rec.pause(1400);await rec.unfocus();}};
 try{
  for(let n=0;n<120;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===119)throw Error('Isolated app unavailable');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const context=browser.defaultBrowserContext(),page=await context.newPage();pageForGuide=page;page.setDefaultTimeout(20000);await page.setViewport({width:1920,height:1080});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());return /^https?:$/.test(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)?r.abort():r.continue();});
  const fill=async(p,selector,value)=>{try{await p.waitForSelector(selector);}catch(e){console.error('UI STATE '+p.url()+' '+(await p.$eval('body',n=>n.innerText)).slice(0,1600));console.error('PAGE ERRORS '+JSON.stringify(errors));throw e;}await p.click(selector,{clickCount:3});await p.keyboard.down('Control');await p.keyboard.press('a');await p.keyboard.up('Control');await p.keyboard.type(String(value));};
  const aria=label=>'::-p-aria('+label+')';
  async function openScope(p){
   const navigation=await p.goto(base+'/arrival-cost?popup=1',{waitUntil:'networkidle0'});console.log('UI navigation '+navigation.status()+' '+p.url());
   if(p===page&&recording&&!rec)rec=await createWorkflowGuideRecorder(page,{workflowId:'arrival-week-cost',guideId:'import',title:'차수 조회·인라인 매칭·공유 저장·통합 원가',sourceFiles:["pages/arrival-cost.js", "components/import-tools/InvoiceWarehouseCostBrowse.js", "components/import-tools/ArrivalWeekCostReview.js", "components/import-tools/CloudCostCategories.js", "styles/ArrivalWeekCost.module.css", "styles/CloudCostCategories.module.css", "lib/arrivalWeekCost.js", "lib/arrivalWeekCostHttp.js", "lib/arrivalWeekCostWorkbook.js"],fixtureOnly:true,encodingPreset:'veryfast'});
   if(p===page)await step('lookup',1,'도착원가에서 연도·차수만으로 입고를 조회합니다.','input[placeholder="비우면 전 차수"]');
   await fill(p,'input[placeholder="비우면 전 차수"]','46-01');await p.click(aria('조회'));
   await p.waitForSelector('input[aria-label="입고 99001 원가 선택"]');
   if(p===page){await end();await step('selection',2,'여러 입고를 체크한 뒤 다음을 누릅니다. 한 건을 눌러도 화면은 넘어가지 않습니다.','input[aria-label="입고 99001 원가 선택"]');}
   await p.click('input[aria-label="입고 99001 원가 선택"]');
   assert.equal(await p.$('[aria-label="기존 입고자료 원가 계산"]'),null,'one checkbox does not navigate');
   await p.click('input[aria-label="입고 99002 원가 선택"]');
   assert.equal(await p.$$eval('input[aria-label$="원가 선택"]:checked',n=>n.length),2);
   await p.click(aria('선택 2건 다음 · 도착원가 작성'));
   await p.waitForFunction(()=>document.querySelectorAll('[aria-label="CLOUD 품종 카테고리"] tbody tr').length===2);
   await p.waitForFunction(()=>document.querySelector('[aria-label="CLOUD 품종 카테고리"]')?.innerText.includes('공유 매칭 조회 완료'));
  }
  await openScope(page);await end();await step('inputs',3,'원문·전산 품목·카테고리를 같은 행에서 확인하고 직접 수정합니다. 입력과 공유 저장 결과는 유지됩니다.','[aria-label="CLOUD 품종 카테고리"]');console.log('PASS scope lookup + two checks + explicit next');
  const category='select[aria-label="입고 99001 1행 CLOUD 카테고리"]';
  await page.select(category,'DIRECT');
  await fill(page,'input[aria-label="입고 99001 1행 직접 카테고리명"]','TEST_ONLY 직접 장미');
  await fill(page,'input[aria-label="입고 99001 1행 length"]','12.');
  await fill(page,'input[aria-label="입고 99001 1행 tariffRate"]','0.032');
  await fill(page,'input[aria-label="78469519261 환율 원/CNY"]','211');
  assert.equal(await page.$eval('input[aria-label="입고 99001 1행 length"]',n=>n.value),'12.');
  assert.equal(await page.$eval('input[aria-label="입고 99001 1행 직접 카테고리명"]',n=>n.value),'TEST_ONLY 직접 장미');
  assert.equal(await page.$$eval('[aria-label="CLOUD 품종 카테고리"] tbody tr',n=>n.length),2,'matched rows stay visible');
  await page.click(aria('변경 1행 공유 저장'));await page.waitForFunction(()=>document.querySelector('[aria-label="CLOUD 품종 카테고리"]')?.innerText.includes('공유 저장 완료'));
  await page.$eval('[aria-label="CLOUD 품종 카테고리"]',n=>n.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(output,'inline-rows.png'),fullPage:false});
  await page.focus('input[aria-label="입고 99001 1행 직접 카테고리명"]');await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'입고 99001 1행 직접 카테고리명');
  console.log('PASS inline original/ERP/manual category retained while parent input changes + shared save; keyboard Tab/ShiftTab');
  // Another authenticated fixture user/session reads the same durable store.
  const second=await browser.createBrowserContext(),other=await second.newPage();other.setDefaultTimeout(20000);await other.setViewport({width:1920,height:1080});
  await other.setCookie({name:'fixtureUser',value:'second',url:base});await openScope(other);
  assert.equal(await other.$eval('input[aria-label="입고 99001 1행 직접 카테고리명"]',n=>n.value),'TEST_ONLY 직접 장미');
  await fill(other,'input[aria-label="입고 99001 1행 width"]','39');await other.click(aria('변경 1행 공유 저장'));
  await other.waitForFunction(()=>document.querySelector('[aria-label="CLOUD 품종 카테고리"]')?.innerText.includes('공유 저장 완료'));
  await page.click(aria('공유 매칭 다시 불러오기 · 현재 입력 유지'));
  await page.waitForFunction(()=>document.querySelector('input[aria-label="입고 99001 1행 width"]')?.value==='39');
  await fill(page,'input[aria-label="입고 99001 1행 직접 카테고리명"]','TEST_ONLY 편집 유지');
  await page.click(aria('공유 매칭 다시 불러오기 · 현재 입력 유지'));
  await page.waitForFunction(()=>document.querySelector('[aria-label="CLOUD 품종 카테고리"]')?.innerText.includes('공유 매칭 조회 완료'));
  assert.equal(await page.$eval('input[aria-label="입고 99001 1행 직접 카테고리명"]',n=>n.value),'TEST_ONLY 편집 유지');
  console.log('PASS second user applied persisted settings; refresh never replaces edited row');await end();await step('expenses',4,'근거 있는 중량과 환율을 확인하고 비용 증빙별 적용 대상을 지정합니다. 확인하지 않은 비용은 확정하지 않습니다.','[aria-label="78469519261 환율 원/CNY"]');
  for(const awb of ['78469519261','78469519262']){
   await fill(page,aria(awb+' 환율 원/CNY'),'210');await fill(page,aria(awb+' 환율 근거'),'TEST_ONLY 검증용 시나리오');await fill(page,aria(awb+' 이 AWB 호접 허가증 CNY (해당 없음은 확인 후 0)'),'0');
  }
  const pools=[['FREIGHT','TEST_ONLY-A','100',['78469519261']],['FREIGHT','TEST_ONLY-B','200',['78469519262']],['CUSTOMS','TEST_ONLY-shared','1000',['78469519261','78469519262']]];
  for(let i=0;i<pools.length;i++){
   await page.click(aria('비용 증빙 추가'));const [kind,id,amount,targets]=pools[i],n=i+1;
   await page.select('select[aria-label="비용 '+n+' 종류"]',kind);await fill(page,'input[aria-label="비용 '+n+' 증빙 식별자"]',id);await fill(page,'input[aria-label="비용 '+n+' 합계"]',amount);
   for(const awb of targets)await page.click('input[aria-label="비용 '+n+' 대상 '+awb+'"]');await page.click('input[aria-label="비용 '+n+' 귀속 확인"]');
  }
  await end();await step('preview',5,'선택한 입고와 비용의 귀속을 확인한 뒤 계산을 검증합니다.','input[aria-label="통합 계산 기준 확인"]');await page.click('input[aria-label="통합 계산 기준 확인"]');await page.click('[data-week-cost-preview]');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="status"]')).some(n=>n.textContent.includes('검증 통과 · 2입고')));
  const downloadPath=path.join(output,'downloads');fs.mkdirSync(downloadPath,{recursive:true});
  const client=await page.target().createCDPSession();await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath});
  await end();await step('download',6,'한 시트의 원가 파일을 내려받습니다. 원문·매칭·카테고리와 계산 단위 근거가 함께 남습니다.','[data-week-cost-download]');await page.click('[data-week-cost-download]');
  let file;for(let n=0;n<100;n++){file=fs.readdirSync(downloadPath).find(f=>f.endsWith('.xlsx'));if(file)break;await new Promise(r=>setTimeout(r,100));}assert(file,'browser XLSX download');
  const bytes=fs.readFileSync(path.join(downloadPath,file)),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);assert.equal(book.worksheets.length,1);assert.equal(book.worksheets[0].getCell('I8').value,20);assert.equal(book.worksheets[0].getCell('I9').value,20);
  const text=book.worksheets[0].getSheetValues().flat().filter(v=>typeof v==='string').join('\n');assert(text.includes('TEST_ONLY 편집 유지'));
  await page.screenshot({path:path.join(output,'inline-desktop.png'),fullPage:false});
  await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(output,'inline-mobile.png'),fullPage:false});
  await end();if(rec){const result=await rec.stop();rec=null;const f='config/workflow-guides.json',d=JSON.parse(fs.readFileSync(f));d.workflows.find(w=>w.id==='arrival-week-cost').guides[0].chapters=result.chapters;fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n');}
  assert.deepEqual(errors,[]);const counts=await(await fetch(base+'/fixture-status')).json();assert.equal(counts.blockedWrites,0);assert.equal(counts.download,1);assert.equal(counts.mappingSaves,2);
  console.log(JSON.stringify({result:'PASS',twoUsers:true,selectionRetained:true,rowsStayVisible:true,manualInputRetained:true,downloadBytes:bytes.length,sheets:book.worksheets.length,counts,productionWrites:0,providerCalls:0}));
 }finally{await browser?.close();fixture.kill();}
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
