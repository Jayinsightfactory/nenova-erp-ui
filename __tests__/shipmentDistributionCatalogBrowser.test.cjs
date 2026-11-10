const {test}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('playwright');const {spawn}=require('node:child_process');const path=require('node:path');
test('US products without orders/shipments are searchable in both years', {timeout:120000},async()=>{
 const root=path.resolve(__dirname,'..'),port=39319,base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','-p',String(port)],{cwd:root,windowsHide:true,stdio:'ignore'});let browser;
 try{for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080}});let writes=0;const posted=[];
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),type=url.searchParams.get('type');if(req.method()!=='GET'){writes++;posted.push({path:url.pathname,body:req.postDataJSON()});}
 let data={success:true,verified:true};if(url.pathname==='/api/auth/me')data.user={userId:'fixture'};
 if(type==='groups')data.groups=[{key:'콜롬비아::장미',label:'콜롬비아장미',country:'콜롬비아',flower:'장미'},{key:'미국::더글라스',label:'미국더글라스',country:'미국',flower:'더글라스'},{key:'미국::레몬잎',label:'미국레몬잎',country:'미국',flower:'레몬잎'}];
 if(type==='products')data.products=[];
 if(type==='productCatalog')data.products=[{ProdKey:2,ProdName:'Douglas',CounName:'미국',FlowerName:'더글라스',OutUnit:'박스',EstUnit:'단',BunchOf1Box:20,SteamOf1Box:200,SteamOf1Bunch:10},{ProdKey:3,ProdName:'Lemon leaf',CounName:'미국',FlowerName:'레몬잎'}];
 if(type==='productCatalog')data.products.push(...Array.from({length:100},(_,i)=>({ProdKey:10000+i,ProdName:'AAAA '+String(i).padStart(3,'0'),CounName:'프랑스'})));
 if(type==='custList' || type==='custDist'){data.customers=[];data.totalOut=0;}
 if(url.pathname==='/api/master/customers')data.data=[{CustKey:777,CustName:'연습업체',Manager:'연습담당자'}];
 if(url.pathname==='/api/favorites')data.favorites=[];
 await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`${base}/shipment/distribute`);const input=page.getByPlaceholder(/^\d{4}-\d{2}-\d{2}$|YYYY-WW-SS/).first();
 for(const year of [2025,2026]){await input.fill(`${year}-45-03`);await input.press('Tab');await page.getByRole('button',{name:'🔍 조회'}).click();assert.equal(await page.locator('[data-product-select]').count(),0);
 assert.equal(await page.locator('[data-ai-verify="group-미국더글라스"]').count(),1);assert.equal(await page.locator('[data-ai-verify="group-미국레몬잎"]').count(),1);
 assert.equal(await page.getByRole('group',{name:'미국 품종',exact:true}).getByRole('button',{name:'콜롬비아장미',exact:true}).count(),0);
 await page.getByTestId('distribution-product-picker').locator('button').first().click();
 await page.getByText(/전체 102개 중 80개 표시/).waitFor();
 await page.getByRole('textbox',{name:'품목 검색',exact:true}).fill('Douglas');
 await page.getByRole('group',{name:'품목 선택',exact:true}).getByRole('button',{name:/Douglas/}).click();
 await page.locator('[data-ai-verify="prod-add-cust-open"]').waitFor();
 const search=page.getByPlaceholder('품목·국가·품종 검색 (전체 품목)');await search.fill('미국');await page.getByRole('button',{name:'Douglas 선택',exact:true}).waitFor();await page.getByRole('button',{name:'Lemon leaf 선택',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Rose 선택',exact:true}).count(),0);
 await page.getByRole('button',{name:'Douglas 선택',exact:true}).click();
 await page.locator('[data-ai-verify="prod-add-cust-open"]').waitFor();
 if (!(await page.locator('[data-ai-verify="prod-add-cust-search"]').isVisible())) await page.locator('[data-ai-verify="prod-add-cust-open"]').click();
 await page.locator('[data-ai-verify="prod-add-cust-search"]').fill('연습');
 await page.locator('[data-ai-verify="prod-add-cust-777"]').click();
 await page.locator('[data-ai-verify="qty-777-2"]').waitFor();

 await search.fill('레몬잎');assert.equal(await page.getByRole('button',{name:'Douglas 선택',exact:true}).count(),0);await search.fill('no-match');assert.equal(await page.locator('[data-product-select]').count(),0);await search.fill('');assert.equal(await page.locator('[data-product-select]').count(),0);assert.equal(await page.getByRole('button',{name:'Douglas 선택',exact:true}).count(),0);
 }assert.equal(writes,0);await page.locator('[data-ai-verify="qty-777-2"]').fill('2');await page.keyboard.press('Control+s');await page.getByRole('dialog',{name:'출고 분배 저장 완료'}).waitFor();assert.deepEqual(posted.map(x=>x.path),['/api/orders','/api/shipment/distribute']);assert.equal(posted[0].body.week,'2026-45-03');assert.equal(posted[0].body.year,'2026');assert.equal(posted[0].body.items[0].qty,2);assert.equal(posted[1].body.entries[0].outQty,2);await page.getByRole('dialog',{name:'출고 분배 저장 완료'}).getByRole('button',{name:'확인',exact:true}).click();await page.screenshot({path:path.join(root,'outputs/country-1920.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.getByPlaceholder('품목·국가·품종 검색 (전체 품목)').fill('미국');await page.getByRole('button',{name:'Douglas 선택',exact:true}).waitFor();await page.screenshot({path:path.join(root,'outputs/country-390.png'),fullPage:true});
 }finally{await browser?.close();server.kill();}
});
