const assert=require('node:assert/strict');
module.exports=async function verifyBrowser(rq,sql,refresh){
 if(!process.env.LOCALDB_BROWSER_BASE)throw Error('LOCALDB_BROWSER_BASE required for full refresh verification');
 const base=process.env.LOCALDB_BROWSER_BASE;assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
 const {chromium}=require('playwright');const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});let saves=0;
  await rq('UPDATE ShipmentDetail SET OutQuantity=0,BoxQuantity=0,BunchQuantity=0,SteamQuantity=0,EstQuantity=0 WHERE SdetailKey IN(534,535)');
  const product={ProdKey:866,ProdName:'Fixture Carnation',CounName:'미국',FlowerName:'더글라스',CountryFlower:'미국더글라스',OutUnit:'박스',EstUnit:'단',BunchOf1Box:30,SteamOf1Box:30,SteamOf1Bunch:1,Cost:100};
  await context.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url()),type=u.searchParams.get('type');let d={success:true,configs:[],data:[],rows:[],favorites:[],products:[],groups:[],customers:[],scopes:[]};
   if(u.pathname==='/api/auth/me')d.user={userId:'fixture-user',authority:2};
   if(type==='groups')d.groups=[{key:'미국::더글라스',country:'미국',flower:'더글라스',label:'미국더글라스'}];
   if(type==='products'||type==='productCatalog')d.products=[product];
   if(type==='custDist')d.customers=(await rq('SELECT sd.CustKey,c.CustName,sd.OutQuantity 출고수량,od.OutQuantity 주문수량,sd.Cost FROM ShipmentDetail sd JOIN Customer c ON c.CustKey=sd.CustKey JOIN OrderDetail od ON od.OrderMasterKey=sd.CustKey WHERE sd.SdetailKey IN(534,535) ORDER BY sd.CustKey')).recordset;
   if(u.pathname==='/api/shipment/distribute'&&req.method()==='POST'){
    const b=JSON.parse(req.postData());assert.equal(b.year,'2026');assert.equal(b.week,'2026-37-01');
    assert.deepEqual(b.entries.map(e=>[e.custKey,e.outQty]),[[534,5],[535,7]]);saves++;
    for(const e of b.entries){assert.ok([534,535].includes(e.custKey));const n=Number(e.outQty);assert.ok(n===5||n===7);
     await rq(`UPDATE ShipmentDetail SET OutQuantity=${n},BoxQuantity=${n},BunchQuantity=${n*30},SteamQuantity=${n*30},EstQuantity=${n*30} WHERE SdetailKey=${e.custKey}`);
     await refresh(rq,e.custKey,sql);
    }d={success:true,verified:true};
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
   await page.locator('[data-ai-verify="product-866"]').click();await page.locator('[data-ai-verify="qty-534-866"]').waitFor();
  };
  await open();await page.locator('[data-ai-verify="qty-534-866"]').fill('5');await page.locator('[data-ai-verify="qty-535-866"]').fill('7');
  await page.getByRole('button',{name:'💾 저장 / Guardar',exact:true}).click();await page.getByRole('dialog',{name:'출고 분배 저장 완료',exact:true}).waitFor();assert.equal(saves,1);
  await page.getByRole('dialog',{name:'출고 분배 저장 완료',exact:true}).getByRole('button',{name:'확인',exact:true}).click();
  await open();assert.equal(await page.locator('[data-ai-verify="qty-534-866"]').inputValue(),'5');assert.equal(await page.locator('[data-ai-verify="qty-535-866"]').inputValue(),'7');
  console.log('PASS actual Chrome save once -> fixture SQL writes -> new page GET from SQL retains 5/7');
 }finally{await browser.close();}
};
