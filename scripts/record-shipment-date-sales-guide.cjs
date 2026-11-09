// Actual local UI + synthetic requests. Never forward an API to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const root=process.cwd(),base=process.env.GUIDE_BASE_URL||'http://localhost:3279',dry=process.argv.includes('--dry-run');
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixture only');
async function main(){
  const {validateSalesRequest,summarizeSales}=await import('../lib/estimateShipmentDateSales.js');
  const {rangeWeeks}=await import('../lib/estimateShipmentDateMatrix.js');
  const registryPath=path.join(root,'config/workflow-guides.json'),registry=JSON.parse(fs.readFileSync(registryPath));
  const workflow=registry.workflows.find(w=>w.id==='estimate-shipment-date-sales');
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(120000);
  await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  const errors=[],requests=[];let favorites=[],failQuery=false,priceVersion=0;
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
        (s.periods.length===1?rangeWeeks(s.startDate,s.endDate):s.periods).forEach((p,i)=>{if(i===3)return;const row={Kind:'shipment',RowKey:i*100,OrderYear:'2026',OrderWeek:'44-01',ProdKey:1,ProdName:'연습 장미 레드',Unit:'단',SaleDate:p.startDate,Quantity:30,Cost:1100+priceVersion*2200,Amount:(1100+priceVersion*2200)*30/1.1,Vat:(1100+priceVersion*2200)*30/11};rows.push(row,{...row,RowKey:i*100+1,OrderWeek:'44-02',SaleDate:new Date(Date.parse(p.startDate+'T00:00:00Z')+Math.min(1,(Date.parse(p.endDate)-Date.parse(p.startDate))/86400000)*86400000).toISOString().slice(0,10),Quantity:60,Cost:2200+priceVersion*2200,Amount:(2200+priceVersion*2200)*60/1.1,Vat:(2200+priceVersion*2200)*60/11},{...row,RowKey:i*100+2,ProdKey:2,ProdName:'연습 카네이션 화이트',Unit:'송이',Quantity:25,Amount:25000,Vat:2500},{...row,Kind:'adjustment',RowKey:i*100+3,Quantity:-2,Amount:-2000,Vat:-200});for(let n=3;n<=20;n++)rows.push({...row,RowKey:i*100+n+5,ProdKey:n,ProdName:`연습 품목 ${String(n).padStart(2,'0')}`,Quantity:n,Amount:n*1000,Vat:n*100});});
        data.periods=summarizeSales(rows,s.periods);
      }
    }
    await r.respond({status,contentType:'application/json',body:JSON.stringify(data)});
  }catch(e){errors.push(e.message);if(!r.isInterceptResolutionHandled())await r.abort();}});

  let rec,stopped=false;
  const clickText=async text=>{await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(n=>n.textContent.trim()===text&&!n.disabled),{},text);const handle=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text),text);await handle.asElement().click();await handle.dispose();};
  const hold=async(text,seconds=5)=>{await rec.caption(text);await rec.pause(dry?100:seconds*1000);};
  const dateInput=async(label,value)=>page.$eval(`[aria-label="${label}"]`,(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
  try{
    await page.goto(base+'/estimate?tab=shipment-date',{waitUntil:'networkidle0'});
    await page.waitForSelector('[role="combobox"]:not([disabled])');
    rec=dry?{caption:async()=>{},chapter:()=>{},pause:ms=>new Promise(r=>setTimeout(r,Math.min(ms,100))),stop:async()=>null}:await createWorkflowGuideRecorder(page,{root,workflowId:workflow.id,guideId:'sales',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true});
    rec.chapter('favorite','업체 자동완성으로 선택하기');
    await page.focus('[role="combobox"]');await page.type('[role="combobox"]','호텔');await page.waitForSelector('[role="listbox"]');
    assert.equal(await page.$$eval('[role="option"]',n=>n.length),2);
    await hold('업체명을 입력하면 바로 아래에 검색 후보가 뜹니다.\n방향키로 이동하고 Enter로 선택할 수 있습니다.',6);
    await page.keyboard.press('Enter');assert.equal(await page.$eval('[role="combobox"]',n=>n.value),'연습 호텔 A');
    await page.select('[aria-label="정산 시작 요일"]','2');await page.select('[aria-label="정산 종료 요일"]','1');
    await clickText('즐겨찾기 저장');await page.waitForFunction(()=>document.body.textContent.includes('업체와 정산 요일을 즐겨찾기에 저장했습니다.'));
    await clickText('연습 호텔 A (화~월)');await page.waitForFunction(()=>document.querySelectorAll('th[scope="colgroup"]').length===2);
    await hold('이제 즐겨찾기 업체를 누르면 바로 조회합니다.\n저장한 정산 요일의 최근 두 기간과 공급가·VAT·합계가 보입니다.',7);
    rec.chapter('range','원하는 기간과 매출 확인');
    await page.select('[aria-label="출고 매출 조회 방식"]','range');
    await dateInput('출고 매출 시작일','2026-11-02');await dateInput('출고 매출 종료일','2026-11-15');
    await clickText('기간 달력');await page.waitForSelector('[aria-label="출고일 기간 달력"]');
    await page.click('button[data-date="2026-11-02"]');
    await hold('달력에서 시작일을 먼저 누른 뒤 종료일을 선택합니다.\n이번 예시는 11월 2일부터 15일까지 2주입니다.',6);
    await page.click('button[data-date="2026-11-15"]');
    assert.equal(await page.$('[aria-label="출고일 기간 달력"]'),null);
    if(dry){await clickText('기간 달력');await page.focus('button[data-date="2026-11-02"]');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.date),'2026-11-03');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'기간 달력');}
    await clickText('조회');await page.waitForSelector('table tbody tr');
    assert.equal(await page.$$eval('th[scope="colgroup"]',n=>n.length),2);
    assert.equal(await page.$$eval('tbody tr',n=>n.length),21);
    await hold('품목은 행, 날짜와 요일은 열로 표시됩니다.\n선택 범위를 7일씩 나눠 주차별로 나란히 비교합니다.',7);
    rec.chapter('source','일별 수량·원차수·매출 합계');
    assert(await page.evaluate(()=>document.body.textContent.includes('90 = 30(44-1) / 60(44-2)')));
    const rowHeight=await page.$eval('tbody tr',n=>n.getBoundingClientRect().height);assert(rowHeight<=38,'compact data row');
    await hold('품목명 옆에 저장 판매단가가 바로 보입니다.\n단가가 여러 개면 각각의 단가와 수량을 나눠 표시합니다.',7);
    assert(await page.$eval('[aria-label="연습 장미 레드 출고 저장 판매단가"]',n=>n.textContent.includes('1,100원')&&n.textContent.includes('2,200원')));
    await page.screenshot({path:'.verify/date-sales-quick-desktop.png'});
    await page.$eval('tfoot',n=>n.scrollIntoView({block:'center'}));
    await hold('표 아래에는 날짜별 매출과 주차별 총매출이 나옵니다.\n금액은 부가세 포함, 단·송이·박스 수량은 따로 표시합니다.',7);
    await page.$eval('button[aria-label*="연습 장미 레드"][aria-label*="상세"]',n=>n.click());await page.waitForSelector('[aria-label="출고일 단가 상세"]');
    await page.$eval('[aria-label="출고일 단가 상세"]',n=>n.scrollIntoView({block:'center'}));
    await hold('수량을 누르면 날짜별 단가와 매출 상세를 확인합니다.\n이 화면은 원장을 변경하지 않는 조회 전용입니다.',6);
    await clickText('상세 닫기');
    rec.chapter('history','즐겨찾기와 이전 정산 이력');
    await page.$eval('[aria-label="업체별 정산 즐겨찾기"]',n=>n.scrollIntoView({block:'center'}));await clickText('연습 호텔 A (화~월)');
    await page.waitForFunction(()=>document.querySelectorAll('th[scope="colgroup"]').length===2);
    const currentHeader=await page.$eval('th[scope="colgroup"]',n=>n.textContent);
    await clickText('이전 2기간');assert.notEqual(await page.$eval('th[scope="colgroup"]',n=>n.textContent),currentHeader);
    await hold('이전 2기간으로 과거 매출을 바로 비교합니다.\n다음 2기간은 최근 방향으로 이동하며, 전체 이력도 볼 수 있습니다.',7);
    await clickText('다음 2기간');assert.equal(await page.$eval('th[scope="colgroup"]',n=>n.textContent),currentHeader);
    await clickText('전체 이력 보기');await page.waitForFunction(()=>document.querySelectorAll('th[scope="colgroup"]').length===12);
    await clickText('이전 12개 정산 기간 더 보기');await page.waitForFunction(()=>document.querySelectorAll('th[scope="colgroup"]').length===24);
    await clickText('최근 2기간 보기');await page.waitForFunction(()=>document.querySelectorAll('th[scope="colgroup"]').length===2);
    assert.deepEqual(errors,[]);
    const result=await rec.stop();stopped=true;
    if(!dry){workflow.guides[0].status='ready';workflow.guides[0].chapters=result.chapters;fs.writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');}
    // Additional non-recorded checks: latest stored price on favorite click, no extra Query action.
    if(dry){priceVersion=1;const before=requests.length;await clickText('연습 호텔 A (화~월)');await page.waitForFunction(()=>document.querySelector('[aria-label="연습 장미 레드 출고 저장 판매단가"]')?.textContent.includes('3,300원'));assert(requests.length>before);assert.equal(await page.$$eval('th[scope="colgroup"]',n=>n.length),2);}
    if(dry){
      for(let i=0;i<5;i++){const h=await page.$eval('th[scope="colgroup"]',n=>n.textContent);await clickText('이전 2기간');await page.waitForFunction(h=>document.querySelector('th[scope="colgroup"]')?.textContent!==h,{},h);}
      const h=await page.$eval('th[scope="colgroup"]',n=>n.textContent);failQuery=true;await clickText('이전 2기간');await page.waitForSelector('[role="alert"]');assert.equal(await page.$eval('th[scope="colgroup"]',n=>n.textContent),h);failQuery=false;
      await clickText('이전 2기간');await page.waitForFunction(h=>document.querySelector('th[scope="colgroup"]')?.textContent!==h,{},h);assert.equal(await page.$$eval('th[scope="colgroup"]',n=>n.length),2);
    }
    // Company edit/error/calendar/mobile checks.
    await page.focus('[role="combobox"]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.type('[role="combobox"]','없는업체');
    assert.equal(await page.$$eval('[role="option"]',n=>n.length),0);assert(await page.$eval('button[type="submit"]',n=>n.disabled));
    await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.type('[role="combobox"]','호텔');await page.keyboard.press('Enter');
    await page.select('[aria-label="출고 매출 조회 방식"]','range');await dateInput('출고 매출 시작일','2026-11-02');await dateInput('출고 매출 종료일','2026-11-15');
    failQuery=true;await clickText('조회');await page.waitForSelector('[role="alert"]');assert.equal(await page.$('table'),null);failQuery=false;await clickText('조회');await page.waitForSelector('tbody tr');
    await page.setViewport({width:390,height:844,deviceScaleFactor:1});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.$eval('[aria-label="주차별 품목 수량 및 매출표"]',n=>{n.scrollIntoView({block:'center'});n.scrollLeft=800;});
    await page.screenshot({path:'.verify/date-sales-quick-mobile.png'});
    await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
    await page.focus('[role="combobox"]');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'정산 시작 요일');
    await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'combobox');
    if(dry&&workflow.guides[0].status==='ready'){
      await page.$eval('section[aria-label="출고일 기준 매출"] > div summary',n=>{n.scrollIntoView({block:'center'});n.click();});
      await page.waitForSelector('video');await page.$eval('video',v=>{v.muted=true;v.load();});await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
      await page.$eval('video',v=>v.play());await page.waitForFunction(()=>document.querySelector('video')?.currentTime>.1);
      assert(await page.$eval('video',v=>v.videoWidth===1920&&v.videoHeight===1080));
      await page.click('nav[aria-label="영업지원 영상 목차"] button:nth-child(3)');assert(await page.$eval('video',v=>v.currentTime>10));
      await page.$eval('video',v=>{v.pause();v.textTracks[0].mode='showing';});await page.waitForFunction(()=>document.querySelector('video')?.textTracks[0]?.cues?.length>0);
      assert.equal(await page.$$eval('a[download]',n=>n.filter(a=>a.href.includes('/guides/estimate-shipment-date-sales/')).length),2);
      await page.goto(base+'/estimate?tab=shipment-date&popup=1',{waitUntil:'networkidle0'});assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),0);assert.equal(await page.$$eval('[data-ui-popupbar]',n=>n.length),1);
      console.log('PASS revised guide player: 1920x1080 play, chapters, Korean captions, downloads and popup shell');
    }
    assert.deepEqual(errors,[]);console.log('PASS favorite quick UI: one-click latest two, stored price refresh/multiple buckets, supply/VAT summary, previous/next/all24, matrix/calendar/autocomplete/keyboard/mobile/error recovery; ERP writes=0');
  }finally{if(rec&&!stopped)await rec.stop().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
