// Isolated development fixture only. All source rows are synthetic; no MSSQL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run'),country=process.argv.includes('--co')?'CO':'CN';
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});let page,rec;
 try{
  page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  const directory=path.resolve('.verify/week-ui-downloads',`${country}-${Date.now()}`);fs.mkdirSync(directory,{recursive:true});const client=await page.createCDPSession();await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:directory});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:19487/import/tools?popup=1',{waitUntil:'networkidle0',timeout:120000});
  const button=async text=>{const handle=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t||b.textContent.trim().startsWith(t)),text);assert(await handle.asElement(),text);await handle.click();await handle.dispose();};
  const fill=async(label,value)=>{const selector=`[aria-label=${JSON.stringify(label)}]`;await page.waitForSelector(selector);await page.$eval(selector,n=>n.select());await page.type(selector,String(value),{delay:25});};
  const check=async(label)=>page.click(`[aria-label=${JSON.stringify(label)}]`);
  await button('도착원가 작업');await fill('저장 연도','2026');await fill('저장 세부차수','46-01');await button('입고내역 조회 · 원가 계산');await page.waitForSelector('[aria-label="차수 통합 도착원가"]');
  if(country==='CO')await page.select('[aria-label="통합 대상 국가"]','CO');
  if(!dry)rec=await createWorkflowGuideRecorder(page,{workflowId:'arrival-week-cost',guideId:'import',title:'차수 통합 원가 · 중국 A/B·콜롬비아',sourceFiles:['components/import-tools/ArrivalWeekCostReview.js','styles/ArrivalWeekCost.module.css','lib/arrivalWeekCost.js','lib/arrivalWeekCostHttp.js','lib/arrivalWeekCostWorkbook.js'],fixtureOnly:true,encodingPreset:'fast'});
  const step=async(id,n,text,selector)=>{await page.$eval(selector,n=>n.scrollIntoView({block:'center',behavior:'instant'}));if(rec){rec.chapter(id,`${n}. ${text}`);await rec.caption(`${n}. ${text}`);await rec.pause(1700);await rec.focus(selector,n);await rec.pause(1500);}};
  const end=async()=>{if(rec){await rec.pause(1600);await rec.unfocus();}};
  await step('lookup',1,'연도·차수와 국가를 확인하고 현재 입고를 조회합니다. 원장은 바꾸지 않습니다.','[data-week-cost-lookup]');await page.click('[data-week-cost-lookup]');await page.waitForFunction(()=>document.querySelector('[aria-label="차수 통합 도착원가"]').innerText.includes('후보'));await end();
  await step('selection',2,'원본·송장·AWB로 포함할 입고를 선택합니다. 나중 파일을 올렸으면 다시 조회해 함께 선택합니다.','[data-week-cost-apply]');await button('현재 국가·차수 후보 전체 선택');await page.click('[data-week-cost-apply]');await page.waitForFunction(()=>document.querySelector('[aria-label="차수 통합 도착원가"]').innerText.includes('적용 입고'));await end();
  const awbs=country==='CN'?['78469519261','78469519262']:['01441369974'];
  await step('inputs',3,'AWB 전체 중량·환율 근거를 확인합니다. 검증용 환율은 당시 확정환율과 구분합니다. 혼합 품종은 원본 FB를 씁니다.',`[aria-label="${awbs[0]} GW kg"]`);
  for(const awb of awbs){await fill(`${awb} GW kg`,100);await fill(`${awb} CW kg`,120);await fill(`${awb} 환율 원/${country==='CN'?'CNY':'USD'}`,country==='CN'?210:1400);if(country==='CN')await fill(`${awb} 이 AWB 호접 허가증 CNY (해당 없음은 확인 후 0)`,0);await fill(`${awb} 환율 근거`,'TEST_ONLY 연습 검증값');await page.select(`[aria-label="${awb} 환율 종류"]`,'VALIDATION_ONLY');if(country==='CO')for(const group of ['ROSE','CARNATION','HYDRANGEA'])await fill(`${awb} ${group} FB`,1);}
  await end();
  await step('expenses',4,'각 운임과 공유 통관비에 증빙 식별자·대상 AWB를 지정합니다. 같은 증빙만 한 번, 별도 청구는 각각 반영합니다.','[aria-label="차수 통합 도착원가"] h4');
  const pools=awbs.map((awb,i)=>({kind:'FREIGHT',id:`TEST_ONLY-운임-${i+1}`,amount:100+i*100,targets:[awb]})).concat({kind:'CUSTOMS',id:'TEST_ONLY-공유통관',amount:1000,targets:awbs});
  for(let i=0;i<pools.length;i++){const p=pools[i],n=i+1;await button('비용 증빙 추가');await page.select(`[aria-label="비용 ${n} 종류"]`,p.kind);await fill(`비용 ${n} 증빙 식별자`,p.id);await fill(`비용 ${n} 합계`,p.amount);for(const awb of p.targets)await check(`비용 ${n} 대상 ${awb}`);await check(`비용 ${n} 귀속 확인`);}
  await end();
  await step('preview',5,'선택 입고·비용 귀속을 확인한 뒤 계산을 검증합니다. 빠진 비용과 중복·동시 추가는 다운로드 전에 막힙니다.','[data-week-cost-confirm]');await page.click('[data-week-cost-confirm]');await page.click('[data-week-cost-preview]');await page.waitForFunction(()=>document.querySelector('[aria-label="차수 통합 도착원가"]').innerText.includes('검증 통과'));await end();
  await page.waitForFunction(()=>!document.querySelector('[data-week-cost-download]').disabled);
  await step('download',6,'한 원가 시트로 내려받습니다. 원본 입고·송장·AWB와 비용 근거, 검증용 환율 표시를 함께 보존합니다.','[data-week-cost-download]');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/import/receipts/week-cost')&&r.request().postData()?.includes('"action":"download"'));await page.click('[data-week-cost-download]');assert.equal((await response).status(),200);
  const filename=path.join(directory,`도착원가_통합_${country}_2026_46-01.xlsx`);for(let i=0;i<60&&!fs.existsSync(filename);i++)await new Promise(r=>setTimeout(r,150));assert(fs.existsSync(filename));
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.readFile(filename);assert.equal(book.worksheets.length,1);assert(Math.abs(book.worksheets[0].getCell('B3').value.result-(country==='CN'?89821.6:561000))<.001);assert.match(book.worksheets[0].getCell('A6').value,/검증용 환율/);
  await page.screenshot({path:`.verify/week-ui-${country}.png`,fullPage:false});await end();
  if(rec){const recording=await rec.stop(),file='config/workflow-guides.json',d=JSON.parse(fs.readFileSync(file));Object.assign(d.workflows.find(w=>w.id==='arrival-week-cost').guides[0],{status:'ready',chapters:recording.chapters});fs.writeFileSync(file,JSON.stringify(d,null,2)+'\n');}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,country,dry,sheets:1,rows:country==='CN'?2:3,total:book.worksheets[0].getCell('B3').value.result,path:filename}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
