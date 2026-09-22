const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 const writes=[],errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log(e.stack);});
 const original='38-2 수국 변경사항\n청화꽃집\n화이트 1박스 취소\n블루 1박스 취소\n연연핑크 1박스 취소\n-> 9/27 일요일 출고분에서 취소 입니다';
 const messages=Array.from({length:12},(_,i)=>({source:'kakao-sales',chat_id:'density',external_message_id:String(i),sender:'담당자',created_at:new Date(Date.now()-i*60000).toISOString(),message:original}));
 await page.addInitScript(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'UI 검사',authority:1})));
 await page.route('**/api/**',async r=>{
 const req=r.request(),url=new URL(req.url());
 if(req.method()!=='GET'&&!url.pathname.endsWith('/distribution-live-history'))writes.push(url.pathname);
 let data={success:true,data:[],rows:[],items:[],operations:[],history:[],applications:[],mappings:{},favorites:[],hasMore:false};
 if(url.pathname.endsWith('/auth/me'))data={success:true,user:{userId:'fixture',userName:'UI 검사',authority:1}};
 if(url.pathname.endsWith('/orders/weeks'))data={success:true,weeks:['2026-38-01','2026-38-02']};
 if(url.pathname.endsWith('/sales-feed'))data={ok:true,messages,hasMore:false,nextAfterKey:null};
 if(url.pathname.endsWith('/distribution-live-history'))return r.fulfill({status:503,json:{error:'테스트 조회 실패: 이전 근거는 참고용'}});
 await r.fulfill({json:data});
 });
 await page.goto('http://localhost:3225/orders/paste?popup=1');
 await page.locator('.compact-change-group').first().waitFor().catch(async e=>{console.log(await page.locator('body').innerText());throw e;});
 const first=page.locator('.compact-match-row').first();
 assert.equal(await first.locator('.compact-change-scope').count(),1);
 assert.equal(await first.locator('.compact-change-items>span').count(),3);
 assert.equal(await first.locator('.source-message-context').isVisible(),false);
 const initial=await first.boundingBox();
 assert.ok(initial.height<190,`card too tall: ${initial.height}`);
 const inbox=await page.locator('.paste-sales-inbox').boundingBox();
 const base=await page.locator('.paste-baseline-panel').boundingBox();
 assert.ok(inbox.width>550,`inbox too narrow: ${inbox.width}`);
 assert.ok(base.height<40,'baseline settings must start collapsed');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 fs.mkdirSync('outputs/inbox-density',{recursive:true});
 await page.screenshot({path:'outputs/inbox-density/1920.png'});
 await first.locator('details>summary').first().click();
 assert.equal(await first.locator('.source-message-context').innerText(),original);
 await first.locator('details>summary').first().click();
 await page.setViewportSize({width:1366,height:768});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'outputs/inbox-density/1366.png'});
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({viewport:'1920x1080 / 1366x768',cardHeight:initial.height,inboxWidth:inbox.width,groupCount:1,requests:3,originalPreserved:true,writes,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
