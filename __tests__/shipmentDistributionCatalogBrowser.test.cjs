const {test}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('playwright');const {spawn}=require('node:child_process');const path=require('node:path');
test('US products without orders/shipments are searchable in both years', {timeout:120000},async()=>{
 const root=path.resolve(__dirname,'..'),port=39319,base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','-p',String(port)],{cwd:root,windowsHide:true,stdio:'ignore'});let browser;
 try{for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080}});let writes=0;
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),type=url.searchParams.get('type');if(req.method()!=='GET')writes++;
 let data={success:true};if(url.pathname==='/api/auth/me')data.user={userId:'fixture'};
 if(type==='groups')data.groups=[{key:'미국::더글라스',label:'미국더글라스',country:'미국',flower:'더글라스'},{key:'미국::레몬잎',label:'미국레몬잎',country:'미국',flower:'레몬잎'}];
 if(type==='products')data.products=[{ProdKey:1,ProdName:'Rose',CounName:'콜롬비아',FlowerName:'장미',OutUnit:'박스',outQty:3}];
 if(type==='productCatalog')data.products=[{ProdKey:2,ProdName:'Douglas',CounName:'미국',FlowerName:'더글라스'},{ProdKey:3,ProdName:'Lemon leaf',CounName:'미국',FlowerName:'레몬잎'}];
 if(type==='custList')data.customers=[];
 if(url.pathname==='/api/favorites')data.favorites=[];
 await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`${base}/shipment/distribute`);const input=page.getByPlaceholder(/^\d{4}-\d{2}-\d{2}$|YYYY-WW-SS/).first();
 for(const year of [2025,2026]){await input.fill(`${year}-46-01`);await input.press('Tab');await page.getByRole('button',{name:'🔍 조회'}).click();await page.getByRole('button',{name:'Rose 선택',exact:true}).waitFor();
 assert.equal(await page.locator('[data-ai-verify="group-미국더글라스"]').count(),1);assert.equal(await page.locator('[data-ai-verify="group-미국레몬잎"]').count(),1);
 const search=page.getByPlaceholder('품목·국가·품종 검색 (전체 품목)');await search.fill('미국');await page.getByRole('button',{name:'Douglas 선택',exact:true}).waitFor();await page.getByRole('button',{name:'Lemon leaf 선택',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Rose 선택',exact:true}).count(),0);
 await search.fill('레몬잎');assert.equal(await page.getByRole('button',{name:'Douglas 선택',exact:true}).count(),0);await search.fill('no-match');assert.equal(await page.locator('[data-product-select]').count(),0);await search.fill('');await page.getByRole('button',{name:'Rose 선택',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Douglas 선택',exact:true}).count(),0);
 }assert.equal(writes,0);await page.setViewportSize({width:390,height:844});await page.getByPlaceholder('품목·국가·품종 검색 (전체 품목)').fill('미국');await page.getByRole('button',{name:'Douglas 선택',exact:true}).waitFor();
 }finally{await browser?.close();server.kill();}
});
