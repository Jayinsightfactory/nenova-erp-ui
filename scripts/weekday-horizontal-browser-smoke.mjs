import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildShippingCycles,normalizeCycleRequest,shiftDate,SHIPPING_DAYS} from '../lib/weekdayEstimateCycle.js';
import {weekdayProductLabel} from '../lib/weekdayHorizontalMatrix.js';
import {baselineDigest,canonicalRows} from '../lib/weekdayInitialBaselineStore.js';
const base=process.env.SMOKE_BASE_URL||'http://127.0.0.1:20767';
assert.match(base,/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const periods=[];
for(let i=-7;i<14;i++) {
  const day=SHIPPING_DAYS[((i%7)+7)%7];
  periods.push({BaseYmd:shiftDate('2026-09-17',i),WeekDay:day.code,OrderYearWeek:`2026${38+Math.floor(i/7)+(day.suffix==='02'?1:0)}`});
}
const cycles=buildShippingCycles(periods,normalizeCycleRequest({year:2026,majorWeek:38}));
const activeProducts=Array.from({length:50},(_,i)=>({ProdKey:i+101,ProdName:`${i===0?'ALSTROEMERIA':'CARNATION'} 품목 ${String(i+1).padStart(2,'0')}`}));
const hiddenProducts=[
  {ProdKey:901,ProdName:'출고없음 주문전용 fixture',shipmentOutQuantity:null,shipmentDates:[]},
  {ProdKey:151,ProdName:'출고없음 영수량 fixture',shipmentOutQuantity:0,shipmentDates:[{date:'2026-09-17',shipmentQuantity:0}]},
  {ProdKey:903,ProdName:'출고없음 날짜영수량 fixture',shipmentOutQuantity:null,shipmentDates:[{date:'2026-09-17',shipmentQuantity:0,estimateQuantity:999}]},
  {ProdKey:904,ProdName:'출고없음 빈수량 fixture',shipmentOutQuantity:'',shipmentDates:[{date:'2026-09-17',shipmentQuantity:null,estimateQuantity:999}]},
];
const inventoryProducts=[...activeProducts,...hiddenProducts.map(({ProdKey,ProdName})=>({ProdKey,ProdName}))];
const newCustomerProduct={ProdKey:905,ProdName:'신규업체 미출고 품목 905 fixture',FlowerName:'카네이션',OutUnit:'박스'};
assert.ok(!inventoryProducts.some(product=>product.ProdKey===905),'new ERP candidate is not in customer inventory');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
const calls=[];
const comparisonRequests=[];
const calendarRequests=[];
const printRequests=[];
const managementRequests=[];
const baselineRequests=[];
const noteRequests=[];
const baselineRecords=[];
const noteRecords=[];
let alstroChanged=false;
let alstroOverride=null;
let failComparison=false;
let failPrint=false;
let failNote=false;
let failBaselineWeek=null;
const productLabel=product=>weekdayProductLabel({name:product.ProdName});
const comparisonRow=(orderWeek,prodKey)=>{
  const cycle=cycles.find(row=>row.majorWeek===orderWeek.slice(0,2));
  assert.ok(cycle,`fixture scope is an existing calendar cycle: ${orderWeek}`);
  const day=cycle.days[orderWeek.endsWith('01')?0:4];
  const date=day.date;
  if(prodKey===newCustomerProduct.ProdKey)return {year:2026,orderWeek,custKey:533,prodKey,prodName:newCustomerProduct.ProdName,
    flowerName:newCustomerProduct.FlowerName,outUnit:newCustomerProduct.OutUnit,estUnit:'송이',fixed:false,state:'NO_SHIPMENT',
    orderOutQuantity:null,orderEstQuantity:null,shipmentOutQuantity:null,shipmentDates:[]};
  const hidden=hiddenProducts.find(product=>product.ProdKey===prodKey);
  if(hidden)return {year:2026,orderWeek,custKey:533,prodKey,prodName:hidden.ProdName,flowerName:'카네이션',outUnit:'박스',estUnit:'송이',fixed:false,
    state:prodKey===901?'NO_SHIPMENT':'UNFIXED_REVIEW_REQUIRED',orderOutQuantity:800,orderEstQuantity:900,
    shipmentOutQuantity:hidden.shipmentOutQuantity,shipmentDates:hidden.shipmentDates.map(item=>({...item,date}))};
  const alstro=prodKey===101;
  const quantity=alstro?(orderWeek==='38-01'&&alstroOverride!==null?alstroOverride:alstroChanged&&orderWeek==='38-01'?48:32):2;
  const estimateQuantity=alstro?quantity*16:200;
  const amount=Math.round(estimateQuantity*1000/1.1);
  return {year:2026,orderWeek,custKey:533,prodKey,prodName:activeProducts.find(product=>product.ProdKey===prodKey).ProdName,
    flowerName:alstro?'알스트로':prodKey<126?'카네이션':'장미',outUnit:alstro?'단':'박스',estUnit:'송이',
    fixed:true,state:'FIXED_REVIEW_REQUIRED',shipmentOutQuantity:quantity,
    shipmentDates:[{date,shipmentQuantity:quantity,estimateQuantity,detailFixed:true,weekDay:day.code,
      cost:1000,amount,vat:estimateQuantity*1000-amount}]};
};
const snapshotFor=scope=>{
  const rows=canonicalRows(inventoryProducts.map(product=>{
    const row=comparisonRow(scope.orderWeek,product.ProdKey);
    const hidden=hiddenProducts.some(item=>item.ProdKey===product.ProdKey);
    return {prodKey:row.prodKey,prodName:row.prodName,flowerName:row.flowerName,unit:row.outUnit,
      quantity:hidden?0:row.shipmentOutQuantity,estUnit:row.estUnit,
      shipmentDates:hidden?[]:row.shipmentDates.map(day=>({date:day.date,orderWeek:scope.orderWeek,
        quantity:day.shipmentQuantity,estimateQuantity:day.estimateQuantity}))};
  }));
  return {...scope,rows,digest:baselineDigest(scope,rows)};
};
const quoteItems=scope=>activeProducts.flatMap(product=>{
  const actuals=['01','02'].map(suffix=>comparisonRow(`${scope.majorWeek}-${suffix}`,product.ProdKey));
  const days=actuals.flatMap(row=>row.shipmentDates).filter(day=>scope.mode!=='dates'||scope.dates.includes(day.date));
  if(!days.length)return [];
  const quantity=days.reduce((sum,day)=>sum+day.estimateQuantity,0);
  return [{_exePrint:true,_exeParity:true,ProdKey:product.ProdKey,ProdName:product.ProdName,
    Quantity:quantity,UnitQuantity:`${quantity}송이`,Cost:1000,
    Amount:days.reduce((sum,day)=>sum+day.amount,0),Vat:days.reduce((sum,day)=>sum+day.vat,0),EstimateType:'정상출고'}];
});
const output=path.resolve('output/weekday-horizontal');fs.mkdirSync(output,{recursive:true});
// Fixture execution is local-only, including subresources; never connect to an external browser.
await context.route('**/*',async route=>{
  if(new URL(route.request().url()).origin!==new URL(base).origin)return route.abort('blockedbyclient');
  return route.continue();
});
await page.route('**/api/**',async route=>{
  const req=route.request();const url=new URL(req.url());
  if(url.origin!==new URL(base).origin)return route.abort('blockedbyclient');
  calls.push({path:url.pathname,method:req.method()});
  let data={success:true};
  if(url.pathname==='/api/auth/me')data.user={userId:'fixture',userName:'검사',authority:3};
  else if(url.pathname==='/api/favorites')data.favorites=[];
  else if(url.pathname==='/api/customers/search')data.customers=[{CustKey:533,CustName:'주광농원'}];
  else if(url.pathname==='/api/products/search')data.products=[{ProdKey:151,ProdName:hiddenProducts.find(product=>product.ProdKey===151).ProdName,FlowerName:'카네이션',OutUnit:'박스'},newCustomerProduct]
    .filter(product=>product.ProdName.includes(url.searchParams.get('q')||''));
  else if(url.pathname==='/api/estimate/weekday-calendar') {
    calendarRequests.push({year:Number(url.searchParams.get('year')),majorWeek:Number(url.searchParams.get('majorWeek'))});
    data={success:true,readOnly:true,cycles};
  }
  else if(url.pathname==='/api/estimate/weekday-products')data.products=inventoryProducts;
  else if(url.pathname==='/api/estimate') {
    assert.equal(req.method(),'GET');
    const scope={year:Number(url.searchParams.get('year')),majorWeek:url.searchParams.get('week'),
      custKey:Number(url.searchParams.get('custKey')),byDate:url.searchParams.get('byDate'),itemsOnly:url.searchParams.get('itemsOnly')};
    assert.equal(scope.byDate,'1');assert.equal(scope.itemsOnly,'1');
    assert.equal(scope.year,2026);assert.equal(scope.custKey,533);
    managementRequests.push(scope);
    // Integer fixture quantities: management per-date rows and saved print totals are identical.
    data={success:true,items:quoteItems({...scope,mode:'major',dates:[]})};
  }
  else if(url.pathname==='/api/estimate/weekday-baseline') {
    if(req.method()==='GET') {
      const weeks=url.searchParams.get('orderWeeks').split(',');
      data={success:true,readOnly:true,baselines:baselineRecords.filter(record=>record.year===Number(url.searchParams.get('year'))
        &&record.custKey===Number(url.searchParams.get('custKey'))&&weeks.includes(record.orderWeek))};
    } else {
      const body=req.postDataJSON();baselineRequests.push(body);
      const scope={year:body.year,orderWeek:body.orderWeek,custKey:body.custKey};
      assert.equal(scope.year,2026);assert.equal(scope.custKey,533);
      assert.ok(['preview','confirm'].includes(body.action));
      if(body.action==='preview' && scope.orderWeek===failBaselineWeek) return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,error:'fixture 현재 기준 조회 실패'})});
      if(baselineRecords.some(record=>record.year===scope.year&&record.orderWeek===scope.orderWeek&&record.custKey===scope.custKey)) {
        return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({success:false,code:'BASELINE_ALREADY_CONFIRMED',error:'이미 최초 기준이 확정된 차수입니다.'})});
      }
      const preview=snapshotFor(scope);
      if(body.action==='preview')data={success:true,readOnly:true,preview};
      else {
        assert.equal(body.expectedDigest,preview.digest,'confirm must send the exact preview digest');
        const baseline={version:1,...preview,source:'ERP_DISTRIBUTION',confirmedAt:'2026-10-01T03:04:05.000Z',confirmedBy:'fixture'};
        baselineRecords.push(structuredClone(baseline));
        data={success:true,baseline,erpChanged:false};
      }
    }
  } else if(url.pathname==='/api/estimate/weekday-note') {
    if(req.method()==='GET')data={success:true,readOnly:true,notes:noteRecords.filter(record=>record.year===Number(url.searchParams.get('year'))
      &&record.majorWeek===url.searchParams.get('majorWeek')&&record.custKey===Number(url.searchParams.get('custKey')))};
    else {
      const body=req.postDataJSON();noteRequests.push(body);
      assert.equal(body.expectedRevision,0);
      assert.equal(body.earlyShipment.confirmation,'MANUAL_USER_DECLARATION');
      if(failNote) {failNote=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,error:'fixture 비고 저장 실패'})});}
      const {expectedRevision,...content}=body;
      const note={version:1,...content,revision:1,updatedAt:'2026-10-01T03:05:00.000Z',updatedBy:'fixture'};
      noteRecords.push(structuredClone(note));data={success:true,note,erpChanged:false};
    }
  }
  else if(url.pathname==='/api/estimate/weekday-compare') {
    const body=req.postDataJSON();
    comparisonRequests.push(body);
    if(failComparison) {failComparison=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,error:'fixture 전산 대조 실패'})});}
    data={success:true,readOnly:true,history:[],sourceLots:[],rows:body.orderWeeks.flatMap(orderWeek=>body.prodKeys.map(prodKey=>comparisonRow(orderWeek,prodKey)))};
  } else if(url.pathname==='/api/estimate/weekday-print') {
    const scope=req.postDataJSON();printRequests.push(scope);
    if(failPrint) {failPrint=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,error:'fixture 견적 출력 실패'})});}
    data={success:true,readOnly:true,scope,customer:{CustName:'주광농원'},note:'fixture 확정본 · 미적용 초안 제외',draftIncluded:false,items:quoteItems(scope)};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
