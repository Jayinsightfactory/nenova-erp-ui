// Real component + calculator/exporter; only synthetic source and test fees.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
(async()=>{
 const child=spawn(process.execPath,['scripts/shared-awb-ui-fixture.cjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true});let browser;
 try{
  const base=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',v=>{text+=v;const m=text.match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0]);});child.on('exit',()=>reject(Error('Fixture stopped')));setTimeout(()=>reject(Error('Fixture startup timeout')),20000).unref();});
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});await page.goto(base,{waitUntil:'networkidle0'});
  const rec=await createWorkflowGuideRecorder(page,{workflowId:'shared-awb-cost',guideId:'import',title:'공동 AWB 원가',sourceFiles:['components/import-tools/SharedAwbCostReview.js'],fixtureOnly:true});
  const step=async(s,t)=>{rec.chapter(s,t);await rec.caption(t);await rec.pause(4500);};
  await step('lookup','공동 AWB 전체 입고를 조회하고 농장 송장 목록을 확인합니다.');
  await page.click('button');await page.waitForSelector('input[type="checkbox"]');await page.click('input[type="checkbox"]');
  await step('inputs','확인한 전체 중량과 비용을 입력합니다. 혼합 품종은 원본 Full Box 합계를 사용합니다.');
  const values={'공동 GW (kg)':'100','공동 CW (kg)':'120','공동 운임·서류비 합계 (USD)':'100','환율 (원/USD)':'1400','공동 통관비 합계 (원)':'1000','장미 FB 환산 박스수':'1','카네이션 FB 환산 박스수':'1'};
  for(const [label,value] of Object.entries(values))await page.type(`input[aria-label="${label}"]`,value);
  await page.select('select[aria-label="공동 AWB 비용 근거"]','TEST_ONLY');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='공동 AWB 원가 계산').click());
  await page.waitForFunction(()=>document.body.innerText.includes('전체 2품목'));
  await step('download','계산 후 미승인 엑셀을 다운로드합니다. 시험값 표기를 확인하며 운영 원장은 변경하지 않습니다.');
  const downloadResponse=page.waitForResponse(r=>r.url().endsWith('/api/import/receipts/shared-awb-cost')&&r.request().postData()?.includes('"action":"download"'));
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('엑셀 다운로드')).click());
  assert.equal((await downloadResponse).status(),200);
  const status=await(await fetch(base+'/fixture-status')).json();assert.equal(status.download,1);assert.equal(status.productionWrites,0);assert.equal(status.providerCalls,0);
  const result=await rec.stop(),file='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(file));
  Object.assign(registry.workflows.find(w=>w.id==='shared-awb-cost').guides[0],{status:'ready',chapters:result.chapters});fs.writeFileSync(file,JSON.stringify(registry,null,2)+'\n');
  console.log(JSON.stringify({passed:true,...status}));
 }finally{await browser?.close();child.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
