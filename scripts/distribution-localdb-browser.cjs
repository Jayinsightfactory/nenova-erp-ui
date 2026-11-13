const assert=require('node:assert/strict');
module.exports=async function verifyBrowser(rq,sql,refresh,pool){
 const db={query:rq,sql,withTransaction:async fn=>{const tx=new sql.Transaction(pool);await tx.begin();try{const out=await fn(require('./test-weekday-distribution-sql.cjs').tQuery(tx));await tx.commit();return out;}catch(e){await tx.rollback();throw e;}}};
 const realSave=require('./load-isolated-erp-api.cjs')('pages/api/shipment/distribute.js',db);
 const realOrders=require('./load-isolated-erp-api.cjs')('pages/api/orders/index.js',db);
 if(!process.env.LOCALDB_BROWSER_BASE)throw Error('LOCALDB_BROWSER_BASE required for full refresh verification');
 const base=process.env.LOCALDB_BROWSER_BASE;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
 const {chromium}=require('playwright');const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});let saves=0;
  await require('./test-weekday-distribution-sql.cjs').convertShipmentDateToIdentity(pool);
  await rq("IF COL_LENGTH('Product','Descr') IS NULL ALTER TABLE Product ADD Descr nvarchar(1000) NULL;");
  await rq("IF COL_LENGTH('PeriodDay','WeekStartYmd') IS NULL ALTER TABLE PeriodDay ADD WeekStartYmd date NULL,WeekEndYmd date NULL;");
  await rq("UPDATE PeriodDay SET WeekStartYmd='2026-09-09',WeekEndYmd='2026-09-16';UPDATE Customer SET BaseOutDay=5 WHERE CustKey IN(534,535)");
  await rq("INSERT PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay,WeekStartYmd,WeekEndYmd) VALUES(90,N'202637','2026-09-12',7,'2026-09-09','2026-09-16')");
  await rq('UPDATE ShipmentDetail SET OutQuantity=0,BoxQuantity=0,BunchQuantity=0,SteamQuantity=0,EstQuantity=0 WHERE SdetailKey IN(534,535)');
  await rq('UPDATE ShipmentDetail SET isFix=0 WHERE SdetailKey IN(534,535);UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey IN(534,535);UPDATE StockMaster SET isFix=0');
  await rq('DELETE ShipmentDate WHERE SdetailKey IN(534,535);DELETE ShipmentDetail WHERE SdetailKey IN(534,535);DELETE ShipmentMaster WHERE ShipmentKey IN(534,535);DELETE OrderDetail WHERE OrderMasterKey IN(534,535)');
  const product={ProdKey:866,ProdName:'Fixture Carnation',CounName:'미국',FlowerName:'더글라스',CountryFlower:'미국더글라스',OutUnit:'박스',EstUnit:'단',BunchOf1Box:30,SteamOf1Box:30,SteamOf1Bunch:1,Cost:100};
  await context.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url()),type=u.searchParams.get('type');let d={success:true,configs:[],data:[],rows:[],favorites:[],products:[],groups:[],customers:[],scopes:[]};
   if(u.pathname==='/api/auth/me')d.user={userId:'fixture-user',authority:2};
   if(u.pathname==='/api/kakao/order-feed')d={ok:true,blocks:[]};
   if(u.pathname==='/api/master/customers')d.data=[{CustKey:534,CustName:'Fixture 534'},{CustKey:535,CustName:'Fixture 535'}];
   if(u.pathname==='/api/orders'&&req.method()==='POST'){
    let status=200;const res={status(code){status=code;return this;},json(body){d=body;return this;},setHeader(){}};
    await realOrders({method:'POST',body:JSON.parse(req.postData()),query:{},headers:{},user:{userId:'fixture-user',userName:'Fixture User',authority:2}},res);
    console.log('real orders response',status,JSON.stringify(d));assert.ok(status<300);assert.equal(d.success,true);
   }
   if(type==='groups')d.groups=[{key:'미국::더글라스',country:'미국',flower:'더글라스',label:'미국더글라스'}];
   if(type==='products'||type==='productCatalog')d.products=[product];
   if(type==='custDist')d.customers=(await rq('SELECT sd.CustKey,c.CustName,sd.OutQuantity 출고수량,od.OutQuantity 주문수량,sd.Cost FROM ShipmentDetail sd JOIN Customer c ON c.CustKey=sd.CustKey JOIN OrderDetail od ON od.OrderMasterKey=sd.CustKey WHERE sd.CustKey IN(534,535) AND sd.ProdKey=866 ORDER BY sd.CustKey')).recordset;
   if(u.pathname==='/api/shipment/distribute'&&req.method()==='POST'){
    const b=JSON.parse(req.postData());assert.equal(b.year,'2026');assert.equal(b.week,'2026-37-01');
    assert.deepEqual(b.entries.map(e=>[e.custKey,e.outQty]),[[534,5],[535,7]]);saves++;
    let status=200;const res={status(code){status=code;return this;},json(body){d=body;return this;},setHeader(){}};
    await realSave({method:'POST',body:b,query:{},headers:{},user:{userId:'fixture-user',userName:'Fixture User',authority:2}},res);
    console.log('real save response',status,JSON.stringify(d));assert.equal(status,200);assert.equal(d.verified,true);
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  });
  const page=await context.newPage();
  const open=async()=>{
   await page.goto(base+'/shipment/distribute?popup=1');
   const week=page.getByPlaceholder(/YYYY-WW-SS|^\d{4}-\d{2}-\d{2}$/).first();await week.fill('2026-37-01');await week.press('Tab');await page.getByRole('button',{name:'🔍 조회',exact:true}).click();
   const countries=page.getByRole('button',{name:'국가 전체 보기',exact:true});if(await countries.count())await countries.click();
   const country=page.locator('[data-ai-verify="country-select-미국"]');await country.waitFor();await country.click();
   await page.locator('[data-ai-verify="family-toggle-미국::더글라스"]').click();
   await page.locator('[data-ai-verify="product-866"]').click();await page.getByText('Fixture Carnation — 거래처 분배 정보',{exact:true}).waitFor();
  };
  await open();await page.locator('[data-ai-verify="prod-add-cust-open"]').click();
  for(const key of [534,535]){await page.getByRole('textbox',{name:'업체추가 업체명 검색',exact:true}).fill(String(key));await page.locator(`[data-ai-verify="prod-add-cust-${key}"]`).click();}
  await page.locator('[data-ai-verify="qty-534-866"]').fill('5');await page.locator('[data-ai-verify="qty-535-866"]').fill('7');
  await page.getByRole('button',{name:'💾 저장 / Guardar',exact:true}).click();await page.getByRole('dialog',{name:'출고 분배 저장 완료',exact:true}).waitFor();assert.equal(saves,1);
  await page.getByRole('dialog',{name:'출고 분배 저장 완료',exact:true}).getByRole('button',{name:'확인',exact:true}).click();
  await open();assert.equal(await page.locator('[data-ai-verify="qty-534-866"]').inputValue(),'5');assert.equal(await page.locator('[data-ai-verify="qty-535-866"]').inputValue(),'7');
  console.log('PASS actual Chrome save once -> fixture SQL writes -> new page GET from SQL retains 5/7');
  await rq(`INSERT dbo.WebErpEditLease(OrderYear,OrderWeek,CustKey,LeaseToken,OwnerUserId,OwnerName,ClientId,PageCode,BaselineDigest,Revision,ExpiresAt) VALUES(N'2026',N'37',534,N'foreign-token',N'other-user',N'Fixture Other',N'other-client',N'estimate',N'unchanged-presence',0,DATEADD(minute,5,SYSUTCDATETIME()))`);
  const single=async(outQty,expected)=>{let status=200,data;await realSave({method:'POST',query:{},headers:{},body:{week:'2026-37-01',year:'2026',source:'distribution-workspace',entries:[{custKey:534,prodKey:866,outQty,cost:100,expected}]},user:{userId:'fixture-user',authority:2}},{status(n){status=n;return this},json(v){data=v;return this},setHeader(){}});return {status,data};};
  assert.equal((await single(6,{outQty:5,cost:100})).data.verified,true,'foreign broad estimate presence cannot block row-CAS distribution');
  const stale=await single(7,{outQty:5,cost:100});assert.equal(stale.status,409);assert.equal(stale.data.code,'DISTRIBUTION_STALE');
  assert.equal(Number((await rq('SELECT OutQuantity FROM ShipmentDetail WHERE CustKey=534 AND ProdKey=866')).recordset[0].OutQuantity),6);
  const missing=await single(7,null);assert.equal(missing.status,400);
  assert.equal((await single(5,{outQty:6,cost:100})).data.verified,true);
  assert.equal((await rq("SELECT BaselineDigest FROM WebErpEditLease WHERE CustKey=534")).recordset[0].BaselineDigest.trim(),'unchanged-presence');
  await open();assert.equal(await page.locator('[data-ai-verify="qty-534-866"]').inputValue(),'5');
  console.log('PASS real production API with another estimate lease: field CAS saves unchanged baseline; stale409/missing400 rolls back; lease preserved; reload persists');

 }finally{await browser.close();}
};
