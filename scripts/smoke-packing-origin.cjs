// Isolated browser smoke. The real input PDF remains local; every API is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');

async function main() {
  const [base,pdf] = process.argv.slice(2);
  const url = new URL(base);
  assert.equal(url.hostname,'127.0.0.1');
  assert(process.env.JWT_SECRET && fs.statSync(pdf).isFile());
  const captures = path.resolve('.verify/packing-origin');
  fs.mkdirSync(captures,{recursive:true});
  const browser = await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage();
    page.on('pageerror',error=>console.error('Page error:',error.message));
    page.on('console',message=>{if(message.type()==='warn'||message.type()==='warning') console.error(message.text());});
    await page.setViewport({width:1920,height:1080});
    const user = {userId:'origin-smoke',userName:'검증 계정',authority:4,deptName:'수입부',accountActive:true};
    await page.setCookie({name:'nenovaToken',value:jwt.sign(user,process.env.JWT_SECRET),url:base});
    await page.setRequestInterception(true);
    const forbidden = [];
    page.on('request',req=>{
      const target = new URL(req.url());
      if (!/^https?:$/.test(target.protocol)) return req.continue();
      if (target.origin !== url.origin) return req.abort();
      if (!target.pathname.startsWith('/api/')) return req.continue();
      if (req.method() !== 'GET' || /parse-pdf|upload-history|aud-exchange-rate/.test(target.pathname)) {
        forbidden.push(target.pathname); return req.abort();
      }
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify({
        success:true,user,products:[],items:[],rows:[],value:null,revision:0,data:[],
      })});
    });
    await page.goto(base+'/import/tools?popup=1',{timeout:120000,waitUntil:'domcontentloaded'});
    const nz = 'button[aria-label="뉴질랜드 (New Zealand)"]';
    await page.waitForSelector(nz,{timeout:120000});
    await page.click(nz);
    await (await page.$('section[aria-label="추가 원산지"] input[type=file]')).uploadFile(pdf);
    const preview = '[data-testid="packing-origin-preview"]';
    await page.waitForFunction(()=>document.querySelector('[data-testid="packing-origin-preview"], section[aria-label="추가 원산지"] [role="alert"]'),{timeout:75000});
    const error = await page.$('section[aria-label="추가 원산지"] [role="alert"]');
    if (error) {
      await page.screenshot({path:path.join(captures,'nz-reader-error.png')});
      throw new Error(await error.evaluate(element=>element.innerText));
    }
    const data = await page.$eval(preview,ele=>({text:ele.innerText,rows:ele.querySelectorAll('tbody tr').length}));
    assert.equal(data.rows,3);
    assert.match(data.text,/210195.*New Zealand Bloom Ltd.*NZD.*4,253\.80/);
    const panel='[aria-label="품목별 입고 예정값"]';
    await page.$eval(panel,element=>element.scrollIntoView({block:'center'}));
    await (await page.$(panel)).screenshot({path:path.join(captures,'nz-comparison-before.png')});
    for (const label of ['박스','단','송이','단가','행 금액']) {
      await (await page.$(`button[aria-label^="1행 ${label} "][aria-label$="원본 대조"]`)).click();
      await page.waitForSelector('[data-receipt-source-highlight]');
      assert.match(await page.$eval('[aria-label="원본 총금액 캡처"]',el=>el.innerText),/150%/);
    }
    await (await page.$('[data-receipt-source-highlight]')).screenshot({path:path.join(captures,'nz-comparison-highlight.png')});
    await page.click('section[aria-label="추가 원산지"] button');
    await page.click('button[aria-label="호주"]');
    await (await page.$('input[accept=".pdf"]')).uploadFile(pdf);
    await page.waitForFunction(()=>document.body.innerText.includes('품목 매칭은 시작하지 않았습니다.'));
    await page.screenshot({path:path.join(captures,'au-mismatch.png')});
    assert.deepEqual(forbidden,[]);
    console.log('NZ actual PDF, AU pre-match mismatch, API analysis/history/writes 0:',captures);
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
