// Local fixture only. Every API request is intercepted; no production write is possible.
// SMOKE_BASE_URL=http://127.0.0.1:20767 PLAYWRIGHT_MODULE=/prepared/playwright/index.mjs node scripts/weekday-apply-browser-smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildShippingCycles, normalizeCycleRequest, shiftDate, SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';
import { weekdaySnapshotDigest } from '../lib/weekdayDistributionPolicy.js';
import { normalizeWeekdayPrintRequest } from '../lib/weekdayEstimatePrint.js';

const base=process.env.SMOKE_BASE_URL || 'http://127.0.0.1:20767';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
assert.ok(process.env.PLAYWRIGHT_MODULE,'NEEDS_MAIN_PREFLIGHT: supply prepared PLAYWRIGHT_MODULE and local Next server');
const playwright=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const chromium=playwright.chromium || playwright.default?.chromium;
const periods=[];
for(let i=-7;i<14;i++) {
  const day=SHIPPING_DAYS[((i%7)+7)%7];
  periods.push({BaseYmd:shiftDate('2026-09-17',i),WeekDay:day.code,OrderYearWeek:`2026${38+Math.floor(i/7)+(day.suffix==='02'?1:0)}`});
}
const cycles=buildShippingCycles(periods,normalizeCycleRequest({year:2026,majorWeek:38}));
const stored=new Map(), audit=[], operations=new Map(), requests=[], errors=[];
const printReads=[];
let printFailureDate='',printEmptyDate='';
let behavior='fail', pollCount=0, statusReady=false, omitReadDigest=true;
const makeRow=(year,orderWeek,custKey=533)=>{
  const cycle=cycles.find(item=>item.majorWeek===orderWeek.slice(0,2));
  const days=cycle.days.filter(day=>day.orderWeek===orderWeek).slice(0,2);
  const key=`${year}|${orderWeek}|${custKey}`;
  if(!stored.has(key))stored.set(key,{
    year,orderWeek,custKey,prodKey:866,prodName:'CARNATION 저장 fixture',flowerName:'카네이션',outUnit:'박스',estUnit:'송이',detailRows:1,
    shipmentOutQuantity:25,fixed:true,state:'FIXED_REVIEW_REQUIRED',
    shipmentDates:days.map((day,index)=>({date:day.date,timestamp:`${day.date} 00:00:00.000`,sdateKey:100+cycle.offset*10+index+(orderWeek.endsWith('02')?5:0),sdetailKey:200+cycle.offset+(orderWeek.endsWith('02')?5:0),shipmentKey:300+cycle.offset,weekDay:day.code,shipmentQuantity:index?20:5,estimateQuantity:index?200:50,detailFixed:true,cost:100,amount:index?18182:4545,vat:index?1818:455})),
  });
  const row=structuredClone(stored.get(key));
  // Shared server canonical helper; mock DB state only, never production writes.
  const physical={detailRows:row.detailRows,shipmentOutQuantity:row.shipmentOutQuantity,shipmentDates:row.shipmentDates,
    master:{ShipmentKey:row.shipmentDates[0].shipmentKey,MasterIsFix:row.fixed,OrderYearWeek:`${year}${orderWeek.slice(0,2)}`},
    detail:{SdetailKey:row.shipmentDates[0].sdetailKey,ShipmentKey:row.shipmentDates[0].shipmentKey,CustKey:custKey,ProdKey:row.prodKey,
      OutQuantity:row.shipmentOutQuantity,BoxQuantity:row.shipmentOutQuantity,BunchQuantity:row.shipmentOutQuantity,SteamQuantity:row.shipmentOutQuantity*10,
      EstQuantity:row.shipmentDates.reduce((sum,day)=>sum+day.estimateQuantity,0),DetailCost:100,
      DetailAmount:row.shipmentDates.reduce((sum,day)=>sum+day.amount,0),DetailVat:row.shipmentDates.reduce((sum,day)=>sum+day.vat,0),DetailIsFix:row.fixed},
    product:{ProdKey:row.prodKey,OutUnit:'박스',EstUnit:'송이',BunchOf1Box:1,SteamOf1Bunch:10,SteamOf1Box:10},
  };
  return {...row,snapshotDigest:weekdaySnapshotDigest({year,orderWeek,custKey,prodKey:row.prodKey},physical)};
};
const baselines=cycles.flatMap(cycle=>['01','02'].map(suffix=>{
  const row=makeRow(cycle.year,`${cycle.majorWeek}-${suffix}`);
  return {year:row.year,orderWeek:row.orderWeek,custKey:533,confirmedAt:'2026-10-01T03:00:00Z',confirmedBy:'fixture',rows:[{prodKey:866,prodName:row.prodName,unit:'박스',quantity:25,shipmentDates:row.shipmentDates.map(day=>({date:day.date,quantity:day.shipmentQuantity,estimateQuantity:day.estimateQuantity}))}]};
}));
const immutable=JSON.stringify(baselines);
const quotes=scope=>['01','02'].flatMap(suffix=>makeRow(scope.year,`${scope.majorWeek}-${suffix}`,scope.custKey).shipmentDates)
  .filter(day=>scope.mode!=='dates'||scope.dates.includes(day.date)).map(day=>({_exePrint:true,_exeParity:true,ProdKey:866,ProdName:'CARNATION 저장 fixture',Quantity:day.estimateQuantity,UnitQuantity:`${day.estimateQuantity}송이`,Cost:100,Amount:day.amount,Vat:day.vat,EstimateType:'정상출고'}));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const page=await context.newPage();
