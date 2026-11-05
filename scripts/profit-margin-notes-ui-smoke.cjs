// Real local Chromium, synthetic intercepted API only. Never writes business data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
(async () => {
  const base = process.argv[2] || 'http://localhost:3239';
  const { buildProfitReportXlsx } = await import('../lib/profitReportExcel.js');
  const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const writes=[], errors=[];
  const calc={N:1000,L:0,O:0,C:1000,E:100,F:50,Q:1,R:100,S:1,P:100,T:100,G:200,H:50,I:300,J:700,K:.123,D:1,U:1,M:0,AC:0,AJ:0};
  const rows=[{category:'콜롬비아 장미',calculationFrozen:true,confirmed:true,auto:calc,manual:{},stock:{},beginStock:{},source:{},calc}];
  const userNote='냉해·특이사항: 사용자 비고 보존';
  const system='[콜롬비아 운임 배분] 31-01 GW 100kg / CW 200kg → CBM · 중량기준 대비 운임부담 +100원 · 재고유보 반영 이익효과 -80원 / 이익률 -0.800%p\n콜롬비아 장미 / 합성 품목: 실제 재고조정 -2 박스 · 평가액 -400원\n전차수 기말→당차수 기초 장미: 평가차이 +20원 (StockHistory 실제 조정과 별개)';
  try {
    const page=await browser.newPage();await page.setViewport({width:1920,height:1080});
    page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
    page.on('request',req=>{
      const url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return req.continue();
      if(req.method()!=='GET')writes.push(url.pathname);
      const major=String(url.searchParams.get('week')||'31').padStart(2,'0'),year=url.searchParams.get('year')||'2026';
      let data={success:true,rows:[],items:[],history:[]};
      if(url.pathname==='/api/auth/me')data={success:true,user:{userId:'fixture',userName:'합성검증',role:'admin'}};
      if(url.pathname==='/api/sales/profit-report')data={success:true,orderYear:year,major,rows,confirmed:true,confirmedTotals:calc,note:userNote,audit:{errorCount:0,warningCount:0,issues:[]}};
      if(url.pathname==='/api/sales/profit-stock-adjustment-notes')data={ok:true,orderYear:year,major,count:1,text:system,items:[{groupKey:'test',prodKey:1,productName:'합성 품목',country:'콜롬비아',flower:'장미',unit:'박스',net:-2,increase:0,decrease:-2,invalidCount:0,count:1,weeks:['31-01'],changeTypes:['재고조정'],reasons:['합성 검증'],valuationAmount:-400,valuationSources:['보고서 평균원가 기준 조정평가액']}]};
      if(url.pathname==='/api/sales/profit-report-output')data={success:true,year,major,workbook:buildProfitReportXlsx({major,rows,confirmedTotals:calc,note:userNote+'\n'+system,visibleCols:(url.searchParams.get('cols')||'C,J,K').split(','),returnWorkbook:true})};
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.evaluateOnNewDocument(()=>{localStorage.setItem('nenova_profitReport_visibleCols_v4',JSON.stringify(['category','C','J','K']));localStorage.setItem('nenova_profitReport_outputCols_v1',JSON.stringify(['category','C','J','K']));window.print=()=>{};});
    await page.goto(`${base}/sales/profit-report?year=2026&week=31`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>document.body.innerText.includes('보고서 평균원가 기준 조정평가액'));
    assert.equal(await page.$eval('textarea[maxlength="2000"]',e=>e.value),userNote);
    const text=await page.evaluate(()=>document.body.innerText);assert((text.match(/70\.0%/g)||[]).length>=2,'category and total K both use displayed J/C');assert.match(text,/-2 박스/);assert.match(text,/-400/);assert.match(text,/중량기준 대비/);
    fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/profit-margin-notes-desktop.png',fullPage:true});
    const reportTable=await page.evaluateHandle(()=>[...document.querySelectorAll('td')].find(e=>e.innerText.startsWith('70.0%'))?.closest('table'));
    assert(reportTable.asElement(),'visible J/C rate cell');await reportTable.asElement().screenshot({path:'.verify/profit-margin-notes-rates.png'});await reportTable.dispose();
    const notesSection=await page.$('section[aria-label="실제 재고조정·차감 이력"]');
    assert(notesSection);await notesSection.screenshot({path:'.verify/profit-margin-notes-evidence.png'});
    const click=async text=>{const handle=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text),text);assert(handle.asElement(),text);await handle.asElement().click();await handle.dispose();};
    await click('인쇄 (1개 차수 · 1장)');await page.waitForSelector('[data-testid="profit-print-frame"]');
    const frame=page.frames().find(f=>f.parentFrame());const html=await frame.content();
    for(const expected of ['사용자 비고 보존','중량기준 대비','재고조정 -2 박스','평가액 -400원','평가차이 +20원','70.00%'])assert(html.includes(expected),expected);
    await page.focus('textarea[maxlength="2000"]');await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement.tagName==='BUTTON'));
    await page.setViewport({width:390,height:900});await page.screenshot({path:'.verify/profit-margin-notes-mobile.png',fullPage:true});
    assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
    console.log('PASS real Chromium1920x1080/mobile: saved K→J/C, signed quantity/valuation, user/system inline print, keyboard, GET only');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
