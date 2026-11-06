// Actual local UI + synthetic requests. Never forward an API to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const root=process.cwd(),base=process.env.GUIDE_BASE_URL||'http://localhost:3259',dry=process.argv.includes('--dry-run');
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixture only');
async function main(){
  const {validateSalesRequest,summarizeSales}=await import('../lib/estimateShipmentDateSales.js');
  const registryPath=path.join(root,'config/workflow-guides.json'),registry=JSON.parse(fs.readFileSync(registryPath));
  const workflow=registry.workflows.find(w=>w.id==='estimate-shipment-date-sales');
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);
  await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  const errors=[],requests=[];let favorites=[],failQuery=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request',async r=>{try{
    const u=new URL(r.url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();
    let data={success:true,items:[],rows:[],data:[],products:[],weeks:[],shipments:[],groups:[],countries:[],favorites:[]};let status=200;
    if(u.pathname==='/api/auth/me')data.user={userId:'guide-support',userName:'영업지원 연습',authority:2,deptName:'영업지원'};
    if(u.pathname==='/api/customers/search')data.customers=[{CustKey:1,CustName:'연습 호텔 A'},{CustKey:2,CustName:'연습 호텔 B'}];
    if(u.pathname==='/api/favorites'){
      const body=r.postData()?JSON.parse(r.postData()):{};
      if(r.method()==='POST'){favorites.push({FavoriteKey:favorites.length+1,FavName:body.name,FilterData:body.filterData});data.favoriteKey=favorites.length;}
      if(r.method()==='PUT'){favorites=favorites.map(f=>f.FavoriteKey===body.favoriteKey?{...f,FavName:body.name,FilterData:body.filterData}:f);data.favoriteKey=body.favoriteKey;}
      if(r.method()==='DELETE')favorites=favorites.filter(f=>f.FavoriteKey!==body.favoriteKey);
      data.favorites=favorites;
    }
    if(u.pathname==='/api/estimate/shipment-date-sales'){
      requests.push(Object.fromEntries(u.searchParams));
      if(failQuery){status=500;data={success:false,error:'연습용 조회 실패입니다. 다시 조회하세요.'};}
      else {const s=validateSalesRequest(Object.fromEntries(u.searchParams)),rows=[];
        s.periods.forEach((p,i)=>{if(i===3)return;const row={Kind:'shipment',RowKey:i*10,OrderYear:'2026',OrderWeek:'44-01',ProdKey:1,ProdName:'연습 장미 레드',Unit:'단',SaleDate:p.startDate,Quantity:30,Cost:1100,Amount:30000,Vat:3000};rows.push(row,{...row,RowKey:i*10+1,OrderWeek:'44-02',Quantity:60,Amount:60000,Vat:6000},{...row,RowKey:i*10+2,ProdKey:2,ProdName:'연습 카네이션 화이트',Unit:'송이',Quantity:25,Amount:25000,Vat:2500},{...row,Kind:'adjustment',RowKey:i*10+3,Quantity:-2,Amount:-2000,Vat:-200});});
        data.periods=summarizeSales(rows,s.periods);
      }
    }
    await r.respond({status,contentType:'application/json',body:JSON.stringify(data)});
  }catch(e){errors.push(e.message);if(!r.isInterceptResolutionHandled())await r.abort();}});
  let rec,stopped=false;
  const clickText=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(n=>n.textContent.trim()===text&&!n.disabled),{},text);const handle=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text),text);const el=handle.asElement();assert(el,`button ${text}`);await el.click();await handle.dispose();};
  const hold=async(text,seconds=5)=>{await rec.caption(text);await rec.pause(dry?60:seconds*1000);};
  try{
    await page.goto(base+'/estimate?tab=shipment-date',{waitUntil:'networkidle0'});
    await page.waitForSelector('[aria-label="출고 매출 업체"]:not([disabled])');
    rec=dry?{caption:async()=>{},chapter:()=>{},pause:ms=>new Promise(r=>setTimeout(r,Math.min(ms,60))),stop:async()=>null}:await createWorkflowGuideRecorder(page,{root,workflowId:workflow.id,guideId:'sales',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true});
    await hold('견적서 관리의 출고일 기준 매출 탭입니다.\n업체별 정산 요일을 저장하고 과거 매출을 확인합니다.',6);
    rec.chapter('favorite','업체와 정산 요일 즐겨찾기');
    await page.select('[aria-label="출고 매출 업체"]','1');await page.select('[aria-label="정산 시작 요일"]','2');await page.select('[aria-label="정산 종료 요일"]','1');
    await hold('연습 호텔 A는 화요일부터 다음 주 월요일까지 정산합니다.\n업체·시작 요일·종료 요일을 선택합니다.',6);
    await clickText('즐겨찾기 저장');await page.waitForFunction(()=>document.body.textContent.includes('업체와 정산 요일을 즐겨찾기에 저장했습니다.'));
    await hold('즐겨찾기는 내 계정에 저장됩니다.\n다음에는 업체 버튼 한 번으로 같은 요일 기준을 불러옵니다.',6);
    if(dry){await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="출고 매출 업체"]:not([disabled])');}
    rec.chapter('history','업체 선택과 과거 정산 이력');
    await clickText('연습 호텔 A (화~월)');await page.waitForSelector('article');
    await hold('업체를 누르면 최근 12개 정산 기간이 나옵니다.\n입고 차수에 관계없이 지정 출고일의 확정 판매를 모읍니다.',7);
    rec.chapter('source','품목 수량과 원차수 구성');
    assert(await page.evaluate(()=>document.body.textContent.includes('90 = 30(44-1) / 60(44-2)')));
    await hold('장미 90단 = 44-1차 30단 + 44-2차 60단입니다.\n화면에는 90 = 30(44-1) / 60(44-2)처럼 표시합니다.',8);
    await page.evaluate(()=>document.querySelector('article tbody details summary').click());
    await hold('상세를 펼치면 출고일·수량·저장 단가·매출을 확인합니다.\n단·송이·박스 수량은 서로 합치지 않습니다.',7);
    await page.screenshot({path:'.verify/date-sales-desktop.png'});
    await page.$eval('button[class*="more"]',el=>el.scrollIntoView({block:'center'}));await clickText('이전 12개 정산 기간 더 보기');await page.waitForFunction(()=>document.querySelectorAll('article').length===24);
    await hold('이전 12개 정산 기간 더 보기로 과거 이력을 이어 봅니다.\n출고가 없는 기간도 빈 기간으로 표시합니다.',7);
    await page.$eval('[aria-label="출고 매출 조회 방식"]',el=>el.scrollIntoView({block:'center'}));
    rec.chapter('range','원하는 출고 기간 직접 조회');
    await page.select('[aria-label="출고 매출 조회 방식"]','range');
    for(const [label,value]of [['출고 매출 시작일','2026-11-02'],['출고 매출 종료일','2026-11-06']])await page.$eval(`[aria-label="${label}"]`,(el,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
    await clickText('조회');await page.waitForFunction(()=>document.querySelectorAll('article').length===1);
    await hold('직접 기간 선택에서는 시작일과 종료일을 모두 포함해 조회합니다.\n금액은 부가세 포함이며 견적 조정은 별도 행으로 표시합니다.',8);
    await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-ui-sidebar]').length),1);
    assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-ui-topbar]').length),1);
    assert.deepEqual(errors,[]);
    const result=await rec.stop();stopped=true;
    if(!dry){workflow.guides[0].status='ready';workflow.guides[0].chapters=result.chapters;fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');}
    // Read-only error recovery and small-screen checks after the final capture.
    failQuery=true;await clickText('조회');await page.waitForSelector('[role="alert"]');assert.equal(await page.$('article'),null);failQuery=false;
    await page.setViewport({width:390,height:844,deviceScaleFactor:1});await clickText('조회');await page.waitForSelector('article');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page must fit; table owns horizontal scroll');
    await page.screenshot({path:'.verify/date-sales-mobile.png',fullPage:true});
    assert(requests.some(r=>r.mode==='history'));assert(requests.some(r=>r.mode==='range'));assert.deepEqual(errors,[]);
    console.log('PASS actual browser: favorite/save/reload, weekday history, 24 periods, 90=30/60 provenance, details, range, error recovery, one shell, mobile fit; all API requests synthetic');
  }finally{if(rec&&!stopped)await rec.stop().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
