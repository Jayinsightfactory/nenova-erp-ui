// Local synthetic UI smoke. Intercept every API request; never use operating data.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3187';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local fixture server only');

(async () => {
  const browser = await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1366,height:900});
    const requests=[]; const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      const url=new URL(request.url());
      if(!url.pathname.startsWith('/api/')) return request.continue();
      requests.push({path:url.pathname,method:request.method(),year:url.searchParams.get('year'),week:url.searchParams.get('week')});
      const scope={orderYear:url.searchParams.get('year'),major:url.searchParams.get('week')};
      let body={success:true,user:{userId:'fixture',userName:'검증',authority:'admin'},favorites:[]};
      let status=200;
      if(url.pathname==='/api/sales/profit-report') body={success:true,...scope,rows:[{category:'합성 품종',variant:'normal',manual:{},auto:{N:1000,L:0,O:0,Q:100,R:2,H:10,S:0,E:100,F:50},stock:{},source:{},stockSourceKind:{}}],rates:{},stockWeeks:{begin:'31-02',end:'32-01',beginOrderYear:scope.orderYear,endOrderYear:scope.orderYear},snapshot:{state:'stale',servedFrom:'snapshot',needsRefresh:true},audit:{issues:[]}};
      if(url.pathname==='/api/sales/profit-report-week-check') {
        if(scope.orderYear==='2025') {status=500;body={success:false,error:'fixture failure'};}
        else body={success:true,...scope,rows:[{subWeek:'32-01',topic:'환율 근거',status:'review',statusLabel:'확인 필요',text:'합성 원천 점검'}]};
      }
      if(url.pathname==='/api/sales/profit-stock-adjustment-notes') body={ok:true,...scope,items:[],count:0};
      if(url.pathname==='/api/sales/profit-independent-audit') {
        const detail=url.searchParams.get('detail')||scope.major;
        body={success:true,...scope,year:scope.orderYear,detail,version:'fixture-v1',invalidKeyCount:0,limitations:['합성 검산 자료'],
          integrity:{status:scope.orderYear==='2025'?'STALE':'STABLE_OBSERVED',finishedAt:new Date().toISOString(),sourceHash:'fixture'},
          weeks:Array.from({length:Number(scope.major)},(_,i)=>({major:String(i+1).padStart(2,'0'),status:'MISMATCH',localMismatchCount:1,carriedCount:0,adjustedCount:1,inputRequiredCount:0,checkedCount:1,
            begin:null,end:null,detailsLoaded:String(i+1).padStart(2,'0')===detail,entries:String(i+1).padStart(2,'0')===detail?[{prodKey:1,name:'독립 합성 품목',category:'합성 품종',unit:'단',period:`${scope.orderYear}/${detail}-01`,status:'MISMATCH',opening:10,receipt:5,shipped:2,adjusted:0,expected:13,closing:15,difference:2,openingError:0,closingError:2,firstObserved:`${scope.orderYear}/${detail}-01`,adjustmentCount:2,missingReasonCount:1,explanation:'합성 원인: 계산 잔량과 저장 잔량 차이',action:'합성 이력 확인'}]:[]}))};
      }
      await request.respond({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(`${base}/sales/profit-validation?popup=1&year=2026&week=32`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>document.body.innerText.includes('2026년 32차 확인 결과'));
    assert.equal(await page.$$eval('[data-ui-shell]',e=>e.length),1);
    assert.equal(await page.$$eval('[data-ui-sidebar]',e=>e.length),0);
    assert.match(await page.$eval('main',e=>e.innerText),/이전 계산 저장본/);
    assert.match(await page.$eval('main',e=>e.innerText),/합성 원천 점검/);
    assert.match(await page.$eval('main',e=>e.innerText),/독립 검산/);
    assert.match(await page.$eval('main',e=>e.innerText),/독립 합성 품목/);
    assert.match(await page.$eval('main',e=>e.innerText),/기초 10 \+ 입고 5/);
    assert.match(await page.$eval('main',e=>e.innerText),/최초 관측 차이/);
    const rangeButton=await page.$('section[aria-label="독립 검산 엔진"] > button');
    await rangeButton.click();
    await page.waitForFunction(()=>document.querySelector('section[aria-label="독립 검산 엔진"]').innerText.includes('1행 산술 일치 / 1행'));
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('금액·수익률도 모두 검산')&&!b.disabled));
    assert.equal(new Set(requests.filter(r=>r.path==='/api/sales/profit-report'&&r.year==='2026').map(r=>r.week)).size,32);
    if (process.env.SMOKE_SCREENSHOT) await page.screenshot({path:process.env.SMOKE_SCREENSHOT,fullPage:true});
    const year=await page.$('[aria-label="검증 연도"]');
    await year.click(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace'); await year.type('2025');
    await page.waitForFunction(()=>document.querySelector('[aria-label="검증 연도"]').value==='2025');
    assert.doesNotMatch(await page.$eval('main',e=>e.innerText),/2026년 32차 확인 결과/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.body.innerText.includes('원천 점검 판정 불가'));
    assert.match(await page.$eval('main',e=>e.innerText),/2025년 32차 확인 결과/);
    await page.waitForFunction(()=>document.body.innerText.includes('조회 도중 원천이 변경'));
    await page.setViewport({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page must not overflow horizontally');
    await page.focus('[aria-label="검증 연도"]'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'검증 차수');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
    await page.goto(`${base}/sales/profit-validation?popup=1&week=32`,{waitUntil:'networkidle0'});
    assert.match(await page.$eval('main',e=>e.innerText),/연도/);
    const before=requests.filter(r=>r.path.startsWith('/api/sales/')).length;
    await page.evaluate(()=>sessionStorage.clear());
    await page.setViewport({width:1366,height:900});
    await page.goto(`${base}/sales/profit-validation`,{waitUntil:'networkidle0'});
    assert.equal(await page.$$eval('[data-ui-sidebar]',e=>e.length),1);
    assert.equal(requests.filter(r=>r.path.startsWith('/api/sales/')).length,before,'menu entry waits for explicit selection');
    assert.ok(requests.filter(r=>r.path.startsWith('/api/sales/')).every(r=>r.method==='GET'));
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Local browser PASS: popup/normal shell, 2025/2026 scope, stale, partial failure, narrow viewport, keyboard, GET-only');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
