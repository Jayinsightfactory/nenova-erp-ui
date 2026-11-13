const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
(async () => {
 const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for (const width of [1366,760]) for(const country of ['dutch','china']) {
   await page.setViewport({width,height:768});
   await page.goto(`http://127.0.0.1:3198/stats/${country}-volume-board${process.env.SMOKE_POPUP==='1'?'?popup=1':''}`,{waitUntil:'networkidle0'});
   const loadSelector=country==='china'?'[data-china-guide="load"]':'[data-volume-guide="load"]';
   await page.waitForFunction(selector=>{const b=document.querySelector(selector);return b&&!b.disabled;},{},loadSelector);
   await page.click(loadSelector);
   await page.waitForSelector('[data-volume-header-row] .customer-heading',{timeout:60000});
   const report=await page.evaluate(async country=>{
    const wrap=document.querySelector(country==='dutch'?'.sheet-scroll':'.board-wrap');
    const first=wrap.querySelector('[data-volume-header-row]').cells[0];
    const customer=wrap.querySelector('.customer-heading');
    const controls=wrap.querySelectorAll('button,input,select').length;
    const pause=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    let scroller=wrap.parentElement;
    while(scroller && !(scroller.scrollHeight>scroller.clientHeight+100 && /auto|scroll/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
    const before=first.getBoundingClientRect().top;
    wrap.scrollIntoView({block:'start'});wrap.scrollTop=280;
    await pause();
    const top=first.getBoundingClientRect().top;
    const expectedOuter=scroller?Math.max(0,scroller.getBoundingClientRect().top+scroller.clientTop):0;
    const expected=Math.max(expectedOuter,wrap.getBoundingClientRect().top+wrap.clientTop,wrap.parentElement.querySelector('.matrix-x-rail,.sheet-top-scroll')?.getBoundingClientRect().bottom||0);
    const customerTop=customer.getBoundingClientRect().top;
    const x=customer.getBoundingClientRect().left;
    wrap.scrollLeft=190;
    await pause();
    const xAfter=customer.getBoundingClientRect().left;
    const result={top,expected,customerTop,verticalAlign:getComputedStyle(customer).verticalAlign,xDelta:x-xAfter,scrollLeft:wrap.scrollLeft,controlsPreserved:controls===wrap.querySelectorAll('button,input,select').length,offset:wrap.style.getPropertyValue('--volume-header-offset')};
    {
     const rail=wrap.parentElement.querySelector('.matrix-x-rail,.sheet-top-scroll');
     result.railParity=Math.abs(rail.scrollLeft-wrap.scrollLeft)<2;
     rail.scrollLeft=320;wrap.scrollTop=240;await pause();
     result.bothAxes=wrap.scrollTop>0 && Math.abs(wrap.scrollLeft-320)<2;
     const bounds=wrap.getBoundingClientRect();
     const y=Math.max(0,bounds.top,first.getBoundingClientRect().top)+Math.max(150,customer.getBoundingClientRect().bottom-first.getBoundingClientRect().top+30);
     result.productAboveControls=!!document.elementFromPoint(bounds.left+(country==='dutch'?100:35),y)?.closest(country==='dutch'?'td.sticky-cell':'tbody th');
     wrap.scrollTop=0;await pause();
    }
    if(scroller)scroller.scrollTop=0;else window.scrollTo(0,0);
    await pause();
    result.reset=wrap.style.getPropertyValue('--volume-header-offset');
    return result;
   },country);
   assert.ok(Math.abs(report.top-report.expected)<3,JSON.stringify({width,country,...report}));
   assert.equal(report.verticalAlign,'top');assert.equal(report.controlsPreserved,true);
   assert.ok(Math.abs(report.xDelta-report.scrollLeft)<3);
   assert.ok(report.railParity && report.bothAxes && report.productAboveControls,JSON.stringify(report));
   assert.equal(report.reset,'0px');
   await page.emulateMediaType('print');
   assert.equal(await page.$eval('.customer-heading',el=>getComputedStyle(el).transform),'none');
   await page.emulateMediaType('screen');
   console.log(JSON.stringify({width,country,...report}));
  }
  assert.deepEqual(errors,[]);console.log('Volume header browser smoke PASS');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