try {
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.equal(await page.locator('.wcm-table-scroll table').count(),1);
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),50);
  for(const product of activeProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(productLabel(product),{exact:true}).count(),1);
  assert.equal(await page.locator('.wcm-table-scroll colgroup col').count(),34,'product + 33 cycle columns');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').first().locator('td').count(),33);
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-total').count(),6);
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-initial').count(),6);
  assert.deepEqual(await page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-initial').allTextContents(),Array(6).fill('32(2)'),'unconfirmed ERP distribution quantities appear immediately');
  assert.equal(await page.locator('thead .wcm-initial').filter({hasText:'미확정'}).count(),6);
  assert.equal(baselineRequests.filter(request=>request.action==='preview').length,6);
  assert.equal(baselineRequests.filter(request=>request.action==='confirm').length,0,'startup must never confirm');
  assert.ok((await page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-total > span').allTextContents()).every(text=>text==='0(0)'),'preview permits clearly labeled provisional planning residual only');
  assert.ok((await page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-remainder-status').allTextContents()).every(text=>text==='미확정 예상'));
  assert.equal(printRequests.length,3,'startup now reads three saved quote totals');
  assert.deepEqual(printRequests.map(request=>[request.year,String(request.majorWeek),request.custKey,request.mode]).sort(),
    [[2026,'37',533,'major'],[2026,'38',533,'major'],[2026,'39',533,'major']]);
  assert.equal(managementRequests.length,3,'startup reads three management totals via GET');
  assert.deepEqual(managementRequests.map(request=>[request.year,request.majorWeek,request.custKey,request.byDate,request.itemsOnly]).sort(),
    [[2026,'37',533,'1','1'],[2026,'38',533,'1','1'],[2026,'39',533,'1','1']]);
  assert.ok(calls.some(call=>call.path==='/api/estimate/weekday-baseline'&&call.method==='GET'));
  assert.equal(calls.filter(call=>call.path==='/api/estimate/weekday-note'&&call.method==='GET').length,3);
  for(const product of hiddenProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(product.ProdName,{exact:true}).count(),0,`${product.ProdName} must be hidden from the table`);
  assert.match(await page.locator('.weekday-cycle-matrix').innerText(),/품목 50\/50 · 출고 없음 4개 숨김/);
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.wcm-table-scroll table').getBoundingClientRect().width,visibleRows:[...document.querySelectorAll('.wcm-table-scroll tbody tr')].filter(row=>row.getBoundingClientRect().bottom<=innerHeight).length,rowHeight:document.querySelector('.wcm-table-scroll tbody tr').getBoundingClientRect().height,bodyTop:document.querySelector('.wcm-table-scroll tbody').getBoundingClientRect().top,deltaButtonHeight:document.querySelector('.wcm-change-note').getBoundingClientRect().height,deltaButtonMinHeight:getComputedStyle(document.querySelector('.wcm-change-note')).minHeight}));
  assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert.ok(dimensions.documentWidth<=1921);
  assert.equal(Math.round(await page.locator('.wcm-product-col').evaluate(el=>el.getBoundingClientRect().width)),260);
  assert.ok(dimensions.tableWidth>=3032,'readable columns scroll inside the table instead of shrinking fonts');
  assert.ok(dimensions.visibleRows>=18,JSON.stringify(dimensions));
  assert.equal(await page.locator('.wcm-number-display').first().evaluate(el=>getComputedStyle(el).fontSize),'13px');
  assert.equal(await page.locator('.wcm-number-display').first().evaluate(el=>getComputedStyle(el).fontWeight),'600');
  assert.equal(await page.locator('.weekday-cycle-matrix').evaluate(el=>getComputedStyle(el).color),'rgb(15, 23, 42)');
  await page.getByRole('button',{name:'현재 38차 보기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.wcm-table-scroll').scrollLeft>800);
  await page.getByRole('button',{name:'이전 37차 보기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.wcm-table-scroll').scrollLeft<10);
  const hoverRow=page.locator('.wcm-table-scroll tbody tr').first();
  await hoverRow.locator('th').hover();
  assert.ok((await hoverRow.locator('th,td').evaluateAll(els=>els.map(el=>getComputedStyle(el).boxShadow))).every(value=>value!=='none'),'entire row including sticky product highlighted');
  assert.equal(await page.getByRole('button',{name:/^\d+차 . 견적 출력$/}).count(),21);
  await page.screenshot({path:path.join(output,'1920x1080-top.png')});
  const search=page.getByPlaceholder('품목명 / 품목키');
  await search.fill('존재하지 않는 품목');
  assert.match(await page.locator('.wcm-table-scroll tbody').innerText(),/검색\/품종 조건에 맞는 품목이 없습니다/);
  await search.fill('');
  await page.locator('.wcm-toolbar select').selectOption('장미');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),25);
  await page.locator('.wcm-toolbar select').selectOption('');
  const manuallyAdded=hiddenProducts.find(product=>product.ProdKey===151);
  await page.getByRole('button',{name:'품목 추가',exact:true}).click();
  const picker=page.getByRole('region',{name:'품목 추가 검색'});
  await picker.getByLabel('추가할 품목').fill(manuallyAdded.ProdName);
  await picker.getByRole('button',{name:'검색',exact:true}).click();
  const candidateButton=picker.getByRole('button',{name:new RegExp(manuallyAdded.ProdName)});
  await candidateButton.click();
  await page.getByRole('status').filter({hasText:'품목을 표에 추가했습니다'}).waitFor();
  assert.equal(await picker.count(),0);
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),51);
  const addedRow=page.locator('.wcm-table-scroll tbody tr').filter({hasText:manuallyAdded.ProdName});
  assert.equal(await addedRow.count(),1);
  assert.equal(await addedRow.locator('.wcm-total').nth(3).locator(':scope > span').innerText(),'0');
  // The current quote helper returns 0 for no matching saved quote; failed/unverified reads use —.
  assert.match((await addedRow.locator('.wcm-total').nth(3).innerText()).replace(/\s/g,''),/합0Δ—견/);
  assert.match(await page.locator('.weekday-cycle-matrix').innerText(),/품목 51\/51 · 출고 없음 3개 숨김/);
  for(const product of activeProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(productLabel(product),{exact:true}).count(),1);
  for(const product of hiddenProducts.filter(product=>product.ProdKey!==151))assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(product.ProdName,{exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'1920x1080-product-added.png')});
  assert.ok(comparisonRequests.every(request=>!request.prodKeys.includes(905)),'905 was not part of inventory/hidden-product refresh');
  assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(newCustomerProduct.ProdName,{exact:true}).count(),0);
  await page.getByRole('button',{name:'품목 추가',exact:true}).click();
  await picker.getByLabel('추가할 품목').fill(newCustomerProduct.ProdName);
  await picker.getByRole('button',{name:'검색',exact:true}).click();
  await picker.getByRole('button',{name:new RegExp(newCustomerProduct.ProdName)}).click();
  await page.getByRole('status').filter({hasText:'품목을 표에 추가했습니다'}).waitFor();
  assert.equal(await picker.count(),0);
  const newRequest=comparisonRequests.find(request=>request.prodKeys.includes(905));
  assert.ok(newRequest,'adding a new-to-customer candidate must explicitly request its ERP comparison');
  assert.equal(newRequest.year,2026);assert.equal(newRequest.custKey,533);
  assert.ok(newRequest.prodKeys.includes(151),'refresh preserves previously added product');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),52);
  const newRow=page.locator('.wcm-table-scroll tbody tr').filter({hasText:newCustomerProduct.ProdName});
  assert.equal(await newRow.count(),1);
  assert.equal(await newRow.locator('.wcm-total').nth(3).locator(':scope > span').innerText(),'—','no initial baseline stays unknown, not fabricated zero');
  assert.match(await newRow.locator('.wcm-total').nth(3).getAttribute('title'),/전산 미확인/);
  const newCell=page.getByLabel(`${newCustomerProduct.ProdName} 2026/38-01 2026-09-17 미적용 초안 수량`,{exact:true});
  assert.equal(await newCell.isEnabled(),true,'known unit enables the manually added blank row');
  assert.equal(await newCell.inputValue(),'');
  await newCell.fill('2.5');await newCell.press('Enter');
  await page.getByRole('status').filter({hasText:'요일 수량 초안을 기록했습니다'}).waitFor();
  assert.equal(await newCell.inputValue(),'2.5');
  assert.equal(await newCell.locator('..').locator('.wcm-number-display').evaluate(el=>getComputedStyle(el).color),'rgb(23, 78, 156)','browser draft remains visibly blue even when its numeric input is not focused');
  assert.match(await newRow.locator('.wcm-total').nth(3).getAttribute('title'),/전산 미확인 \/ 미적용 초안 2\.5 박스/);
  assert.match(await page.locator('.weekday-cycle-matrix').innerText(),/품목 52\/52 · 출고 없음 3개 숨김/);
  await page.getByRole('button',{name:'선택 칸 내역 닫기'}).click();
  await page.screenshot({path:path.join(output,'1920x1080-new-customer-product-draft.png')});
  const cell=page.getByLabel('CARNATION 품목 02 2026/38-01 2026-09-17 미적용 초안 수량',{exact:true});
  const editedRow=cell.locator('xpath=ancestor::tr');
  await cell.fill('1');await cell.press('Enter');
  assert.equal(await editedRow.locator('.wcm-total').nth(2).locator(':scope > span').innerText(),'1','decrease2→1 immediately changes01 residual');
  assert.equal(await editedRow.locator('.wcm-total').nth(3).locator(':scope > span').innerText(),'1','major residual changes too');
  assert.equal(await editedRow.locator('.wcm-remainder-status').nth(2).innerText(),'미확정·초안');
  await cell.fill('0');await cell.press('Enter');
  await page.getByRole('status').filter({hasText:'요일 수량 초안을 기록했습니다'}).waitFor();
  assert.equal(await cell.inputValue(),'0');
  assert.equal(await editedRow.locator('.wcm-total').nth(2).locator(':scope > span').innerText(),'2');
  const numberBounds=await cell.locator('..').evaluate(el=>{const a=el.querySelector('.wcm-number-display').getBoundingClientRect(),b=el.querySelector('.wcm-cell-info').getBoundingClientRect();return {numberBottom:a.bottom,buttonTop:b.top,numberWidth:a.width,cellWidth:el.clientWidth};});
  assert.ok(numberBounds.numberBottom<=numberBounds.buttonTop+1,'quantity and delta never overlap');
  await page.getByRole('button',{name:'선택 칸 내역 닫기'}).click();
  await page.getByRole('button',{name:'CARNATION 품목 02 2026-09-17 수량 내역',exact:true}).click();
  await page.getByRole('status').filter({hasText:'전산 2 / 미적용 초안 0'}).waitFor();
  await page.getByRole('button',{name:'선택 칸 내역 닫기'}).click();
  await page.getByRole('button',{name:'38차 목 견적 출력',exact:true}).click();
  await page.getByRole('dialog',{name:'요일 견적서 인쇄 미리보기'}).waitFor();
  await page.locator('.weekday-print-overlay').click({position:{x:4,y:4}});
  assert.equal(await page.getByRole('dialog',{name:'요일 견적서 인쇄 미리보기'}).isVisible(),true,'backdrop click must not invoke an unrelated close/save action');
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
  const explicitPrints=printRequests.filter(request=>request.mode==='dates');
  assert.deepEqual(explicitPrints.map(request=>request.dates),[['2026-09-17'],['2026-09-17','2026-09-22']]);
  assert.ok(explicitPrints.every(request=>request.year===2026&&Number(request.majorWeek)===38&&request.custKey===533));
  failPrint=true;
  await page.getByRole('button',{name:'38차 목 견적 출력',exact:true}).click();
  await page.getByRole('status').filter({hasText:'fixture 견적 출력 실패'}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'요일 견적서 인쇄 미리보기'}).count(),0);
  await page.setViewportSize({width:1280,height:800});
  const narrow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,inner:innerWidth,overflow:document.querySelector('.wcm-table-scroll').scrollWidth>document.querySelector('.wcm-table-scroll').clientWidth}));
  assert.ok(narrow.width<=1281);assert.equal(narrow.overflow,true);
  await page.screenshot({path:path.join(output,'1280x800-table.png')});
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),52,'manual zero/new-customer additions survive later edits/printing');
  assert.match((await addedRow.locator('.wcm-total').nth(3).innerText()).replace(/\s/g,''),/합0Δ—견/);
  assert.equal(await newRow.count(),1);
  assert.equal(await newCell.inputValue(),'2.5','positive browser-only draft remains after printing');
  for(const product of activeProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(productLabel(product),{exact:true}).count(),1);
  await page.setViewportSize({width:1920,height:1080});
  failComparison=true;
  await page.getByRole('button',{name:'전산 새로고침',exact:true}).click();
  await page.getByRole('status').filter({hasText:'fixture 전산 대조 실패'}).waitFor();
  assert.equal(await newCell.inputValue(),'2.5','failed readonly refresh preserves browser draft');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),52);
  for(const suffix of ['01','02']) {
    await page.getByRole('button',{name:`2026/38-${suffix} 최초분배 확정`,exact:true}).click();
    const confirmation=page.getByRole('dialog',{name:'최초분배 기준 확정'});
    await confirmation.waitFor();
    await page.locator('.weekday-print-overlay').click({position:{x:4,y:4}});
    assert.equal(await confirmation.isVisible(),true,'baseline backdrop click cannot accidentally confirm or dismiss');
    assert.match(await confirmation.innerText(),/파란 미적용 초안과 업로드 수량은 포함하지 않습니다/);
    await confirmation.getByRole('button',{name:'최초 기준 확정',exact:true}).click();
    await confirmation.waitFor({state:'hidden'});
    const confirmed=page.getByRole('button',{name:`2026/38-${suffix} 최초분배 확정`,exact:true});
    assert.ok(await confirmed.count()===0||await confirmed.isDisabled(),'confirmed baseline cannot be confirmed again');
    assert.match(await page.locator('thead .wcm-initial').filter({hasText:`38-${suffix}`}).innerText(),/기준 보관됨/);
  }
  assert.deepEqual(baselineRequests.filter(request=>request.action==='confirm').map(request=>request.orderWeek),['38-01','38-02']);
  assert.ok(baselineRecords.every(record=>record.source==='ERP_DISTRIBUTION'));
  assert.equal(baselineRecords[0].rows.find(row=>row.prodKey===102).quantity,2,'browser draft zero is excluded from ERP initial quantity');
  const savedBaselines=structuredClone(baselineRecords);
  alstroChanged=true;
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.deepEqual(baselineRecords,savedBaselines,'reload never overwrites initial ERP baseline');
  for(const suffix of ['01','02']) {
    const confirmed=page.getByRole('button',{name:`2026/38-${suffix} 최초분배 확정`,exact:true});
    assert.ok(await confirmed.count()===0||await confirmed.isDisabled(),'reload must not re-enable an immutable confirmed baseline');
  }
  const alstroCell=page.getByLabel('ALSTROEMERIA 품목 01 2026/38-01 2026-09-17 미적용 초안 수량',{exact:true});
  const changedCell=alstroCell.locator('..');
  assert.equal(await alstroCell.inputValue(),'48');
  assert.match(await changedCell.getAttribute('class'),/wcm-changed/);
  assert.equal(await changedCell.locator('.wcm-number-display').innerText(),'48(3)');
  assert.equal(await changedCell.locator('.wcm-original').innerText(),'(32(2))');
  const alstroRow=page.locator('.wcm-table-scroll tbody tr').filter({has:page.getByText('품목 01',{exact:true})});
  assert.equal(await alstroRow.locator('.wcm-initial').nth(2).innerText(),'32(2)');
  assert.match(await alstroRow.locator('.wcm-quote').nth(1).getAttribute('title'),/견 1280 · 견적 일치/);
  await changedCell.hover();
  assert.equal(await changedCell.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 240, 179)','hover preserves changed yellow');
  await page.getByRole('button',{name:'ALSTROEMERIA 품목 01 2026/38차 변경 비고',exact:true}).click();
  const notePopup=page.getByRole('dialog',{name:'수량 변경 비고'});
  await notePopup.waitFor();
  const popupBounds=await notePopup.evaluate(el=>{const rect=el.getBoundingClientRect();return {position:getComputedStyle(el).position,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight};});
  assert.equal(popupBounds.position,'fixed');
  assert.ok(popupBounds.left>=0&&popupBounds.top>=0&&popupBounds.right<=popupBounds.width&&popupBounds.bottom<=popupBounds.height);
  await page.setViewportSize({width:1280,height:800});
  const narrowPopup=await notePopup.evaluate(el=>{const rect=el.getBoundingClientRect();return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight};});
  assert.ok(narrowPopup.left>=0&&narrowPopup.top>=0&&narrowPopup.right<=narrowPopup.width&&narrowPopup.bottom<=narrowPopup.height,'floating note popup remains inside 1280 viewport');
  assert.ok(await notePopup.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'manual source inputs do not overflow the floating note width');
  await page.screenshot({path:path.join(output,'1280x800-note-popup.png')});
  await page.setViewportSize({width:1920,height:1080});
  assert.match(await notePopup.innerText(),/담당자가 확인한 수량만 표시/);
  await page.locator('.wcm-table-scroll caption').click();
  assert.equal(await notePopup.isVisible(),true,'floating note remains available after clicking outside it');
  await notePopup.getByLabel('수량 변경 비고 내용').fill('fixture 담당자 확인: 39차 물량 선출고');
  await notePopup.getByLabel('선출고 물량 차수').fill('39-01');
  await notePopup.getByRole('button',{name:'비고 저장',exact:true}).click();
  await notePopup.getByRole('alert').filter({hasText:'선출고는 날짜·물량 차수·양수 수량을 모두 입력하세요'}).waitFor();
  assert.equal(noteRequests.length,0,'incomplete manual source stays local and is not saved');
  await notePopup.getByLabel('선출고 출고일').selectOption('2026-09-17');
  await notePopup.getByLabel('선출고 물량 연도').fill('2026');
  await notePopup.getByLabel('선출고 물량 차수').fill('39-01');
  await notePopup.getByLabel('선출고 수량').fill('16');
  failNote=true;
  await notePopup.getByRole('button',{name:'비고 저장',exact:true}).click();
  await notePopup.getByRole('alert').filter({hasText:'fixture 비고 저장 실패'}).waitFor();
  assert.equal(await notePopup.getByLabel('선출고 수량').inputValue(),'16','failed save preserves manual quantity');
  assert.equal(noteRecords.length,0,'failed save cannot appear as persisted');
  await page.screenshot({path:path.join(output,'1920x1080-note-error.png')});
  await notePopup.getByRole('button',{name:'비고 저장',exact:true}).click();
  await page.getByRole('status').filter({hasText:'담당자 선출고 확인을 저장했습니다'}).waitFor();
  assert.deepEqual(noteRequests[0].earlyShipment,{date:'2026-09-17',sourceYear:2026,sourceOrderWeek:'39-01',quantity:16,unit:'단',confirmation:'MANUAL_USER_DECLARATION'});
  await notePopup.getByRole('button',{name:'비고창 닫기'}).click();
  assert.match(await changedCell.getAttribute('class'),/wcm-early/);
  assert.equal(await changedCell.locator('.wcm-early-label').innerText(),'39차 선출고 16(1)');
  await changedCell.locator('.wcm-early-label').click();
  await notePopup.waitFor();
  assert.equal(await notePopup.getByLabel('수량 변경 비고 내용').inputValue(),'fixture 담당자 확인: 39차 물량 선출고','saved note label opens the floating preview');
  await notePopup.getByRole('button',{name:'비고창 닫기'}).click();
  await page.screenshot({path:path.join(output,'1920x1080-baseline-note.png')});
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.equal(await changedCell.locator('.wcm-early-label').innerText(),'39차 선출고 16(1)','note GET restores manual declaration');
  assert.deepEqual(baselineRecords,savedBaselines);
  assert.equal(baselineRequests.filter(request=>request.action==='confirm').length,2,'reload and note saving never auto-confirm');
  assert.equal(noteRequests.length,2,'one failed save plus one explicit retry; reload only reads');
  alstroOverride=8;
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.match(await changedCell.locator('.wcm-early-label').innerText(),/39차 선출고 16\(1\) · 재확인/,'saved manual source is flagged if the real date quantity subsequently drops below it');
  assert.deepEqual(baselineRecords,savedBaselines);
  assert.equal(noteRequests.length,2,'stale source display does not auto rewrite the note');
  failBaselineWeek='37-01';
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.match(await page.locator('thead .wcm-initial').filter({hasText:'37-01'}).innerText(),/조회 실패/);
  const failedPreviewRow=page.locator('.wcm-table-scroll tbody tr').filter({hasText:productLabel(activeProducts[0])});
  assert.equal(await failedPreviewRow.locator('.wcm-initial').nth(0).innerText(),'—','failed refresh clears the old provisional value');
  assert.equal(await failedPreviewRow.locator('.wcm-initial').nth(1).innerText(),'32(2)','other provisional scope remains available');
  assert.equal(await failedPreviewRow.locator('.wcm-initial').nth(2).innerText(),'32(2)','immutable stored value survives other-scope failure');
  failBaselineWeek=null;
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
  assert.equal(await failedPreviewRow.locator('.wcm-initial').nth(0).innerText(),'32(2)','explicit refresh restores the valid preview');
  assert.equal(baselineRequests.filter(request=>request.action==='confirm').length,2);
  // Calendar fixture intentionally returns the same cycles; assert exact requested target inputs.
  for(const [button,major] of [['이전 차수를 중심으로',37],['다음 차수를 중심으로',39]]) {
    const response=page.waitForResponse(result=>new URL(result.url()).pathname==='/api/estimate/weekday-calendar'
      &&Number(new URL(result.url()).searchParams.get('majorWeek'))===major);
    await page.getByRole('button',{name:button,exact:true}).click();await response;
    await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('button[aria-label="다음 차수를 중심으로"]').disabled);
    assert.equal(await page.getByLabel('조회 연도').inputValue(),'2026');
    assert.equal(await page.getByLabel('중심 차수',{exact:true}).inputValue(),String(major));
    assert.deepEqual(calendarRequests.at(-1),{year:2026,majorWeek:major});
  }
  assert.deepEqual(errors,[]);
  assert.ok(calls.every(call=>!/(?:apply|fix|save|adjust)/.test(call.path)));
  assert.ok(calls.every(call=>call.method==='GET'||call.method==='POST'
    && ['/api/estimate/weekday-compare','/api/estimate/weekday-print','/api/estimate/weekday-baseline','/api/estimate/weekday-note'].includes(call.path)),JSON.stringify(calls));
  assert.ok(calls.some(call=>call.path==='/api/products/search'&&call.method==='GET'));
  assert.ok(calls.filter(call=>call.path==='/api/estimate/weekday-compare').length>=3,'manual adds reload readonly comparison');
  console.log(JSON.stringify({pass:true,viewport:'1920x1080',zoom:'100%',cycleColumns:33,productWidth:260,prefixStrippedLabels:true,startupManagementRequests:3,managementRequests:managementRequests.length,activeProducts:activeProducts.length,initialHiddenProducts:hiddenProducts.length,manualZeroProduct:151,newCustomerProduct:905,newCustomerDraft:2.5,visibleProductsAfterAdd:52,hiddenProductsAfterAdd:3,baselineConfirmations:baselineRecords.length,manualSource:'2026/39-01',changedQuantity:'48(3)',calendarRequests,dimensions,fonts,narrow,errors,noErpWrites:true,fixtureOnly:true,output}));
} catch(error) {await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'console-errors.json'),JSON.stringify(consoleErrors,null,2));throw error;}
finally{await browser.close();}