const output=path.resolve('output/weekday-apply');fs.mkdirSync(output,{recursive:true});
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort('blockedbyclient'));
await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  requests.push({path:url.pathname,method:req.method(),query:url.search});
  let data={success:true},code=200;
  if(url.pathname==='/api/auth/me')data.user={userId:'fixture',userName:'검사',authority:3};
  else if(url.pathname==='/api/favorites')data.favorites=[];
  else if(url.pathname==='/api/work/replay')data={success:true,sessions:[],events:[]};
  else if(url.pathname==='/api/customers/search')data.customers=[{CustKey:533,CustName:'주광농원'}];
  else if(url.pathname==='/api/estimate/weekday-calendar')data.cycles=cycles;
  else if(url.pathname==='/api/estimate/weekday-products')data.products=[{ProdKey:866,ProdName:'CARNATION 저장 fixture'}];
  else if(url.pathname==='/api/estimate/weekday-baseline') {
    assert.equal(req.method(),'GET','fixture baselines are immutable; no confirmation POST');
    data.baselines=baselines;
  } else if(url.pathname==='/api/estimate/weekday-note')data.notes=[];
  else if(url.pathname==='/api/estimate/weekday-compare') {
    const body=req.postDataJSON();data={success:true,readOnly:true,scope:body,rows:body.orderWeeks.map(week=>{
      const row=makeRow(body.year,week,body.custKey);if(omitReadDigest)delete row.snapshotDigest;return row;
    }),history:[{OrderYear:2026,OrderWeek:'38-01',ProdKey:866,SdetailKey:200,ChangeDtm:'2026-10-01 02:00:00',ChangeID:'exe-fixture-user',ChangeType:'수정',ShipmentDate:'2026-09-17',BeforeValue:4,AfterValue:5,Descr:'기존 EXE fixture 비고'}],sourceLots:[]};
  } else if(url.pathname==='/api/estimate/weekday-print') {
    const scope=normalizeWeekdayPrintRequest(req.postDataJSON());printReads.push(scope);
    if(scope.mode==='dates' && scope.dates.includes(printFailureDate)) {code=500;data={success:false,error:'fixture weekday print failure'};}
    else data={success:true,scope,customer:{CustKey:scope.custKey,CustName:'주광농원'},items:scope.mode==='dates'&&scope.dates.includes(printEmptyDate)?[]:quotes(scope),note:'fixture 保存 확정본',readOnly:true,draftIncluded:false};
  } else if(url.pathname==='/api/estimate')data.items=quotes({year:Number(url.searchParams.get('year')),majorWeek:url.searchParams.get('week'),custKey:Number(url.searchParams.get('custKey')),mode:'major'});
  else if(url.pathname==='/api/estimate/weekday-apply') {
    const body=req.postDataJSON();
    assert.equal(body.custKey,533);assert.ok(body.reason.trim());assert.equal(body.changes.length,1);
    const change=body.changes[0];assert.deepEqual(change.dates,[{date:'2026-09-17',quantity:7}]);
    assert.equal(change.unit,'박스');assert.equal(change.expected.shipmentDates.length,2);assert.equal(change.expected.shipmentOutQuantity,25);
    assert.equal(change.expected.snapshotDigest,makeRow(change.year,change.orderWeek,body.custKey).snapshotDigest,'expected carries the exact current read token');
    if(behavior==='fail') {code=409;data={success:false,error:'fixture stale snapshot'};}
    else {
      const key=`${change.year}|${change.orderWeek}|${body.custKey}`,row=stored.get(key),before=structuredClone(row);
      for(const edit of change.dates){const day=row.shipmentDates.find(item=>item.date===edit.date);day.shipmentQuantity=edit.quantity;day.estimateQuantity=edit.quantity*10;day.amount=Math.round(day.estimateQuantity*100/1.1);day.vat=day.estimateQuantity*100-day.amount;}
      row.shipmentOutQuantity=row.shipmentDates.reduce((sum,day)=>sum+day.shipmentQuantity,0);
      const operation={success:true,saved:true,operationId:body.operationId};operations.set(body.operationId,operation);
      audit.push({operationId:body.operationId,year:change.year,orderWeek:change.orderWeek,custKey:body.custKey,prodKey:866,reason:body.reason,userId:'fixture',changedAt:'2026-10-01T04:00:00Z',before,after:structuredClone(row)});
      return route.abort('failed'); // committed fixture, lost network response
    }
  } else if(url.pathname==='/api/estimate/weekday-changes') {
    if(url.searchParams.has('operationId')){
      pollCount++;const operation=statusReady?operations.get(url.searchParams.get('operationId')):null;
      data={success:true,saved:Boolean(operation),operation:operation || null};
    } else data.changes=audit.filter(event=>event.year===Number(url.searchParams.get('year'))&&event.orderWeek.startsWith(url.searchParams.get('majorWeek')));
  } else {errors.push(`Unexpected fixture API: ${req.method()} ${url.pathname}`);code=400;data={success:false,error:'Unexpected fixture API blocked'};}
  await route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(data)});
});
try {
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  await page.getByRole('button',{name:'현재 38차 보기',exact:true}).click();
  const cell=page.getByRole('textbox',{name:'CARNATION 저장 fixture 2026/38-01 2026-09-17 미적용 초안 수량',exact:true});
  await cell.fill('7');await cell.press('Enter');
  assert.equal(await page.getByRole('button',{name:'38차 목 견적 출력',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'업체·엑셀 연결 펼치기',exact:true}).click();
  const comparison=page.locator('section').filter({has:page.getByRole('heading',{name:'6. 전산 대조 결과 · 읽기 전용',exact:true})});
  const comparisonRow=comparison.getByRole('row').filter({has:page.getByRole('cell',{name:'2026 / 38-01',exact:true})});
  assert.match(await comparisonRow.locator('td').nth(3).innerText(),/^27 박스/,'comparison projects full 5+20 shipment with draft 7, not changed-cell subtotal 7');
  assert.equal(await comparisonRow.locator('td').nth(5).innerText(),'2','full projected change is +2, not -18');
  assert.match(await comparisonRow.locator('td').nth(7).innerText(),/예상 20 \(현재 유지\)/,'untouched date preserves saved 20');
  await page.getByRole('button',{name:'ERP 저장 · 변경 확인',exact:true}).first().click();
  await page.getByRole('alert').filter({hasText:'스냅샷 digest가 누락'}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'ERP 저장 변경 확인'}).count(),0,'legacy cached compare cannot open a save confirmation');
  assert.equal(requests.filter(req=>req.path==='/api/estimate/weekday-apply').length,0,'missing digest never POSTs');
  assert.equal(await cell.inputValue(),'7','blocked legacy snapshot retains draft');
  omitReadDigest=false;
  await page.getByRole('button',{name:'전산 새로고침',exact:true}).click();
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  await page.getByRole('button',{name:'ERP 저장 · 변경 확인',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'ERP 저장 변경 확인'});
  await dialog.getByRole('textbox',{name:'ERP 저장 사유'}).fill('fixture 날짜 정정');
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1920&&bounds.y+bounds.height<=1080,'reason dialog fits 1920x1080');
  await page.screenshot({path:path.join(output,'1920x1080-save-preview.png')});
  await dialog.getByRole('button',{name:'변경 확인 · ERP에 저장',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'fixture stale snapshot'}).waitFor();
  assert.equal(await dialog.getByRole('textbox',{name:'ERP 저장 사유'}).inputValue(),'fixture 날짜 정정');
  assert.equal(await cell.inputValue(),'7','failed save keeps draft');
  await dialog.getByRole('button',{name:'닫기 · 초안 유지',exact:true}).click();
  await page.getByRole('textbox',{name:'중심 차수',exact:true}).fill('37');
  await page.waitForFunction(()=>[...document.querySelectorAll('header button')].find(button=>button.textContent==='ERP 저장 · 변경 확인')?.disabled);
  assert.equal(requests.filter(req=>req.path==='/api/estimate/weekday-apply').length,1,'scope change never submits previous drafts');
  await page.getByRole('textbox',{name:'중심 차수',exact:true}).fill('38');
  await page.waitForFunction(()=>[...document.querySelectorAll('header button')].find(button=>button.textContent==='ERP 저장 · 변경 확인')?.disabled===false);
  assert.equal(await cell.inputValue(),'7','return to original scope restores its retained draft');
  await page.getByRole('button',{name:'ERP 저장 · 변경 확인',exact:true}).first().click();
  behavior='unknown';
  await dialog.getByRole('button',{name:'변경 확인 · ERP에 저장',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'저장 여부 확인 중'}).waitFor();
  assert.equal(pollCount,3,'bounded polling');
  assert.equal(requests.filter(req=>req.path==='/api/estimate/weekday-apply').length,2,'one failed attempt and one explicit retry only');
  assert.equal(await dialog.getByRole('button',{name:'변경 확인 · ERP에 저장',exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'닫기 · 초안 유지',exact:true}).click();
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'같은 작업 저장 상태 다시 조회',exact:true}).waitFor();
  statusReady=true;
  await page.getByRole('button',{name:'같은 작업 저장 상태 다시 조회',exact:true}).click();
  await page.getByRole('status').filter({hasText:'ERP 저장 응답을 확인했습니다'}).waitFor();
  assert.equal(requests.filter(req=>req.path==='/api/estimate/weekday-apply').length,2,'reload/status recovery must not POST');
  assert.equal(await page.getByRole('button',{name:'38차 목 견적 출력',exact:true}).isEnabled(),true);
  assert.equal(JSON.stringify(baselines),immutable,'first baselines unchanged');
  await page.getByRole('button',{name:'38차 목 견적 출력',exact:true}).click();
  const print=page.getByRole('dialog',{name:'요일 견적서 인쇄 미리보기'});await print.waitFor();
  assert.match(await print.locator('iframe').getAttribute('srcdoc'),/70송이/,'new quote reads saved day quantity');
  assert.equal((await print.locator('iframe').getAttribute('srcdoc')).includes('weekday-print-page'),false,'single-day common HTML is unchanged');
  await page.screenshot({path:path.join(output,'1920x1080-saved-print.png')});
  await print.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('checkbox',{name:'2026/38차 목 2026-09-17 출력 선택',exact:true}).check();
  await page.getByRole('checkbox',{name:'2026/38차 금 2026-09-18 출력 선택',exact:true}).check();
  const selectedPrint=page.getByRole('button',{name:'선택요일 출력 (2)',exact:true});
  const beforeReads=printReads.length;
  await selectedPrint.click();await print.waitFor();
  assert.deepEqual(printReads.slice(beforeReads).map(scope=>scope.dates).sort(),[['2026-09-17'],['2026-09-18']],'each selected weekday is queried separately');
  const frame=print.frameLocator('iframe');
  assert.equal(await frame.locator('.weekday-print-page').count(),2);assert.equal(await frame.locator('h1').count(),2);
  const thursday=await frame.locator('[data-print-date="2026-09-17"]').innerText();
  const friday=await frame.locator('[data-print-date="2026-09-18"]').innerText();
  assert.match(thursday,/70송이/);assert.match(thursday,/6,364/);assert.doesNotMatch(thursday,/200송이|18,182/);
  assert.match(friday,/200송이/);assert.match(friday,/18,182/);assert.doesNotMatch(friday,/70송이|6,364/);
  const styles=await print.locator('iframe').evaluate(iframe=>{
    const doc=iframe.contentDocument,win=iframe.contentWindow;
    return {body:win.getComputedStyle(doc.body).fontSize,heading:win.getComputedStyle(doc.querySelector('h1')).fontSize,
      cell:win.getComputedStyle(doc.querySelector('.item-table tbody td')).fontSize,
      hasPrintBreak:doc.head.textContent.includes('break-before:page'),hasPrintPadding:doc.head.textContent.includes('padding:10mm 15mm')};
  });
  assert.equal(styles.body,'12px');assert.equal(styles.heading,'21.3333px');assert.equal(styles.cell,'10.6667px');assert.equal(styles.hasPrintBreak,true);assert.equal(styles.hasPrintPadding,true);
  const multiBounds=await print.boundingBox();assert.ok(multiBounds.x>=0&&multiBounds.y>=0&&multiBounds.x+multiBounds.width<=1920&&multiBounds.y+multiBounds.height<=1080);
  await page.screenshot({path:path.join(output,'1920x1080-selected-days-print.png')});
  await print.getByRole('button',{name:'닫기',exact:true}).click();
  printFailureDate='2026-09-18';
  await selectedPrint.click();
  await page.getByRole('alert').filter({hasText:'fixture weekday print failure'}).waitFor();
  assert.equal(await print.count(),0,'one weekday failure prevents the entire preview');
  printFailureDate='';printEmptyDate='2026-09-18';
  await selectedPrint.click();await print.waitFor();
  assert.match(await print.innerText(),/2026-09-18: 확정 견적 자료 없음/);
  assert.equal(await print.frameLocator('iframe').locator('.weekday-print-page').count(),1,'empty selected day is explicit, not a zero quote');
  await print.getByRole('button',{name:'닫기',exact:true}).click();printEmptyDate='';
  await page.getByRole('button',{name:'업체·엑셀 연결 펼치기',exact:true}).click();
  assert.match(await page.locator('.weekday-workspace').innerText(),/fixture 날짜 정정/);
  const historyText=await page.locator('.weekday-workspace').innerText();
  assert.match(historyText,/EXE 공용 출고 이력 · ShipmentHistory/);assert.match(historyText,/exe-fixture-user/);assert.match(historyText,/기존 EXE fixture 비고/);assert.match(historyText,/웹 요일 저장 감사/);
  assert.match(historyText,/상세행이 완전히 삭제된 취소건은 기존 EXE 조회에서 빠질 수 있으며/);
  assert.match(historyText,/기존 ShipmentHistory 행의 보존과 EXE 화면의 조회 가능 여부는 다릅니다/);
  const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport.scale,pageOverflow:document.documentElement.scrollWidth>innerWidth,tableOverflow:document.querySelector('.wcm-table-scroll').scrollWidth>document.querySelector('.wcm-table-scroll').clientWidth}));
  assert.deepEqual(geometry,{width:1920,height:1080,scale:1,pageOverflow:false,tableOverflow:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({success:true,viewport:'1920x1080 CSS / 100%',fixtures:['server canonical digest','legacy missing digest save blocked','full-date comparison projection','reason preview','failed draft retention','scope switch draft isolation','unknown bounded polling','reload UUID retention','status-only retry','immutable baseline','new saved-day print','selected days separate reads/headers/pages/quantity/amount','common EXE typography','partial print failure blocks all','empty weekday notice','persistent web/native history source labels','deleted detail history notice','page/table overflow'],geometry}));
} finally {await browser.close();}
