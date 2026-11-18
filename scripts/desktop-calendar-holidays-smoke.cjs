// Actual shell, isolated owner files and generated reference dates. No production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer-core');
const {fixture}=require('./desktop-task-schedule-smoke.cjs');
(async()=>{
 const app=await fixture({withFavorites:true}),browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1920,height:1080});
  await page.exposeFunction('fixtureInvoke',async(a,p)=>{const result=await app.invoke(a,p);if(a==='close')await page.evaluate(value=>window.fixtureEmit(value),result);return result;});await page.evaluateOnNewDocument(()=>window.desktop={invoke:(a,p)=>window.fixtureInvoke(a,p),onState(fn){window.fixtureEmit=fn;}});
  await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(app.base);await page.waitForSelector('.hw-task');await page.waitForFunction(()=>!document.querySelector('#calendarSettingsButton').disabled);
  await page.focus('#favoritesToggle');await page.keyboard.press('Space');assert.equal(await page.$eval('#favoritesList',e=>e.hidden),true);await page.evaluate(()=>{window.fixtureEmit({menuOpen:false});window.fixtureEmit({menuOpen:true});});assert.equal(await page.$eval('#favoritesList',e=>e.hidden),true);assert.equal(app.calls.filter(c=>c.action==='close').length,0);assert.equal((await app.invoke('state')).tabs.length,2);await page.click('#favoritesToggle');assert.equal(await page.$eval('#favoritesList',e=>e.hidden),false);assert.equal(await page.$$('.favorite-close').then(a=>a.length),0);
  assert.equal(await page.$eval('#workCalendar .calendar-date-number',e=>getComputedStyle(e).fontSize),'15.3px');
  const fill=(selector,value)=>page.$eval(selector,(e,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await page.click('#calendarSettingsButton');assert.equal(await page.$$('input[name=holidayCountry]').then(a=>a.length),12);
  await page.$$eval('input[name=holidayCountry]',a=>a.forEach(e=>e.checked=['US','JP','CN'].includes(e.value)));
  await fill('input[aria-label="미국 공휴일 색상"]','#7c3aed');await page.click('.holiday-settings-dialog .workspace-primary');
  await page.waitForSelector('.calendar-holiday[data-country=US]');assert.ok(await page.$('.calendar-holiday[data-country=JP]'));assert.equal(await page.$$('.calendar-holiday[data-country=KR]').then(a=>a.length),0);
  const preferences=await page.evaluate(()=>JSON.parse(localStorage.getItem('nenova-calendar-view-v1:schedule-fixture')));assert.deepEqual(preferences.holidayCountries,['CN','JP','US']);assert.equal(preferences.holidayColors.US,'#7c3aed');
  await page.reload();await page.waitForSelector('.hw-task');await page.waitForSelector('.calendar-holiday[data-country=US]');
  const dateCell='.calendar-cell:has(.calendar-day[data-date="'+app.date+'"])';await page.click(dateCell+' button.month-task');await page.waitForSelector('.calendar-task-dialog[open]');
  await fill('.calendar-task-dialog [name=title]','달력에서 수정한 업무');await fill('[name=detail_location]','연습 회의실');await fill('[name=detail_note]','저장되는 업무 메모');await fill('[name=detail_color]','#be365c');
  await page.click('.calendar-task-dialog button[type=submit]');await page.waitForFunction(()=>!document.querySelector('.calendar-task-dialog').open);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button.month-task')).some(e=>e.textContent.includes('달력에서 수정한 업무')));
  await page.click(dateCell+' button.month-task');await page.waitForSelector('.calendar-task-dialog[open]');await page.focus('.calendar-task-dialog button[type=submit]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.calendar-task-dialog').open);
  const personal=app.calls.filter(c=>c.action==='homeWorkspace'&&c.payload.method==='POST').at(-1).payload.command;assert.equal(personal.details.note,'저장되는 업무 메모');assert.equal(personal.details.location,'연습 회의실');
  await page.click('#companyCalendarButton');await page.waitForSelector('.company-dialog[open] .company-form');
  await fill('.company-form [name=title]','비공개 일정 연습');await fill('.company-form [name=startTime]','08:30');await fill('.company-form [name=visibility]','private');await fill('.company-form [name=location]','연습 장소');await fill('.company-form [name=attendees]','참석자 연습');await fill('.company-form [name=availability]','free');await fill('.company-form [name=reminderMinutes]','10');
  await page.click('#companyCalendarSave');await page.waitForFunction(()=>!document.querySelector('.company-dialog').open);await page.waitForSelector('.month-company.is-private');
  await page.click('#calendarPersonalFilter');assert.equal(await page.$$('.month-company.is-private').then(a=>a.length),0);await page.click('#calendarPersonalFilter');await page.click('.month-company.is-private');
  assert.equal(await page.$eval('.company-form [name=location]',e=>e.value),'연습 장소');assert.equal(await page.$eval('.company-form [name=visibility]',e=>e.value),'private');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.company-dialog').open);
  await page.evaluate(date=>{Date.now=()=>Date.parse(date+'T08:25:00+09:00');window.fixtureEmit({menuOpen:false});window.fixtureEmit({menuOpen:true});},app.date);await page.waitForSelector('.calendar-reminder');await page.click('.calendar-reminder button:last-child');await page.waitForFunction(()=>document.querySelector('.calendar-reminders').hidden);
  await page.click('#companyCalendarButton');await page.click('#newWeeklySchedule');await fill('.company-form [name=title]','네덜란드 1차 주문등록');await fill('.company-form [name=date]','2026-11-25');await fill('[name=weeklyEndDate]','2026-11-27');await fill('[name=weeklyDeadline]','2027-01-20');await fill('[name=weeklyResetDate]','2027-01-06');await fill('.company-form [name=location]','주차별 연습 장소');
  await page.click('#companyCalendarSave');await page.waitForFunction(()=>!document.querySelector('.company-dialog').open);
  await page.evaluate(()=>window.homeWorkspace.selectDate('2027-01-06'));await page.waitForFunction(()=>Array.from(document.querySelectorAll('.month-company')).some(e=>e.textContent==='네덜란드 1차 주문등록'));
  await page.$eval('.calendar-cell:has([data-date="2027-01-06"]) .month-company',e=>e.click());await page.waitForSelector('.company-dialog[open]');
  assert.equal(await page.$eval('[name=weeklyResetDate]',e=>e.value),'2027-01-06');assert.equal(await page.$eval('.company-form [name=location]',e=>e.value),'주차별 연습 장소');assert.equal(await page.$eval('.company-form [name=date]',e=>e.value),'2026-11-25');
  fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/calendar-editor-1920.png'});
  for(const width of [800,390]){await page.setViewport({width,height:900});assert.ok(await page.$eval('.company-dialog',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));await page.screenshot({path:'.verify/calendar-editor-'+width+'.png'});}
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.company-dialog').open);await page.setViewport({width:1920,height:1080});
  await page.click('#calendarSettingsButton');await page.$$eval('input[name=holidayCountry]',a=>a.forEach(e=>e.checked=e.value==='CN'));await page.click('.holiday-makeup-option input');await page.click('.holiday-settings-dialog .workspace-primary');
  await page.evaluate(()=>window.homeWorkspace.selectDate('2027-02-14'));await page.waitForSelector('.calendar-holiday.is-workday[data-country=CN]');
  assert.deepEqual(errors,[]);console.log('Calendar UI PASS: 12 country choices/colors/account persistence; personal direct modal save; private scope/details; due reminder acknowledgement; weekly Jan6 reset edit; 1920/800/390; no external requests or JS errors.');
 }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
