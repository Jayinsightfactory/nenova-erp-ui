import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildHorizontalWeekdayMatrix,hasHorizontalShipmentQuantity,weekdayProductLabel,weekdayQuantityLabel} from '../lib/weekdayHorizontalMatrix.js';
import {reconcileWeekdayQuote} from '../lib/weekdayQuoteReconciliation.js';
const base='https://nenovaweb.com';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
assert.ok(process.env.SMOKE_USER&&process.env.SMOKE_PASSWORD,'Auth must come from environment, never repository');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const output=path.resolve('output/weekday-horizontal-live');fs.mkdirSync(output,{recursive:true});
try {
  const login=await context.request.post(`${base}/api/auth/login`,{data:{userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASSWORD}});
  assert.equal(login.status(),200);assert.equal((await login.json()).success,true);
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const comparisonResponses=[];
  const baselineResponses=[];
  const noteResponses=[];
  const startupQuoteResponses=[];
  const managementResponses=[];
  page.on('response',response=>{
    const pathname=new URL(response.url()).pathname;
    if(pathname==='/api/estimate/weekday-compare')comparisonResponses.push(response.json());
    if(pathname==='/api/estimate/weekday-baseline'&&response.request().method()==='GET')baselineResponses.push(response.json());
    if(pathname==='/api/estimate/weekday-note'&&response.request().method()==='GET')noteResponses.push(response.json());
    if(pathname==='/api/estimate/weekday-print') {
      const scope=response.request().postDataJSON();
      startupQuoteResponses.push(response.json().then(result=>({scope,result})));
    }
    if(pathname==='/api/estimate'&&response.request().method()==='GET') {
      const params=new URL(response.url()).searchParams;
      if(params.get('byDate')==='1'&&params.get('itemsOnly')==='1') {
        const scope={year:Number(params.get('year')),majorWeek:params.get('week'),custKey:Number(params.get('custKey')),
          byDate:params.get('byDate'),itemsOnly:params.get('itemsOnly')};
        managementResponses.push(response.json().then(result=>({scope,result})));
      }
    }
  });
  const writes=[];
  const readonlyPostPaths=new Set(['/api/estimate/weekday-compare','/api/estimate/weekday-print']);
  const isTelemetry=pathname=>/^\/api\/(?:replay(?:\/|$)|action-log(?:\/|$))/.test(pathname);
  // A baseline preview is also POST; deliberately do NOT whitelist it or any note write.
  await page.route('**/api/**',async route=>{
    const req=route.request();const pathname=new URL(req.url()).pathname;
    if(!['GET','HEAD'].includes(req.method())&&!readonlyPostPaths.has(pathname)&&!isTelemetry(pathname)) {
      writes.push({path:pathname,method:req.method()});return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor({timeout:60000});
  assert.match(await page.locator('.weekday-workspace > header').innerText(),/주광농원/);
  assert.equal(await page.locator('.wcm-table-scroll table').count(),1);
  assert.equal(await page.locator('.wcm-table-scroll colgroup col').count(),34,'product + union of 33 cycle columns');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').first().locator('td').count(),33);
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-total').count(),6);
  assert.equal(Math.round(await page.locator('.wcm-product-col').evaluate(el=>el.getBoundingClientRect().width)),260);
  const rows=await page.locator('.wcm-table-scroll tbody tr').count();assert.ok(rows>1);
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.wcm-table-scroll table').getBoundingClientRect().width,visibleRows:[...document.querySelectorAll('.wcm-table-scroll tbody tr')].filter(row=>row.getBoundingClientRect().bottom<=innerHeight).length}));
  assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert.ok(dimensions.documentWidth<=1921);
  await page.screenshot({path:path.join(output,'production-1920x1080.png')});
  const calendar=await (await context.request.get(`${base}/api/estimate/weekday-calendar?year=2026&majorWeek=38`)).json();
  const comparisons=(await Promise.all(comparisonResponses)).flatMap(result=>result.rows||[]);
  const baselineResults=await Promise.all(baselineResponses);
  assert.ok(baselineResults.length>0,'startup must read the private baseline GET route');
  for(const result of baselineResults) {assert.equal(result.success,true);assert.equal(result.readOnly,true);assert.ok(Array.isArray(result.baselines));}
  const baselines=baselineResults.flatMap(result=>result.baselines);
  assert.ok(baselines.every(record=>record.source==='ERP_DISTRIBUTION'&&record.custKey===533));
  const notes=await Promise.all(noteResponses);
  assert.equal(notes.length,3,'startup must read three page-note scopes via GET');
  assert.ok(notes.every(result=>result.success===true&&result.readOnly===true));
  const startupQuotes=await Promise.all(startupQuoteResponses);
  assert.equal(startupQuotes.length,3,'three saved quote reads are expected at startup, not user print actions');
  assert.ok(startupQuotes.every(({scope,result})=>scope.mode==='major'&&scope.custKey===533&&result.success===true&&result.readOnly===true));
  const managementResults=await Promise.all(managementResponses);
  assert.equal(managementResults.length,3,'three management GET requests must include byDate=1 and itemsOnly=1');
  assert.ok(managementResults.every(({scope,result})=>scope.year===2026&&scope.custKey===533
    &&scope.byDate==='1'&&scope.itemsOnly==='1'&&result.success===true&&Array.isArray(result.items)));
  const rawMatrix=buildHorizontalWeekdayMatrix(calendar.cycles,[],comparisons,baselines);
  const expectedRows=rawMatrix.rows.filter(hasHorizontalShipmentQuantity);
  assert.equal(rows,expectedRows.length,'Positive current shipment or retained positive baseline products are visible');
  assert.ok(rows<rawMatrix.rows.length,'Live order-only/zero rows are hidden, not removed from ERP sources');
  assert.equal(await page.locator('.wcm-table-scroll tbody th').count(),expectedRows.length);
  for(const [index,row] of expectedRows.entries()) {
    const tableRow=page.locator('.wcm-table-scroll tbody tr').nth(index);
    assert.equal(await tableRow.locator('.wcm-product-name').innerText(),weekdayProductLabel(row),`Missing prefix-stripped product ${row.prodKey}`);
    assert.match(await tableRow.locator('th').getAttribute('title'),new RegExp(`품목 ${row.prodKey}(?:\\n|$)`));
    assert.ok((await tableRow.locator('th').getAttribute('title')).includes(row.name),'original product identity remains in tooltip');
    for(const [blockIndex,block] of row.blocks.entries()) {
      for(const [suffixIndex,initial] of [block.initial01,block.initial02].entries()) {
        assert.equal(await tableRow.locator('.wcm-initial').nth(blockIndex*2+suffixIndex).innerText(),weekdayQuantityLabel(initial?.quantity,row,block.unit));
      }
      const quoteResult=startupQuotes.find(({scope})=>Number(scope.year)===Number(block.cycle.year)&&String(scope.majorWeek)===String(block.cycle.majorWeek));
      assert.ok(quoteResult,'quote read uses this exact calendar scope');
      const management=managementResults.find(({scope})=>Number(scope.year)===Number(block.cycle.year)&&String(scope.majorWeek)===String(block.cycle.majorWeek));
      assert.ok(management,'management read uses the same year/major/customer business scope');
      const quote=reconcileWeekdayQuote(block,row.prodKey,{year:quoteResult.scope.year,majorWeek:quoteResult.scope.majorWeek,
        items:quoteResult.result.items,managementItems:management.result.items});
      const expectedQuote=`견 ${quote.managementQuantity??quote.netQuantity??'—'}${quote.state==='견적 일치'?' ✓':quote.state==='견적 불일치'?' !':''}`;
      assert.equal(await tableRow.locator('.wcm-quote').nth(blockIndex).innerText(),expectedQuote);
    }
  }
  for(const cycle of calendar.cycles) {
    for(const suffix of ['01','02']) {
      const saved=baselines.some(record=>record.year===Number(cycle.year)&&record.orderWeek===`${cycle.majorWeek}-${suffix}`);
      const button=page.getByRole('button',{name:`${cycle.year}/${cycle.majorWeek}-${suffix} 최초분배 확정`,exact:true});
      if(saved)assert.ok(await button.count()===0||await button.isDisabled(),'already confirmed baseline has no enabled action');
      else assert.equal(await button.count(),1,'unconfirmed baseline exposes its button without invoking it');
    }
  }
  assert.equal(await page.getByRole('button',{name:'이전 차수를 중심으로',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'다음 차수를 중심으로',exact:true}).count(),1);
  assert.match(await page.locator('.wcm-toolbar').innerText(),new RegExp(`출고 없음 ${rawMatrix.rows.length-rows}개 숨김`));
  const current=calendar.cycles.find(row=>row.offset===0);
  const majorResponse=await context.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'major'}});
  const major=await majorResponse.json();assert.equal(majorResponse.status(),200,JSON.stringify(major));assert.equal(major.readOnly,true);
  const baselinePreviewResponse=await context.request.post(`${base}/api/estimate/weekday-baseline`,{data:{action:'preview',year:current.year,orderWeek:current.days[0].orderWeek,custKey:533}});
  const baselinePreview=await baselinePreviewResponse.json();
  assert.equal(baselinePreviewResponse.status(),200,JSON.stringify(baselinePreview));assert.equal(baselinePreview.readOnly,true);
  assert.equal(baselinePreview.preview.year,current.year);assert.equal(baselinePreview.preview.orderWeek,current.days[0].orderWeek);
  assert.equal(baselinePreview.preview.custKey,533);assert.match(baselinePreview.preview.digest,/^[a-f0-9]{64}$/);
  assert.ok(baselinePreview.preview.rows.every(row=>row.prodKey>0&&Number.isFinite(row.quantity)&&row.quantity>=0));
  let dailyRows=0;
  for(const day of current.days) {
    const response=await context.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'dates',dates:[day.date]}});
    const result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));assert.equal(result.draftIncluded,false);dailyRows+=result.items.length;
  }
  const invalid=await context.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'dates',dates:[calendar.cycles[2].days[0].date]}});
  assert.equal(invalid.status(),409);
  const missingYear=await context.request.get(`${base}/api/estimate/weekday-products?custKey=533&orderWeeks=38-01`);assert.equal(missingYear.status(),400);
  const unauth=await browser.newContext();assert.equal((await unauth.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'major'}})).status(),401);await unauth.close();
  await page.getByRole('button',{name:'전체 견적',exact:true}).nth(1).click();
  if(major.items.length) {
    await page.getByRole('dialog').waitFor();const frame=page.frameLocator('iframe[title="전산 확정 견적서"]');
    await frame.locator('.item-table tbody td').first().waitFor();
    assert.equal(await frame.locator('.item-table tbody td').first().evaluate(el=>getComputedStyle(el).fontSize),'10.6667px');
    await page.screenshot({path:path.join(output,'production-print-1920x1080.png')});
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
  }
  const centerMoves=[];
  for(const [label,target] of [['이전 차수를 중심으로',calendar.cycles.find(row=>row.offset===-1)],
    ['다음 차수를 중심으로',current],['다음 차수를 중심으로',calendar.cycles.find(row=>row.offset===1)],
    ['이전 차수를 중심으로',current]]) {
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/estimate/weekday-calendar'
      &&Number(new URL(response.url()).searchParams.get('year'))===target.year
      &&Number(new URL(response.url()).searchParams.get('majorWeek'))===Number(target.majorWeek));
    await page.getByRole('button',{name:label,exact:true}).click();await loaded;
    await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor({timeout:60000});
    assert.equal(await page.getByLabel('조회 연도').inputValue(),String(target.year));
    assert.equal(await page.getByLabel('중심 차수',{exact:true}).inputValue(),String(target.majorWeek));
    assert.match(await page.locator('.wcm-current-head').innerText(),new RegExp(`${target.year} / ${target.majorWeek}차`));
    centerMoves.push(`${target.year}/${target.majorWeek}`);
  }
  await page.setViewportSize({width:1280,height:800});
  const narrow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,inner:innerWidth,
    overflow:document.querySelector('.wcm-table-scroll').scrollWidth>document.querySelector('.wcm-table-scroll').clientWidth}));
  assert.ok(narrow.width<=1281);assert.equal(narrow.overflow,true);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({livePass:true,viewport:'1920x1080',zoom:'100%',cycleColumns:33,productWidth:260,prefixStrippedLabels:true,rows,sourceRows:rawMatrix.rows.length,hiddenRows:rawMatrix.rows.length-rows,baselineRecords:baselines.length,baselineGetResponses:baselineResults.length,baselinePreviewRows:baselinePreview.preview.rows.length,noteGetResponses:notes.length,startupQuoteRequests:startupQuotes.length,managementGetRequests:managementResults.length,centerMoves,dimensions,narrow,majorPrintRows:major.items.length,dailyPrintRows:dailyRows,errors,noErpWrites:true,noBaselineOrNoteWrites:true}));
} finally{await browser.close();}
