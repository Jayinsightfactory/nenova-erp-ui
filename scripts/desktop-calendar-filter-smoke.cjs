const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { fixture } = require('./desktop-task-schedule-smoke.cjs');

(async () => {
  const app = await fixture();
  const browser = await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('fixtureInvoke', (a,p) => app.invoke(a,p));
    await page.evaluateOnNewDocument(() => {
      window.desktop = {invoke:(a,p)=>window.fixtureInvoke(a,p),onState(cb){window.fixtureEmit=cb;}};
    });
    await page.setViewport({width:1584,height:970});
    const load = async () => {
      await page.goto(app.base);
      await page.waitForSelector('.month-task');
      await page.waitForFunction(() => document.querySelector('#calendarCompanyFilter').disabled === false);
    };
    const badge = () => page.$eval('.calendar-new-badge', e => !e.hidden);
    await load();
    // Wait for the initial shared-calendar snapshot and its per-account baseline.
    await page.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('nenova-calendar-view-v1:')));
    await page.click('#calendarCompanyFilter');
    assert.equal(await page.$eval('#calendarCompanyFilter',e=>e.getAttribute('aria-pressed')),'false');
    let result = await app.invoke('companyCalendar',{method:'GET',query:{date:app.date}});
    const add = async date => {
      result = await app.invoke('companyCalendar',{method:'POST',query:{date:app.date},command:{
        action:'create',expectedRevision:result.revision,requestId:randomUUID(),date,title:'회사 전체 새 일정',color:'#2563eb',startTime:'09:00',endTime:'10:00',note:''
      }});
      assert.ok(result.success);
    };
    await add('2027-01-06');
    await load();
    await page.waitForFunction(() => !document.querySelector('.calendar-new-badge').hidden);
    assert.equal(await page.$$eval('.month-company,.week-event.is-company',e=>e.length),0);
    assert.ok(await page.$$eval('.month-task',e=>e.length)>0);
    fs.mkdirSync('.verify',{recursive:true});
    await page.screenshot({path:'.verify/calendar-company-new.png'});
    await page.click('#calendarCompanyFilter');
    assert.equal(await badge(),false);
    await load();
    assert.equal(await badge(),false);
    await add(app.date);
    await load();
    await page.waitForSelector('.month-company');
    await page.click('#calendarPersonalFilter');
    assert.equal(await page.$$eval('.month-task',e=>e.length),0);
    assert.ok(await page.$$eval('.month-company',e=>e.length)>0);
    await page.reload();
    await page.waitForSelector('.month-company');
    assert.equal(await page.$eval('#calendarPersonalFilter',e=>e.getAttribute('aria-pressed')),'false');
    await page.click('#calendarCompanyFilter');
    assert.equal(await page.$$eval('.month-company,.month-task,.week-event',e=>e.length),0);
    assert.deepEqual(errors,[]);
    console.log('Calendar filter PASS: personal/shared/both/none, saved selection, new off-period addition badge, explicit acknowledgement, no automatic activation.');
  } finally {await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
