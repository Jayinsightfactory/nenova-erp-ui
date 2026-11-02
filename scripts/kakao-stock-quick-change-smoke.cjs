const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage(),writes=[],errors=[];let salesReads=0;
await page.addInitScript(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'검증',authority:1})));
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.route('**/api/**',async route=>{const r=route.request(),p=new URL(r.url()).pathname;let data={success:true,items:[],data:[]};
if(p==='/api/auth/me')data={success:true,user:{userId:'fixture',userName:'검증',authority:1,accountActive:true}};
if(p==='/api/favorites')data={success:true,favorites:[]};
if(p==='/api/customers/search')data={success:true,customers:[{CustKey:1,CustName:'주광',CustArea:'서울'},{CustKey:2,CustName:'꽃장',CustArea:'서울'},{CustKey:3,CustName:'라움',CustArea:'서울'}]};
if(p==='/api/stats/sales'){salesReads++;data={success:true,byCustomer:[{CustName:'주광',area:'서울',curSales:5,prevSales:10},{CustName:'꽃장',area:'서울',curSales:100,prevSales:0}]};}
if(r.method()!=='GET')writes.push(p);await route.fulfill({json:data});});
await page.goto(process.argv[2]||'http://localhost:3245/orders/kakao-stock');await page.getByRole('button',{name:'+ 차수 추가',exact:true}).waitFor({state:'visible'});
const base='43-1 카네이션\n유카리체리1\n-----------------------------------\n44-1 카네이션\n유카리체리9';
await page.getByLabel('시작재고 입력',{exact:true}).fill(base);await page.getByRole('button',{name:'시작재고 적용·수정',exact:true}).click();
const row=page.getByRole('button',{name:'44-1 카네이션 · 유카리체리 변경 입력',exact:true});await row.click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByLabel('업체',{exact:true}).evaluate(e=>e===document.activeElement),true);
await page.getByLabel('업체',{exact:true}).fill('ㅈ');const list=page.getByRole('group',{name:'매출순 업체 검색결과'});await list.waitFor();assert.deepEqual(await list.getByRole('button').allTextContents(),['꽃장서울','주광서울']);await list.getByRole('button',{name:'꽃장서울',exact:true}).click();assert.equal(await page.getByLabel('수량',{exact:true}).evaluate(e=>e===document.activeElement),true);
await page.getByLabel('수량',{exact:true}).fill('2');await page.getByRole('button',{name:'재고장에 적용',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);assert((await row.textContent()).includes('현재 7'));assert.equal(await row.evaluate(e=>e===document.activeElement),true);
await page.getByRole('button',{name:'전체 재고 복사',exact:true}).click();const plain=(await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n');assert.equal(plain,base.replace('유카리체리1','유카리체리 1').replace('유카리체리9','유카리체리 7'));assert(!plain.includes('꽃장'));
await page.getByRole('button',{name:'비고·변경내역 포함 복사',exact:true}).click();const detail=await page.evaluate(()=>navigator.clipboard.readText());assert(detail.includes('유카리체리 7 시작9 꽃장'));assert(detail.includes('0>2(9>7)'));
await row.click();await page.getByLabel('업체',{exact:true}).fill('꽃장');await page.getByLabel('변경 방식',{exact:true}).selectOption('CANCEL');await page.getByLabel('수량',{exact:true}).fill('1');await page.getByRole('button',{name:'재고장에 적용',exact:true}).click();assert((await row.textContent()).includes('현재 8'));assert.equal(salesReads,2,'modal reopens reuse bounded two-month cache');
await row.click();await page.getByLabel('업체',{exact:true}).press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
await page.setViewportSize({width:390,height:844});await row.click();assert.equal(await page.evaluate(()=>document.querySelector('dialog').getBoundingClientRect().width<=innerWidth),true);await page.screenshot({path:'quick-change-modal.png'});await page.getByRole('button',{name:'변경 입력 닫기',exact:true}).click();assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(p=>!['/api/user-activity','/api/log','/api/replay'].some(x=>p.startsWith(x))),[]);
console.log('PASS modal focus, initial substring sales order, exact section ADD/CANCEL, live remainder, both clipboard modes, bounded read cache, Escape, mobile, no ERP writes');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
