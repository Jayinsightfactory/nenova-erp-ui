const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
const page=await browser.newPage({viewport:{width:1920,height:1080}}),history=[],mutations=[],errors=[];
const raw='43-1 콜 카네이션 변경사항\n주광\n문라이트 1추가\n노비아 1취소';
let feedFailure=false;
const messages=[{source:'nenovakakao',chat_id:'fixture',external_message_id:'1',message:raw,created_at:new Date().toISOString()},{source:'nenovakakao',chat_id:'fixture',external_message_id:'2',message:'2025-43-1 변경사항\n주광\n문라이트 1추가',created_at:new Date(Date.now()-1000).toISOString()}];
page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'검증',authority:1})));
await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data={success:true,items:[],data:[],rows:[],favorites:[]};
if(url.pathname==='/api/auth/me')data={success:true,user:{userId:'fixture',userName:'검증',authority:1,accountActive:true}};
if(url.pathname==='/api/kakao/sales-feed'&&feedFailure){await route.fulfill({status:503,json:{error:'fixture unavailable'}});return;}
if(url.pathname==='/api/kakao/sales-feed')data={ok:true,messages,hasMore:false,nextAfterKey:null};
if(url.pathname==='/api/orders/distribution-live-history'){const body=req.postDataJSON();history.push(body);data={success:true,erpAction:'NONE',scope:{year:body.year,weeks:[body.week],from:body.from,to:body.to},asOf:new Date().toISOString(),balanceComparison:{products:[]},items:body.messages.map(m=>({sourceIdentity:m.identity,requests:[{id:m.identity+':1',customerText:'주광',productText:'문라이트',reason:'테스트 이력',orderEvents:[{eventId:'order1',before:0,after:1,unit:'박스',changeAt:'검증시각'}],shipmentEvents:[]}]}))};}
else if(req.method()!=='GET')mutations.push(url.pathname);
await route.fulfill({json:data});});
await page.goto(process.argv[2]||'http://localhost:3240/orders/kakao-stock');await page.getByRole('heading',{name:'영업방 원문 · 최신 전산이력',exact:true}).waitFor();
await page.getByLabel('연도·차수',{exact:true}).fill('2026-43-01');await page.getByText('주문 0 → 1 박스 · 검증시각',{exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'선택 원문 분석 → 적용 확인',exact:true}).isEnabled(),false);
await page.getByLabel('시작재고 입력',{exact:true}).fill('문라이트 3\n노비아 2');await page.getByRole('button',{name:'시작재고 적용·수정',exact:true}).click();
await page.getByLabel('업체',{exact:true}).fill('주광');await page.locator('form select').nth(0).selectOption('노비아');await page.locator('form select').nth(1).selectOption('BASELINE');await page.getByLabel('수량',{exact:true}).fill('1');await page.getByRole('button',{name:'재고장에 적용',exact:true}).click();
await page.getByRole('button',{name:'선택 원문 분석 → 적용 확인',exact:true}).click();assert.equal(await page.getByLabel('카톡 원문',{exact:true}).inputValue(),raw);await page.getByRole('button',{name:'확인한 변경 적용',exact:true}).click();assert.equal(await page.getByLabel('복사 미리보기').inputValue(),'문라이트 2 시작3 주광 0>1(3>2)\n노비아 2 시작2 주광 1>0(1>2)');
await page.getByLabel('영업방 원문 검색').fill('2025');await page.getByRole('radio',{name:'원문 선택 nenovakakao|fixture|2',exact:true}).check();await page.getByText('원문 차수 2025-43-01 · 재고장 2026-43-01',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'선택 원문 분석 → 적용 확인',exact:true}).isEnabled(),false);
await page.waitForFunction(()=>document.querySelector('.selected-history .paste-erp-evidence')?.textContent.includes('검증시각'));assert(history.some(b=>b.year==='2025'&&b.week==='43-01'));
await page.getByLabel('영업방 원문 검색').fill('');await page.getByRole('radio',{name:'원문 선택 nenovakakao|fixture|1',exact:true}).check();assert.equal(await page.getByRole('button',{name:'이 재고장에 적용한 원문',exact:true}).isEnabled(),false);
feedFailure=true;await page.getByRole('button',{name:'영업방 새로고침',exact:true}).click();await page.getByRole('status').filter({hasText:'조회 실패:'}).waitFor();assert.equal(await page.getByLabel('카톡 원문',{exact:true}).inputValue(),raw);assert.equal(await page.getByRole('radio',{name:'원문 선택 nenovakakao|fixture|1',exact:true}).isChecked(),true);
feedFailure=false;await page.getByRole('button',{name:'영업방 새로고침',exact:true}).click();await page.getByRole('status').filter({hasText:'확인 · 2건'}).waitFor();await page.locator('.stock-inbox').screenshot({path:'kakao-stock-inbox-preview.png'});
await page.getByLabel('영업방 원문 검색').click();await page.screenshot({path:'kakao-stock-inbox-desktop.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'kakao-stock-inbox-mobile.png',fullPage:true});
assert.deepEqual(errors,[]);assert.deepEqual(mutations.filter(p=>!['/api/user-activity','/api/replay','/api/log'].some(a=>p.startsWith(a))),[]);console.log('PASS visible inbox/history, automatic read, source-select/analyze/apply, duplicate block, exact prior-year history, mobile, no ERP mutations');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
