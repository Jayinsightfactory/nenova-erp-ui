const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1576,height:800});
    const label = 'Hydrangea Dark Pink / 수국 진분홍 아주 긴 품목명 '.repeat(7).trim();
    const customer = {CustKey:12,CustName:'연습업체',Manager:'연습담당',ManagerName:'연습담당',LastOrderDtm:'2026-11-18T09:00:00'};
    const products = [1,2].map(ProdKey => ({ProdKey,ProdName:ProdKey===1?label:label+' Z',CounName:'연습국',FlowerName:'연습꽃',OutUnit:'박스'}));
    let saved, prior, hist, lookup, opened;
    await page.setRequestInterception(true);
    page.on('request',r=>{
      const u=new URL(r.url());
      if (!u.pathname.startsWith('/api/')) return r.continue();
      const q=u.searchParams; let data={};
      if(u.pathname==='/api/master') data={data:[{CustKey:14,CustName:'가나다무이력',Manager:'가담당'},{CustKey:13,CustName:'과거업체',Manager:'과거담당'},customer]};
      if(u.pathname==='/api/products/search') data=q.has('groupsOnly')?{groups:[{country:'연습국',flower:'연습꽃',prodCount:2}]}:{products};
      if(u.pathname==='/api/orders/my-customers' && !q.has('view')) {
        data={customers:[{CustKey:14,CustName:'가나다무이력',ManagerName:'가담당',LastOrderDtm:null},{CustKey:13,CustName:'과거업체',ManagerName:'과거담당',LastOrderDtm:'2025-11-18T09:00:00'},customer]};
      } else if(u.pathname==='/api/orders/my-customers') {
        prior=Object.fromEntries(q);
        data=q.get('view')==='history'?{orders:[]}:{order:{year:q.get('year'),week:'01-01',items:[{prodKey:1,prodName:label,qty:4,unit:'박스'}]}};
      }
      if(u.pathname==='/api/orders/history'){hist=Object.fromEntries(q);data={history:[]}}
      if(u.pathname==='/api/orders' && r.method()==='POST'){saved=JSON.parse(r.postData());data={results:[{status:'OK'}],orderMasterKey:1}}
      else if(u.pathname==='/api/orders'){if(q.has('week'))lookup=Object.fromEntries(q);data={orders:[]}}
      return r.respond({contentType:'application/json',body:JSON.stringify({success:true,...data})});
    });
    page.on('dialog',async d=>{await d.accept()});
    const mounted = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders/my-customers' && !new URL(r.url()).searchParams.has('view'));
    await page.goto((process.env.ORDER_GRID_BASE || 'http://127.0.0.1:39174')+'/orders/new?popup=1',{waitUntil:'domcontentloaded',timeout:120000});
    await mounted;
    const click = async (selector,part) => {
      console.log('Checking:',part); await page.waitForFunction((s,t)=>[...document.querySelectorAll(s)].some(el=>el.offsetHeight && el.textContent.includes(t)&&!el.disabled),{},selector,part);
      await page.evaluate((s,t)=>[...document.querySelectorAll(s)].find(el=>el.offsetHeight&&el.textContent.includes(t)&&!el.disabled).click(),selector,part);
    };
    const btn=t=>click('button',t);
    const weekButtons='button[aria-pressed]';
    await page.waitForSelector(weekButtons);
    await page.click(weekButtons);
    await page.waitForSelector('button[aria-expanded="false"]');
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'펼치기');
    await btn('펼치기');
    await btn('담당자 · 업체 선택');
    const panelText=await page.evaluate(()=>document.body.innerText);
    assert.ok(panelText.indexOf('연습담당',panelText.indexOf('담당자:')) < panelText.indexOf('과거담당',panelText.indexOf('담당자:')));
    const customerOrder=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>['연습업체','과거업체','가나다무이력'].some(n=>b.textContent.includes(n))).map(b=>b.textContent));
    assert.ok(customerOrder[0].includes('연습업체') && customerOrder[1].includes('과거업체') && customerOrder[2].includes('가나다무이력'));
    await btn('연습담당'); await btn('연습업체');
    await btn('펼치기'); await btn('접기');
    await click('td','연습국'); await click('td','연습꽃');
    const input='tbody input[type=number]'; await page.waitForSelector(input);
    await page.click(input); await page.keyboard.type('12');
    for(const [key,i] of [['ArrowRight',1],['ArrowDown',4],['ArrowLeft',3],['ArrowUp',0],['ArrowUp',0]]) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(s=>[...document.querySelectorAll(s)].indexOf(document.activeElement),input),i);
    }
    assert.equal(await page.$eval(input,e=>e.value),'12');
    const cells = await page.evaluate(label=>[...document.querySelectorAll('td')].filter(e=>e.textContent.startsWith(label)).map(e=>{
      const style=getComputedStyle(e);return {wrap:style.whiteSpace,height:e.offsetHeight,width:e.clientWidth,scroll:e.scrollWidth,table:e.closest('table').style.tableLayout};
    }),label);
    assert.ok(cells.some(c=>c.table==='fixed' && c.wrap==='normal' && c.height>25 && c.scroll<=c.width+1), JSON.stringify(cells));
    await page.evaluate(()=>{window.open=url=>{window.smokeNew=url;return null}});
    await btn('Ctrl+N'); opened=await page.evaluate(()=>window.smokeNew);assert.match(opened,/orders\/new\?popup=1/);
    await btn('Ctrl+S');await page.waitForFunction(()=>document.body.innerText.includes('주문이 저장되었습니다.'));
    assert.equal(saved.items[0].qty,12);assert.equal(saved.custKey,12);
    await click('.modal button','확인');
    await btn('바로 이전');await btn('더 이전');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes('더 이전')&&!el.disabled));assert.equal(prior.beforeWeek,'01-01');assert.equal(prior.custKey,'12');
    await btn('과거·고정 주문'); await click('.modal button','닫기');
    await btn('주문 변경 내역 조회');await click('.modal button','닫기');assert.equal(hist.year,saved.year);assert.equal(hist.custNames,customer.CustName);
    if (process.env.ORDER_SCREENSHOT) await page.screenshot({path:process.env.ORDER_SCREENSHOT});
    await btn('Ctrl+R');await page.waitForFunction(()=>document.body.innerText.includes('기존 주문이 없습니다'));assert.equal(lookup.year,saved.year);
    await btn('삭제');await page.waitForSelector('button[aria-pressed]');
    await btn('[ESC]');await page.waitForFunction(()=>location.pathname==='/orders');
    console.log('PASS: selector, four arrows and edge, wrapped name, five actions and order history; all APIs intercepted.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1});
