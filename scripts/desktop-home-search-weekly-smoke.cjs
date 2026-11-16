// Real desktop renderer, authenticated synthetic fixtures. No production data or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer-core');
const {fixture}=require('./desktop-task-schedule-smoke.cjs');
const shotDir=process.env.DESKTOP_HOME_PREVIEWS;
async function capture(page,selector,name){if(shotDir){fs.mkdirSync(shotDir,{recursive:true});await(await page.$(selector)).screenshot({path:path.join(shotDir,name+'.png')});}}
async function run(){
  const app=await fixture(),browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.setViewport({width:1600,height:1000});await p.exposeFunction('fixtureInvoke',app.invoke);
    await p.evaluateOnNewDocument(()=>window.desktop={invoke:(a,p)=>window.fixtureInvoke(a,p),onState(cb){window.fixtureEmit=cb;}});
    await p.setRequestInterception(true);p.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
    await p.goto(app.base);await p.waitForFunction(()=>!document.querySelector('.hw-add>input')?.disabled && document.querySelector('.hw-task'));
    const type=async(sel,value)=>p.$eval(sel,(e,v)=>{e.focus();e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);
    const opens=()=>app.calls.filter(c=>c.action==='open').length;
    const oldOpens=opens();
    const hashBefore=await p.$eval('#menuGroups',e=>{window.firstCatalogNode=e.firstElementChild;return e.childElementCount;});
    await type('#menuSearch','견적서');
    const opts='#menuSearchResults [role=option]';assert.deepEqual(await p.$$eval(opts+' span',a=>a.map(x=>x.textContent)),['견적서 관리','주광 견적서']);
    for(const w of [1600,800,390]){
      await p.setViewport({width:w,height:950});const coords=await p.evaluate(()=>{const a=document.querySelector('.search-box').getBoundingClientRect(),b=document.querySelector('#menuSearchPopup').getBoundingClientRect(),c=document.querySelector('#menuSearchResults button').getBoundingClientRect();return {gap:b.top-a.bottom,x:b.x-a.x,width:b.width-a.width,visible:document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)?.closest('[role=option]')!==null};});
      assert.ok(coords.gap>=0&&coords.gap<=8&&Math.abs(coords.x)<=1&&Math.abs(coords.width)<=1&&coords.visible,JSON.stringify(coords));
    }
    await p.setViewport({width:1600,height:1000});
    if(shotDir){fs.mkdirSync(shotDir,{recursive:true});const clip=await p.evaluate(()=>{const a=document.querySelector('.search-wrap').getBoundingClientRect(),b=document.querySelector('#menuSearchPopup').getBoundingClientRect();return {x:Math.floor(a.x)-3,y:Math.floor(a.y)-3,width:Math.ceil(Math.max(a.right,b.right)-a.x)+6,height:Math.ceil(b.bottom-a.y)+6};});await p.screenshot({clip,path:path.join(shotDir,'home-menu-results.png')});}
    await p.$eval('#menuSearch',n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));assert.equal(opens(),oldOpens);
    await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
    assert.equal(app.calls.filter(c=>c.action==='open').at(-1).payload.url,'/estimate/weekday');
    await type('#menuSearch','견 적 서');await p.click(opts);assert.equal(app.calls.filter(c=>c.action==='open').at(-1).payload.url,'/estimate');
    await type('#menuSearch','없는메뉴888');assert.equal(await p.$eval('#menuSearchStatus',e=>e.textContent.includes('없습니다')),true);await p.keyboard.press('Escape');
    assert.equal(await p.$eval('#menuSearchPopup',e=>e.hidden),true);assert.equal(await p.$eval('#menuGroups',e=>e.firstElementChild===window.firstCatalogNode&&e.childElementCount),hashBefore);
    const name='.hw-add>input',recommend='.hw-title-choices button',title='견적서';
    await type(name,title);assert.equal(await p.$$(recommend).then(r=>r.length),2);
    const titleGap=await p.evaluate(()=>document.querySelector('.hw-title-links').getBoundingClientRect().top-document.querySelector('.hw-add>input').getBoundingClientRect().bottom);
    assert.ok(titleGap>=0&&titleGap<=8,'title suggestions must be directly below input: '+titleGap);
    await capture(p,'.hw-add','today-task-search');
    const posted=()=>app.calls.filter(c=>c.action==='homeWorkspace'&&c.payload.method==='POST');
    const previousPosts=posted().length;await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
    assert.equal(await p.$eval('.hw-add [name=shortcutMenu]',e=>e.value),'/estimate/weekday');assert.equal(await p.$eval(name,e=>e.value),title);assert.equal(posted().length,previousPosts);
    await p.click('.hw-add>button');await p.waitForFunction(()=>!document.querySelector('.hw-add>input').value);assert.equal(posted().at(-1).payload.command.shortcut.target,'/estimate/weekday');
    const selectDate=async(date)=>{await p.$eval('.hw-tools',e=>e.open=true);await type('.hw-tool-body input[type=date]',date);await p.waitForFunction(d=>document.querySelector('.calendar-day[aria-pressed=true]')?.dataset.date===d,{},date);};
    const from='2026-11-25',second='2026-12-02',seventh='2027-01-06',sel=date=>'.calendar-cell:has(.calendar-day[data-date="'+date+'"]) .month-company';
    await selectDate(from);await p.click('#companyCalendarButton');await p.click('#newWeeklySchedule');
    await type('.company-form [name=title]','네덜란드 1차 주문등록');await type('[name=weeklyEndDate]','2026-11-27');await type('[name=weeklyDeadline]','2027-01-16');
    await type('.company-form [name=startTime]','09:00');await p.click('.company-swatch[data-value="#7c3aed"]');
    const preview=(start)=>p.$$eval('.company-weekly-example',(rows,date)=>rows.find(e=>e.querySelector('time').textContent.startsWith(date))?.querySelector('span').textContent,start);
    assert.equal(await p.$eval('[name=weeklyResetDate]',e=>e.value),seventh);
    await type('[name=weeklyResetDate]','2027-01-13');assert.equal(await preview(seventh),'네덜란드 7차 주문등록');assert.equal(await preview('2027-01-13'),'네덜란드 1차 주문등록');
    await type('[name=weeklyResetDate]',seventh);assert.equal(await preview('2026-12-30'),'네덜란드 6차 주문등록');assert.equal(await preview(seventh),'네덜란드 1차 주문등록');assert.equal(await preview('2027-01-13'),'네덜란드 2차 주문등록');await capture(p,'.company-weekly-fields','weekly-order-preview');
    const submit=async()=>{await p.click('.company-form [type=submit]');await p.waitForFunction(()=>!document.querySelector('.company-dialog').open);};
    await submit();await p.waitForSelector(sel(from));assert.equal(await p.$eval(sel(from),e=>e.textContent),'네덜란드 1차 주문등록');
    assert.equal(await p.$eval(sel('2026-11-27'),e=>e.textContent),'네덜란드 1차 주문등록');assert.equal(await p.$(sel('2026-11-28')),null);
    await selectDate(second);await p.waitForSelector(sel(second));assert.equal(await p.$eval(sel(second),e=>e.textContent),'네덜란드 2차 주문등록');
    await selectDate(seventh);await p.waitForSelector(sel(seventh));assert.equal(await p.$eval(sel(seventh),e=>e.textContent),'네덜란드 1차 주문등록');
    assert.equal(await p.$eval(sel('2027-01-01'),e=>e.textContent),'네덜란드 6차 주문등록');assert.equal(await p.$eval(sel('2027-01-13'),e=>e.textContent),'네덜란드 2차 주문등록');
    await p.waitForFunction(()=>[...document.querySelectorAll('.week-event.is-company')].some(e=>e.textContent.includes('1차')));
    assert.equal(await p.$(sel('2027-01-09')),null);await p.click(sel(seventh));assert.equal(await p.$eval('.company-form [name=title]',e=>e.value),'네덜란드 1차 주문등록');assert.equal(await p.$eval('.company-form [name=date]',e=>e.value),from);assert.equal(await p.$eval('[name=weeklyResetDate]',e=>e.value),seventh);
    await type('[name=weeklyDeadline]','2027-01-06');await p.click('[name=weeklyInclusive]');await submit();await p.waitForSelector(sel(seventh));assert.equal(await p.$(sel('2027-01-07')),null);
    await p.click(sel(seventh));await p.click('.company-dialog-actions button[type=button]');assert.ok((await p.$eval('.company-confirm',e=>e.textContent)).includes('모든 주'));await p.click('.company-confirm button');await p.waitForFunction(()=>!document.querySelector('.company-dialog').open);assert.equal(await p.$(sel(seventh)),null);
    assert.deepEqual(errors,[]);console.log('PASS: top search (visible / four-pixel gap / local / keyboard / click / IME), title suggestions with explicit save, weekly titles Nov to Jan, monthly + weekly, inclusive and exclusive, series edit/delete.');
  }finally{await browser.close();await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
