const assert=require('node:assert/strict');
module.exports=async function verifyBrowser(rq,sql,refresh,pool){
 const db={query:rq,sql,withTransaction:async fn=>{const tx=new sql.Transaction(pool);await tx.begin();try{const out=await fn(require('./test-weekday-distribution-sql.cjs').tQuery(tx));await tx.commit();return out;}catch(e){await tx.rollback();throw e;}}};
 const realSave=require('./load-isolated-erp-api.cjs')('pages/api/shipment/distribute.js',db);
 const realOrders=require('./load-isolated-erp-api.cjs')('pages/api/orders/index.js',db);
 if(!process.env.LOCALDB_BROWSER_BASE)throw Error('LOCALDB_BROWSER_BASE required for full refresh verification');
 const base=process.env.LOCALDB_BROWSER_BASE;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
 const {chromium}=require('playwright');const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});let saves=0;const keys=Array.from({length:8},(_,i)=>534+i);const scope=keys.join(',');
  await require('./test-weekday-distribution-sql.cjs').convertShipmentDateToIdentity(pool);
  await rq("IF COL_LENGTH('Product','Descr') IS NULL ALTER TABLE Product ADD Descr nvarchar(1000) NULL;");
  await rq("IF COL_LENGTH('PeriodDay','WeekStartYmd') IS NULL ALTER TABLE PeriodDay ADD WeekStartYmd date NULL,WeekEndYmd date NULL;");
  await rq(`UPDATE PeriodDay SET WeekStartYmd='2026-09-09',WeekEndYmd='2026-09-16';UPDATE Customer SET BaseOutDay=5 WHERE CustKey IN(${scope})`);
  await rq("INSERT PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay,WeekStartYmd,WeekEndYmd) VALUES(90,N'202637','2026-09-12',7,'2026-09-09','2026-09-16')");
  await rq(`UPDATE ShipmentDetail SET OutQuantity=0,BoxQuantity=0,BunchQuantity=0,SteamQuantity=0,EstQuantity=0 WHERE SdetailKey IN(${scope})`);
  await rq(`UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey IN(${scope});UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey IN(${scope});UPDATE StockMaster SET isFix=0`);
  await rq(`DELETE ShipmentDate WHERE SdetailKey IN(${scope});DELETE ShipmentDetail WHERE SdetailKey IN(${scope});DELETE ShipmentMaster WHERE ShipmentKey IN(${scope});DELETE OrderDetail WHERE OrderMasterKey IN(${scope})`);
  const product={ProdKey:866,ProdName:'Fixture Carnation',CounName:'미국',FlowerName:'더글라스',CountryFlower:'미국더글라스',OutUnit:'박스',EstUnit:'단',BunchOf1Box:30,SteamOf1Box:30,SteamOf1Bunch:1,Cost:100};
  await context.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url()),type=u.searchParams.get('type');let d={success:true,configs:[],data:[],rows:[],favorites:[],products:[],groups:[],customers:[],scopes:[]};
   if(u.pathname==='/api/auth/me')d.user={userId:'fixture-user',authority:2};
   if(u.pathname==='/api/kakao/order-feed')d={ok:true,blocks:[]};
   if(u.pathname==='/api/master/customers')d.data=keys.map(CustKey=>({CustKey,CustName:'Fixture '+CustKey}));
   if(u.pathname==='/api/orders'&&req.method()==='POST'){
    let status=200;const res={status(code){status=code;return this;},json(body){d=body;return this;},setHeader(){}};
    await realOrders({method:'POST',body:JSON.parse(req.postData()),query:{},headers:{},user:{userId:'fixture-user',userName:'Fixture User',authority:2}},res);
    console.log('real orders response',status,JSON.stringify(d));assert.ok(status<300);assert.equal(d.success,true);
   }
   if(type==='customers'||type==='workspaceCustomers')d.customers=keys.map(CustKey=>({CustKey,CustName:'Fixture '+CustKey,OrderCode:'F'+CustKey}));
   if(type==='custItems'){const key=Number(u.searchParams.get('custKey'));const rows=(await rq(`SELECT sd.OutQuantity,sd.Cost,sd.SdetailKey,od.OutQuantity OrderQty FROM ShipmentDetail sd LEFT JOIN OrderDetail od ON od.OrderMasterKey=sd.CustKey AND od.ProdKey=sd.ProdKey WHERE sd.CustKey=${key} AND sd.ProdKey=866`)).recordset;d.items=rows.length?[{...product,주문수량:rows[0].OrderQty||0,출고수량:rows[0].OutQuantity||0,Cost:100}]:[];await new Promise(r=>setTimeout(r,(542-key)*45));}
   if(type==='groups')d.groups=[{key:'미국::더글라스',country:'미국',flower:'더글라스',label:'미국더글라스'}];
   if(type==='products'||type==='productCatalog')d.products=[product];
   if(u.pathname==='/api/shipment/distribute'&&req.method()==='POST'){
    const b=JSON.parse(req.postData());assert.equal(b.year,'2026');assert.equal(b.week,'2026-37-01');
    assert.deepEqual(b.entries.map(e=>[e.custKey,e.outQty]),keys.map((key,i)=>[key,i+1]));saves++;
    let status=200;const res={status(code){status=code;return this;},json(body){d=body;return this;},setHeader(){}};
    await realSave({method:'POST',body:b,query:{},headers:{},user:{userId:'fixture-user',userName:'Fixture User',authority:2}},res);
    console.log('real save response',status,JSON.stringify(d));assert.equal(status,200);assert.equal(d.verified,true);
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{
   await page.goto(base+'/shipment/distribute?popup=1');
   const week=page.getByPlaceholder(/YYYY-WW-SS|^\d{4}-\d{2}-\d{2}$/).first();await week.fill('2026-37-01');await week.press('Tab');await page.getByRole('button',{name:'🔍 조회',exact:true}).click();
   await page.getByRole('button',{name:/출고분배 및 업체정보/}).click();
   await page.locator('[data-ai-verify="customer-534"]').waitFor();
   await page.locator('[data-ai-verify="customer-append-mode"]').click();
   for(const key of keys)await page.locator(`[data-ai-verify="customer-${key}"]`).click();
   await page.getByPlaceholder('품목명 검색 (전체 품목)').fill('Fixture');
   await page.locator('[data-ai-verify="qty-541-866"]').waitFor();
   assert.equal(await page.locator('[data-testid="distribution-pair-cust-header"] th[data-ai-verify]').count(),8);
   assert.equal(await page.locator('[data-ai-verify^="move-to"]').count(),0);
  };
  await open();assert.equal(await page.locator('[data-ai-verify="customer-show-dates"]').isChecked(),true);
  await page.locator('[data-ai-verify="customer-show-dates"]').uncheck();
  for(const [i,key] of keys.entries())await page.locator(`[data-ai-verify="qty-${key}-866"]`).fill(String(i+1));
  await page.locator('[data-ai-verify="customer-show-dates"]').check();
  await page.locator('[data-ai-verify="customer-show-dates"]').uncheck();
  for(const [i,key] of keys.entries())assert.equal(await page.locator(`[data-ai-verify="qty-${key}-866"]`).inputValue(),String(i+1));
  await page.getByRole('button',{name:'💾 저장 / Guardar',exact:true}).click();await page.getByRole('dialog',{name:'출고 분배 저장 완료',exact:true}).waitFor();assert.equal(saves,1);
  await page.getByRole('dialog',{name:'출고 분배 저장 완료',exact:true}).getByRole('button',{name:'확인',exact:true}).click();
  await open();for(const [i,key] of keys.entries())assert.equal(await page.locator(`[data-ai-verify="qty-${key}-866"]`).inputValue(),String(i+1));
  assert.deepEqual(errors,[]);console.log('PASS 8 customers, reverse read completion, date toggle retains drafts, actual orders + production save API commits once, full reload retains all 8');
 }finally{await browser.close();}
};
