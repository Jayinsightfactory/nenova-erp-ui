// Real Chromium UI with synthetic API fixtures; no business/production data writes.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');

(async () => {
  const { buildProfitReportXlsx } = await import('../lib/profitReportExcel.js');
  const base = process.argv[2] || 'http://localhost:3217';
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1920,height:1080});
    const calls = [], writes = [], errors = [];
    let fail18 = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (!u.pathname.startsWith('/api/')) return req.continue();
      if (req.method() !== 'GET') writes.push(u.pathname);
      const year = u.searchParams.get('year') || '2026', major = String(u.searchParams.get('week') || '41').padStart(2,'0');
      const rows = [{category:'에콰도르',currency:'USD',auto:{N:1000,L:0,O:0,Q:100,S:0,R:1,H:0,E:200,F:0},manual:{},source:{},stock:{endQty:0},beginStock:{endQty:2}}];
      let data = {success:true, rows:[],history:[],items:[]};
      if (u.pathname === '/api/auth/me') data = {success:true,user:{userId:'fixture',role:'admin',userName:'UI fixture'}};
      if (u.pathname === '/api/sales/profit-report') data = {success:true,orderYear:year,major,rows,note:'합성 검증',audit:{errorCount:0,warningCount:0,issues:[]}};
      if (u.pathname === '/api/sales/profit-report-output') {
        calls.push({year,major,cols:u.searchParams.get('cols'),category:u.searchParams.get('category')});
        if (major==='18' && fail18) {fail18=false;return req.respond({status:502,body:'Bad gateway'});}
        data = {success:true,year,major,workbook:buildProfitReportXlsx({major,rows,visibleCols:u.searchParams.get('cols').split(',').filter(Boolean),displayCategory:u.searchParams.get('category')!=='0',displaySheetFirst:true,returnWorkbook:true})};
      }
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.evaluateOnNewDocument(() => {
      if(!sessionStorage.getItem('fixture-seeded')) {
        localStorage.setItem('nenova_profitReport_visibleCols_v3',JSON.stringify(['category','C','J']));
        localStorage.setItem('nenova_profitReport_outputCols_v1',JSON.stringify(['category','E','J']));
        sessionStorage.setItem('fixture-seeded','1');
      }
    });
    const click = async (selector,text) => page.evaluate(({selector,text})=>{
      const el=[...document.querySelectorAll(selector)].find(e=>e.textContent.trim()===text);
      if(!el)throw Error('Missing control '+text);el.click();
    },{selector,text});
    await page.goto(`${base}/sales/profit-report?year=2026&week=41`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>document.body.innerText.includes('41개 시트'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('nenova_profitReport_visibleCols_v3')),'["category","C","J"]');
    await click('summary','엑셀·인쇄 항목 (3/22)');
    await click('label','기초상품재고액');
    await click('label','매출액');
    await page.waitForFunction(()=>localStorage.getItem('nenova_profitReport_outputCols_v1')==='["category","C","J"]');
    await page.reload({waitUntil:'networkidle0'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('nenova_profitReport_outputCols_v1')),'["category","C","J"]');
    await click('summary','인쇄 차수 선택 (1개)');
    await click('button','선택 차수 인쇄 미리보기 (1개)');
    await page.waitForSelector('iframe[title="선택 차수 인쇄 미리보기"]');
    assert.deepEqual(calls,[{year:'2026',major:'41',cols:'C,J',category:'1'}]);
    const frame=page.frames().find(f=>f.parentFrame());
    const html=await frame.content();
    assert.match(html,/매출액/); assert.doesNotMatch(html,/기초상품재고액/);
    calls.length=0;
    await click('button','엑셀 다운로드 (1~41차 · 41개 시트)');
    await page.waitForFunction(()=>document.body.innerText.includes('1~41차 엑셀 생성 완료'));
    assert.equal(calls.length,41);
    assert.ok(calls.every(c=>c.year==='2026'&&c.cols==='C,J'&&c.category==='1'));
    assert.deepEqual(calls.map(c=>c.major),Array.from({length:41},(_,i)=>String(i+1).padStart(2,'0')));
    await click('button','선택 차수 인쇄 미리보기 (1개)');
    await page.waitForSelector('iframe[title="선택 차수 인쇄 미리보기"]');
    await click('summary','엑셀·인쇄 항목 (3/22)');
    await click('button','항목 선택 해제');
    await page.waitForFunction(()=>!document.querySelector('iframe[title="선택 차수 인쇄 미리보기"]'));
    await page.reload({waitUntil:'networkidle0'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('nenova_profitReport_outputCols_v1')),'[]');
    await click('summary','엑셀·인쇄 항목 (0/22)');
    await click('button','현재 화면 컬럼 가져오기');
    // Existing screen picker persistence, including explicit empty, not just output preferences.
    await click('button','⚙ 컬럼 (3/22)');
    await page.evaluate(()=>{const p=[...document.querySelectorAll('span')].find(e=>e.textContent==='표시할 컬럼').parentElement.parentElement;[...p.querySelectorAll('label')].find(e=>e.textContent.trim()==='매출액').click();});
    await page.waitForFunction(()=>localStorage.getItem('nenova_profitReport_visibleCols_v3')==='["category","J"]');
    await page.reload({waitUntil:'networkidle0'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('nenova_profitReport_visibleCols_v3')),'["category","J"]');
    await click('summary','인쇄 차수 선택 (1개)');
    await click('button','선택 해제'); await click('label','18차');
    calls.length=0; fail18=true;
    await click('button','선택 차수 인쇄 미리보기 (1개)');
    await page.waitForFunction(()=>document.body.innerText.includes('일시 오류 재시도'));
    await page.waitForSelector('iframe[title="선택 차수 인쇄 미리보기"]');
    assert.deepEqual(calls.map(c=>c.major),['18','18']);
    calls.length=0;
    await page.goto(`${base}/sales/profit-report?year=2025&week=41`,{waitUntil:'networkidle0'});
    await click('summary','인쇄 차수 선택 (1개)');
    await click('button','선택 차수 인쇄 미리보기 (1개)');
    await page.waitForSelector('iframe[title="선택 차수 인쇄 미리보기"]');
    assert.deepEqual(calls,[{year:'2025',major:'41',cols:'C,J',category:'1'}]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('nenova_profitReport_visibleCols_v3')),'["category","J"]');
    fs.mkdirSync('.verify',{recursive:true});
    await page.screenshot({path:'.verify/profit-output-preferences-desktop.png',fullPage:true});
    // A keyboard Escape returns focus to the corresponding summary.
    await page.focus('details summary'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    await page.setViewport({width:640,height:900});
    await click('summary','엑셀·인쇄 항목 (3/22)');
    const bounds=await page.$eval('details fieldset',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});
    assert.ok(bounds.left>=0 && bounds.right<=bounds.width+1);
    assert.deepEqual(errors,[]); assert.deepEqual(writes,[]);
    await page.screenshot({path:'.verify/profit-output-preferences.png',fullPage:true});
    console.log('PASS real Chromium: independent preferences/reload/empty/copy, screen restoration, 41 single request, 18 retry, preview invalidation, narrow layout; API writes=0');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
