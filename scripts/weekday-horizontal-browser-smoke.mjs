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
const activeProducts=Array.from({length:50},(_,i)=>({ProdKey:i+101,ProdName:`CARNATION 품목 ${String(i+1).padStart(2,'0')}`}));
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
const output=path.resolve('output/weekday-horizontal');fs.mkdirSync(output,{recursive:true});
await page.route('**/api/**',async route=>{
  const req=route.request();const url=new URL(req.url());calls.push({path:url.pathname,method:req.method()});
  let data={success:true};
  if(url.pathname==='/api/auth/me')data.user={userId:'fixture',userName:'검사',authority:3};
  else if(url.pathname==='/api/favorites')data.favorites=[];
  else if(url.pathname==='/api/customers/search')data.customers=[{CustKey:533,CustName:'주광농원'}];
  else if(url.pathname==='/api/products/search')data.products=[{ProdKey:151,ProdName:hiddenProducts.find(product=>product.ProdKey===151).ProdName,FlowerName:'카네이션',OutUnit:'박스'},newCustomerProduct]
    .filter(product=>product.ProdName.includes(url.searchParams.get('q')||''));
  else if(url.pathname==='/api/estimate/weekday-calendar')data={success:true,readOnly:true,cycles};
  else if(url.pathname==='/api/estimate/weekday-products')data.products=inventoryProducts;
  else if(url.pathname==='/api/estimate/weekday-compare') {
    const body=req.postDataJSON();
    comparisonRequests.push(body);
    data={success:true,readOnly:true,history:[],sourceLots:[],rows:body.orderWeeks.flatMap(orderWeek=>body.prodKeys.map(prodKey=>{
      const cycle=cycles.find(row=>row.majorWeek===orderWeek.slice(0,2));
      const date=cycle.days[orderWeek.endsWith('01')?0:4].date;
      if(prodKey===newCustomerProduct.ProdKey)return {year:2026,orderWeek,custKey:533,prodKey,prodName:newCustomerProduct.ProdName,
        flowerName:newCustomerProduct.FlowerName,outUnit:newCustomerProduct.OutUnit,fixed:false,state:'NO_SHIPMENT',
        orderOutQuantity:null,orderEstQuantity:null,shipmentOutQuantity:null,shipmentDates:[]};
      const hidden=hiddenProducts.find(product=>product.ProdKey===prodKey);
      if(hidden)return {year:2026,orderWeek,custKey:533,prodKey,prodName:hidden.ProdName,flowerName:'카네이션',outUnit:'박스',fixed:false,
        state:prodKey===901?'NO_SHIPMENT':'UNFIXED_REVIEW_REQUIRED',orderOutQuantity:800,orderEstQuantity:900,
        shipmentOutQuantity:hidden.shipmentOutQuantity,shipmentDates:hidden.shipmentDates.map(item=>({...item,date}))};
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
  for(const product of activeProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(product.ProdName,{exact:true}).count(),1);
  for(const product of hiddenProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(product.ProdName,{exact:true}).count(),0,`${product.ProdName} must be hidden from the table`);
  assert.match(await page.locator('.weekday-cycle-matrix').innerText(),/품목 50\/50 · 출고 없음 4개 숨김/);
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.wcm-table-scroll table').getBoundingClientRect().width,visibleRows:[...document.querySelectorAll('.wcm-table-scroll tbody tr')].filter(row=>row.getBoundingClientRect().bottom<=innerHeight).length}));
  assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert.ok(dimensions.documentWidth<=1921);
  assert.ok(dimensions.tableWidth<=1905);assert.ok(dimensions.visibleRows>=24,JSON.stringify(dimensions));
  assert.equal(await page.getByRole('button',{name:/^\d+차 . 견적 출력$/}).count(),21);
  await page.screenshot({path:path.join(output,'1920x1080-top.png')});
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
  assert.match(await addedRow.locator('.wcm-total').nth(1).innerText(),/^0$/);
  assert.match(await page.locator('.weekday-cycle-matrix').innerText(),/품목 51\/51 · 출고 없음 3개 숨김/);
  for(const product of activeProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(product.ProdName,{exact:true}).count(),1);
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
  assert.match(await newRow.locator('.wcm-total').nth(1).innerText(),/^—$/,'no shipment stays unknown, not fabricated zero');
  const newCell=page.getByLabel(`${newCustomerProduct.ProdName} 2026/38-01 2026-09-17 미적용 초안 수량`,{exact:true});
  assert.equal(await newCell.isEnabled(),true,'known unit enables the manually added blank row');
  assert.equal(await newCell.inputValue(),'');
  await newCell.fill('2.5');await newCell.press('Enter');
  await page.getByRole('status').filter({hasText:'요일 수량 초안을 기록했습니다'}).waitFor();
  assert.equal(await newCell.inputValue(),'2.5');
  assert.match(await newRow.locator('.wcm-total').nth(1).getAttribute('title'),/전산 미확인 \/ 미적용 초안 2\.5 박스/);
  assert.match(await page.locator('.weekday-cycle-matrix').innerText(),/품목 52\/52 · 출고 없음 3개 숨김/);
  await page.getByRole('button',{name:'선택 칸 내역 닫기'}).click();
  await page.screenshot({path:path.join(output,'1920x1080-new-customer-product-draft.png')});
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
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(),52,'manual zero/new-customer additions survive later edits/printing');
  assert.match(await addedRow.locator('.wcm-total').nth(1).innerText(),/^0$/);
  assert.equal(await newRow.count(),1);
  assert.equal(await newCell.inputValue(),'2.5','positive browser-only draft remains after printing');
  for(const product of activeProducts)assert.equal(await page.locator('.wcm-table-scroll tbody').getByText(product.ProdName,{exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  assert.ok(calls.every(call=>!/(?:apply|fix|save|adjust)/.test(call.path)));
  assert.ok(calls.every(call=>call.method==='GET'||call.method==='POST'
    && ['/api/estimate/weekday-compare','/api/estimate/weekday-print'].includes(call.path)),JSON.stringify(calls));
  assert.ok(calls.some(call=>call.path==='/api/products/search'&&call.method==='GET'));
  assert.ok(calls.filter(call=>call.path==='/api/estimate/weekday-compare').length>=3,'manual adds reload readonly comparison');
  console.log(JSON.stringify({pass:true,viewport:'1920x1080',zoom:'100%',activeProducts:activeProducts.length,initialHiddenProducts:hiddenProducts.length,manualZeroProduct:151,newCustomerProduct:905,newCustomerDraft:2.5,visibleProductsAfterAdd:52,hiddenProductsAfterAdd:3,dimensions,fonts,narrow,errors,noErpWrites:true,output}));
} catch(error) {await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'console-errors.json'),JSON.stringify(consoleErrors,null,2));throw error;}
finally{await browser.close();}
