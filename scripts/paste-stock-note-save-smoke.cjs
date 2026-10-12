// Isolated full-page fixture: no production favorites, mappings or ERP writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),favorites=[],writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const products=[['Carnation Moon Light','문라이트',71],['Carnation Novia fixture','',12],['Carnation Ikebana','이케바나',95]].map(([ProdName,DisplayName,ProdKey])=>({ProdKey,ProdName,DisplayName,CounName:'콜롬비아',FlowerName:'카네이션',OutUnit:'박스',EstUnit:'박스',isDeleted:false}));
  await page.addInitScript(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'검증',authority:1})));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());let data={success:true,data:[],rows:[],items:[],operations:[],applications:[],mappings:{},favorites:[],hasMore:false};
   if(url.pathname.endsWith('/auth/me'))data={success:true,user:{userId:'fixture',userName:'검증',authority:1,accountActive:true}};
   if(url.pathname.endsWith('/orders/weeks'))data={success:true,weeks:['2026-41-01']};
   if(url.pathname==='/api/master')data={success:true,data:url.searchParams.get('entity')==='products'?products:[]};
   if(url.pathname.endsWith('/sales-feed'))data={ok:true,messages:[],hasMore:false,nextAfterKey:null};
   if(url.pathname.endsWith('/favorites')){
    if(req.method()==='POST'){const body=req.postDataJSON();favorites.push({FavoriteKey:123,FavName:body.name,FilterData:body.filterData});data={success:true,favoriteKey:123};}
    else data={success:true,favorites};
   }
   if(req.method()!=='GET'&&!url.pathname.endsWith('/favorites')&&!url.pathname.endsWith('/orders/mappings')&&!url.pathname.endsWith('/distribution-live-history'))writes.push(url.pathname);
   await route.fulfill({json:data});
  });
  await page.goto(process.argv[2]||'http://localhost:3226/orders/paste?popup=1');
  await page.waitForFunction(()=>document.querySelector('[data-testid="sales-inbox-refresh-cadence"]')?.textContent.includes('새 카톡'));
  await page.getByTestId('base-stock-input').fill('문라이트 1\n수동확인품목 1\n이케바나 1');
  await page.getByTestId('stock-base-week').fill('2026-41-01');
  await page.getByRole('button',{name:'현재 값 저장',exact:true}).click();
  const dialog=page.getByTestId('stock-note-match-dialog');await dialog.waitFor();
  await page.waitForTimeout(400);assert.equal(favorites.length,0,'incomplete match never saves');
  await page.getByTestId('stock-note-save-cancel').press('Escape');
  await dialog.waitFor({state:'hidden'});assert.equal(favorites.length,0,'Escape cancels without saving');
  await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='현재 값 저장');
  assert.equal(await page.getByRole('button',{name:'현재 값 저장',exact:true}).evaluate(node=>node===document.activeElement),true,'Escape returns focus to invoking save button');
  await page.getByRole('button',{name:'현재 값 저장',exact:true}).click();await dialog.waitFor();
  await dialog.getByRole('button',{name:/품목지정/}).nth(1).click();
  await dialog.getByPlaceholder('품명 검색...').fill('Novia');
  await dialog.getByRole('button',{name:/Carnation Novia fixture/}).first().press('Enter');
  await page.waitForFunction(()=>document.body.innerText.includes('재조회 확인:'));
  assert.equal(favorites.length,1);const saved=JSON.parse(favorites[0].FilterData);
  assert.equal(saved.baseStockText,'문라이트 1\n수동확인품목 1\n이케바나 1');assert.equal(saved.baseStockMatches.length,3);
  assert(saved.baseStockMatches.every(row=>Number(row.prodKey)>0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync('outputs/stock-note-smoke',{recursive:true});await page.screenshot({path:'outputs/stock-note-smoke/1920.png'});
  await page.setViewportSize({width:1366,height:768});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:'1920x1080 / 1366x768',incompleteBlocksSave:true,escapeCancels:true,allMatchedSavesOnce:true,rawNamesPreserved:true,erpWrites:writes,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
