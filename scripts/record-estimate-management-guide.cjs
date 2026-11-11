// Local fixture only: records the actual estimate-management UI without ERP reads or writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const root=process.cwd(),base=process.env.GUIDE_BASE_URL||'http://127.0.0.1:3000',dry=process.argv.includes('--dry-run');
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixture only');
const shipment={ShipmentKey:101,ShipmentKeys:'101',CustKey:1,CustName:'연습 꽃집',Manager:'영업지원',OrderWeek:'44-01',totalAmount:330000};
const items=Array.from({length:36},(_,i)=>({SdateKey:i+1,SdetailKey:100+i,ShipmentKey:101,ProdKey:100+i,ProdName:`연습 품목 ${String(i+1).padStart(2,'0')} 긴 품목명`,Unit:i%2?'송이':'단',Quantity:i%2?60:250,Cost:1100,Amount:60000,Vat:6000,Descr:i===0?'기존 비고':'',outDate:'2026-11-10',WeekDay:2,OrderWeek:'44-01',BunchesPerBox:i%2?0:50,SteamsPerBox:i%2?30:0,EstimateType:'정상출고'}));
async function main(){
 const registryPath=path.join(root,'config/workflow-guides.json'),registry=JSON.parse(fs.readFileSync(registryPath));
 const workflow=registry.workflows.find(w=>w.id==='estimate-management');
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',async r=>{try{const u=new URL(r.url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();let data={success:true};
   if(u.pathname==='/api/auth/me')data.user={userId:'guide-sales',userName:'영업지원 연습',authority:2};
   else if(u.pathname==='/api/products/search')data.products=[];
   else if(u.pathname==='/api/estimate'){
     if(u.searchParams.get('view')==='types')data.types=[];
     else if(u.searchParams.get('view')==='mismatch')data={success:true,mismatches:[]};
     else if(u.searchParams.get('itemsOnly')==='1')data={success:true,items};
     else data={success:true,shipments:[shipment],items:[]};
   } else if(u.pathname==='/api/estimate/update-date-quantity')data={success:true,item:{...items[0],Descr:'연습용 비고'}};
   else if(u.pathname==='/api/estimate/update-entry')data={success:true};
   await r.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
 }catch(e){errors.push(e.message);if(!r.isInterceptResolutionHandled())await r.abort();}});
 let rec,stopped=false;
 try{
   await page.goto(`${base}/estimate?week=44&year=2026`,{waitUntil:'networkidle0'});
   rec=dry?{caption:async()=>{},chapter:()=>{},focus:async()=>{},unfocus:async()=>{},pause:async()=>{},stop:async()=>({chapters:[]})}:await createWorkflowGuideRecorder(page,{root,workflowId:workflow.id,guideId:'sales-support',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true});
   const queryButton=await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(n=>n.textContent.includes('조회 / Buscar')));const queryNode=await queryButton.asElement();await page.evaluate(node=>node.id='estimate-guide-query',queryNode);
   rec.chapter('quantity','수량과 박스 수량 확인');await rec.caption('1. 견적서 관리에서 차수와 업체를 확인한 뒤 조회합니다.');await rec.focus('#estimate-guide-query',1);await queryNode.click();await page.waitForFunction(()=>document.querySelectorAll('.estimate-item-table tbody tr').length>20);await rec.unfocus();
   await rec.caption('수량 오른쪽의 괄호에는 1박스 초과인 정수 박스만 표시됩니다. 소수점과 1박스 이하는 표시하지 않습니다.');await rec.pause(3500);
   rec.chapter('remark','비고를 눌러 수정하기');const remark=await page.$('[aria-label*="비고 수정"]');await remark.scrollIntoView();await rec.caption('2. 비고 칸을 누르면 바로 품목 정보 수정 창이 열립니다.');await rec.focus('[aria-label*="비고 수정"]',2);await remark.click();await page.waitForSelector('.modal');await rec.unfocus();
   const input=await page.$('textarea, input[placeholder*="비고"]');if(input){await input.click({clickCount:3});await input.type('연습용 비고');}await rec.caption('비고를 입력하고 수정 저장을 누르면 선택한 행에만 반영됩니다.');await rec.pause(3500);
   rec.chapter('print','인쇄 전 마지막 합계 확인');const close=await page.$('.modal-header button, .modal button.btn');if(close)await close.click().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,400));await page.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.textContent.includes('견적서 출력'))?.click());await new Promise(resolve=>setTimeout(resolve,500));await rec.caption('3. 인쇄에서는 품목 머리글이 다음 페이지에도 반복되고, 문서 합계는 마지막 페이지에 한 번만 표시됩니다.');await rec.pause(4000);
   assert.deepEqual(errors,[]);const result=await rec.stop();stopped=true;if(!dry){workflow.guides[0].status='ready';workflow.guides[0].chapters=result.chapters;fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');}
   console.log('PASS estimate management guide fixture: 1920x1080, remark button, long table, print dialog; ERP writes=0');
 }finally{if(rec&&!stopped)await rec.stop().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
