import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildShippingCycles,normalizeCycleRequest,shiftDate,SHIPPING_DAYS} from '../lib/weekdayEstimateCycle.js';
const base=process.env.SMOKE_BASE_URL||'http://127.0.0.1:20767';
assert.match(base,/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const periods=[];
for(let i=-7;i<14;i++) {
  const day=SHIPPING_DAYS[((i%7)+7)%7];
  periods.push({BaseYmd:shiftDate('2026-09-17',i),WeekDay:day.code,OrderYearWeek:`2026${38+Math.floor(i/7)+(day.suffix==='02'?1:0)}`});
}
const cycles=buildShippingCycles(periods,normalizeCycleRequest({year:2026,majorWeek:38}));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
const calls=[];
const output=path.resolve('output/weekday-horizontal');fs.mkdirSync(output,{recursive:true});
await page.route('**/api/**',async route=>{
  const req=route.request();const url=new URL(req.url());calls.push({path:url.pathname,method:req.method()});
  let data={success:true};
  if(url.pathname==='/api/auth/me')data.user={userId:'fixture',userName:'검사',authority:3};
  else if(url.pathname==='/api/favorites')data.favorites=[];
  else if(url.pathname==='/api/customers/search')data.customers=[{CustKey:533,CustName:'주광농원'}];
  else if(url.pathname==='/api/estimate/weekday-calendar')data={success:true,readOnly:true,cycles};
  else if(url.pathname==='/api/estimate/weekday-products')data.products=Array.from({length:50},(_,i)=>({ProdKey:i+101,ProdName:`CARNATION 품목 ${String(i+1).padStart(2,'0')}`}));
  else if(url.pathname==='/api/estimate/weekday-compare') {
    const body=req.postDataJSON();
    data={success:true,readOnly:true,history:[],sourceLots:[],rows:body.orderWeeks.flatMap(orderWeek=>body.prodKeys.map(prodKey=>{
      const cycle=cycles.find(row=>row.majorWeek===orderWeek.slice(0,2));
      const date=cycle.days[orderWeek.endsWith('01')?0:4].date;
      return {year:2026,orderWeek,custKey:533,prodKey,prodName:`CARNATION 품목 ${String(prodKey-100).padStart(2,'0')}`,flowerName:prodKey<126?'카네이션':'장미',outUnit:'박스',fixed:true,state:'FIXED_REVIEW_REQUIRED',shipmentOutQuantity:2,shipmentDates:[{date,shipmentQuantity:2,estimateQuantity:200}]};
    }))};
  } else if(url.pathname==='/api/estimate/weekday-print') {
    const scope=req.postDataJSON();
    data={success:true,readOnly:true,scope,customer:{CustName:'주광농원'},note:'fixture 확정본 · 미적용 초안 제외',draftIncluded:false,items:[{_exePrint:true,_exeParity:true,ProdKey:101,ProdName:'품목 01',Quantity:200,UnitQuantity:'200송이',Cost:1000,Amount:181818,Vat:18182,EstimateType:'정상출고'}]};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
try {
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.equal(await page.locator('.wcm-table-scroll table').count(),1);
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),50);
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.wcm-table-scroll table').getBoundingClientRect().width,visibleRows:[...document.querySelectorAll('.wcm-table-scroll tbody tr')].filter(row=>row.getBoundingClientRect().bottom<=innerHeight).length}));
  assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert.ok(dimensions.documentWidth<=1921);
  assert.ok(dimensions.tableWidth<=1905);assert.ok(dimensions.visibleRows>=24,JSON.stringify(dimensions));
  assert.equal(await page.getByRole('button',{name:/^\d+차 . 견적 출력$/}).count(),21);
  await page.screenshot({path:path.join(output,'1920x1080-top.png')});
  const cell=page.getByLabel('CARNATION 품목 01 2026/38-01 2026-09-17 미적용 초안 수량',{exact:true});
  await cell.fill('0');await cell.press('Enter');
  await page.getByRole('status').filter({hasText:'요일 수량 초안을 기록했습니다'}).waitFor();
  assert.equal(await cell.inputValue(),'0');
  await page.getByRole('button',{name:'선택 칸 내역 닫기'}).click();
  await page.getByRole('button',{name:'38차 목 견적 출력',exact:true}).click();
  await page.getByRole('dialog',{name:'요일 견적서 인쇄 미리보기'}).waitFor();
  const frame=page.frameLocator('iframe[title="전산 확정 견적서"]');
  await frame.locator('.item-table tbody td').first().waitFor();
  const fonts={title:await frame.locator('h1').evaluate(el=>getComputedStyle(el).fontSize),item:await frame.locator('.item-table tbody td').first().evaluate(el=>getComputedStyle(el).fontSize),header:await frame.locator('.item-th').first().evaluate(el=>getComputedStyle(el).fontSize)};
  assert.equal(fonts.title,'21.3333px');assert.equal(fonts.item,'10.6667px');assert.equal(fonts.header,'12px');
  await page.screenshot({path:path.join(output,'1920x1080-print.png')});
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByLabel('2026/38차 목 2026-09-17 출력 선택').check();
  await page.getByLabel('2026/38차 화 2026-09-22 출력 선택').check();
  await page.getByRole('button',{name:'선택요일 출력 (2)',exact:true}).click();
  await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'전체 견적',exact:true}).nth(1).click();
  await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.setViewportSize({width:1280,height:800});
  const narrow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,inner:innerWidth,overflow:document.querySelector('.wcm-table-scroll').scrollWidth>document.querySelector('.wcm-table-scroll').clientWidth}));
  assert.ok(narrow.width<=1281);assert.equal(narrow.overflow,true);
  assert.deepEqual(errors,[]);
  assert.ok(calls.every(call=>!/(?:apply|fix|save|adjust)/.test(call.path)));
  console.log(JSON.stringify({pass:true,viewport:'1920x1080',zoom:'100%',dimensions,fonts,narrow,errors,noErpWrites:true,output}));
} catch(error) {await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'console-errors.json'),JSON.stringify(consoleErrors,null,2));throw error;}
finally{await browser.close();}
