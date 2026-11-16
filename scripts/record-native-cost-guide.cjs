// Actual app UI + production read-only calculator; only synthetic receipt rows.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run');
(async()=>{
 fs.mkdirSync('.verify',{recursive:true});
 const source=path.resolve('.verify/native-guide-source.json');
 fs.writeFileSync(source,JSON.stringify([{WarehouseKey:99001,OrderYear:'2026',OrderWeek:'46-01',FarmName:'연습 농장',InvoiceNo:'DEMO-4601',InputDate:'2026-11-09',GrossWeight:164,ChargeableWeight:351,WdetailKey:99002,ProdKey:99003,ProdName:'ORCHID VIETNAM / 호접란  화이트 8 (Party grade White 8) ',CounName:'베트남',FlowerName:'호접난 Orchid',OutUnit:'송이',BoxQuantity:10,BunchQuantity:0,SteamQuantity:160,OutQuantity:160,UPrice:6,TPrice:960,SteamOf1Bunch:0,SteamOf1Box:16,ProductDeleted:false}]));
 const child=spawn(process.execPath,['scripts/native-cost-ui-fixture.cjs'],{env:{...process.env,NATIVE_COST_FIXTURE:source,NATIVE_FIXTURE_DEV:'1',NATIVE_APP_PORT:'19450',NATIVE_UI_PORT:'19451'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let browser,rec;
 try{
  const base=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',v=>{out+=v;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});child.on('exit',()=>reject(Error('Fixture stopped')));setTimeout(()=>reject(Error('Fixture startup timeout')),30000).unref();});
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  const downloadDir=path.resolve('.verify/native-guide-downloads',String(Date.now()));fs.mkdirSync(downloadDir,{recursive:true});
  const client=await page.createCDPSession();await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(let i=0;i<30;i++){const response=await page.goto(base+'/import/tools?popup=1',{waitUntil:'domcontentloaded',timeout:120000});if(response.status()===200)break;await new Promise(r=>setTimeout(r,2000));}
  await page.waitForFunction(()=>document.body.innerText.includes('도착원가 작업'),{timeout:120000});
  const button=async text=>{const h=await page.evaluateHandle(t=>{const a=[...document.querySelectorAll('button')];return a.find(b=>b.textContent.trim()===t)||a.find(b=>b.textContent.trim().startsWith(t));},text);assert(await h.asElement(),text);await h.click();await h.dispose();};
  await button('도착원가 작업');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='입고내역 조회 · 원가 계산'),{timeout:30000});
  await page.waitForSelector('input[value="2026"]');
  const week=await page.$('input[value="46-01"]');
  if(!week){const inputs=await page.$$('input');for(const el of inputs)if(await el.evaluate(n=>/^\d{2}-\d{2}$/.test(n.value))){await el.click({clickCount:3});await el.type('46-01');break;}}
  await button('입고내역 조회 · 원가 계산');
  await page.waitForFunction(()=>document.body.innerText.includes('연습 농장'),{timeout:30000});
  await button('도착원가 엑셀 생성·다운로드');
  await page.waitForFunction(()=>{const b=document.querySelector('[data-cost-download]');return b&&!b.disabled;},{timeout:60000});
  assert.equal(await page.$('input[data-cost-confirm]'),null,'read-only calculation must not require consent checkbox');
  // Leave scroll room below the real last button so zoom and subtitles never cover it.
  if(!dry)await page.addStyleTag({content:'body { padding-bottom: 360px !important; }'});
  if(!dry)rec=await createWorkflowGuideRecorder(page,{workflowId:'invoice-cost-readonly',guideId:'import',title:'기존 입고 도착원가 다운로드',sourceFiles:['components/import-tools/NativeReceiptCost.js','components/import-tools/InvoiceReceiptCostReview.js'],fixtureOnly:true});
  const step=async(id,text,selector,n)=>{if(!rec)return;await page.$eval(selector,el=>el.scrollIntoView({block:'center',behavior:'instant'}));rec.chapter(id,`${n}. ${text}`);await rec.caption(`${n}. ${text}`);await rec.pause(1600);await rec.focus(selector,n);await rec.pause(2500);};
  await step('lookup','기존 입고의 자동 통화·중량·참고 세율을 확인합니다. 인보이스 재업로드와 매칭은 반복하지 않습니다.','[aria-label="기존 입고자료 원가 계산"] header',1);
  if(rec)await rec.unfocus();
  const fx='[aria-label="인보이스 도착원가 검토"] input';
  await page.evaluate(()=>{const labels=[...document.querySelectorAll('label')];const l=labels.find(n=>n.textContent.includes('환율 (원/통화)'));if(l)l.querySelector('input').setAttribute('data-guide-fx','true');});
  await step('inputs','자동 환율을 확인하고 필요할 때만 수정합니다. 수정 후 별도 체크나 미리보기 없이 다시 검증됩니다.','[data-guide-fx]',2);
  await page.focus('[data-guide-fx]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type('[data-guide-fx]','1400');
  assert.equal(await page.$eval('[data-guide-fx]',el=>el.value),'1400');
  await page.waitForFunction(()=>!document.querySelector('[data-cost-download]').disabled);
  if(rec){await rec.pause(2500);await rec.unfocus();}
  await step('download','다운로드를 누르면 서버가 현재 입고·금액·수량을 다시 검증하고 엑셀을 만듭니다. 운영 원장은 저장하지 않습니다.','[data-cost-download]',3);
  const response=page.waitForResponse(r=>r.url().includes('/api/import/receipts/native-cost')&&r.request().postData()?.includes('"action":"download"'));
  await page.click('[data-cost-download]');const fileResponse=await response;assert.equal(fileResponse.status(),200);
  const file=path.join(downloadDir,'도착원가_계산본_2026_46-01_99001.xlsx');
  for(let i=0;i<100&&(!fs.existsSync(file)||fs.statSync(file).size<1000);i++)await new Promise(r=>setTimeout(r,200));
  assert(fs.existsSync(file),'Browser download file is missing');const bytes=fs.readFileSync(file);assert(bytes.length>1000);
  fs.writeFileSync('.verify/native-guide-download.xlsx',bytes);
  await page.waitForFunction(()=>document.body.innerText.includes('다운로드를 시작했습니다'));
  if(rec){await rec.pause(3000);await rec.unfocus();const result=await rec.stop();const p='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(p));Object.assign(registry.workflows.find(w=>w.id==='invoice-cost-readonly').guides[0],{status:'ready',chapters:result.chapters});fs.writeFileSync(p,JSON.stringify(registry,null,2)+'\n');}
  const status=await(await fetch(base+'/fixture-status')).json();assert.equal(status.download,1);assert.equal(status.blockedWrites,0);assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({passed:true,dry,bytes:bytes.length,...status}));
 }finally{if(browser){const pages=await browser.pages();await pages.at(-1)?.screenshot({path:'.verify/native-guide-last.png',fullPage:false}).catch(()=>{});}await browser?.close();child.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
