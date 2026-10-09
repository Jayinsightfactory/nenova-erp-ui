// Isolated browser fixture: never sends messages or writes ERP records.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));
  const messages=[0,1].map(index=>({source:'nenovakakao',chatroom:'영업방',chat_id:'sales-fixture',external_message_id:String(index),sender:'검증 담당',created_at:new Date(Date.now()-600000).toISOString(),timestamp_approximate:false,message:`41-1 수국 변경사항\n검증꽃집${index}\n화이트 ${index+1}박스 추가`}));
  let fail=false;
  await page.addInitScript(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'UI 검사',authority:1})));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   let data={success:true,data:[],rows:[],items:[],operations:[],history:[],applications:[],mappings:{},favorites:[],hasMore:false};
   if(url.pathname.endsWith('/auth/me'))data={success:true,user:{userId:'fixture',userName:'UI 검사',authority:1,accountActive:true}};
   if(url.pathname.endsWith('/orders/weeks'))data={success:true,weeks:['2026-41-01']};
   if(url.pathname.endsWith('/sales-feed'))data={ok:true,messages,hasMore:false,nextAfterKey:null};
   if(url.pathname.endsWith('/paste-preanalysis'))data={analysisStorage:{cacheMiss:true}};
   if(url.pathname.endsWith('/delivery-status')){
    if(fail)return route.fulfill({status:502,json:{error:'전달 조회 실패 검증'}});
    const body=request.postDataJSON();
    data={ok:true,year:body.year,week:body.week,items:body.sources.map(source=>({identity:source.identity,status:source.external_message_id==='0'?'DELIVERED':'UNCONFIRMED',...(source.external_message_id==='0'?{deliveryIdentity:'nenovakakao|delivery-fixture|proof',deliveredAt:new Date().toISOString()}: {})}))};
   }else if(request.method()!=='GET'&&!url.pathname.endsWith('/paste-preanalysis')&&!url.pathname.endsWith('/distribution-live-history'))writes.push(url.pathname);
   await route.fulfill({json:data});
  });
  await page.goto(process.argv[2]||'http://localhost:3225/orders/paste?popup=1');
  await page.waitForSelector('.source-delivery-status.delivered');
  assert.equal(await page.locator('.source-delivery-status.delivered').count(),1);
  assert.equal(await page.locator('.source-delivery-status').count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync('outputs/shared-delivery-smoke',{recursive:true});
  await page.screenshot({path:'outputs/shared-delivery-smoke/1920.png'});
  fail=true;
  await page.reload();
  await page.waitForFunction(()=>document.body.innerText.includes('전달 조회 실패 검증'));
  assert.equal(await page.locator('.source-delivery-status.delivered').count(),0);
  await page.setViewportSize({width:1366,height:768});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:'1920x1080 / 1366x768',deliveryComplete:1,unconfirmed:1,failureClearsGreen:true,erpWrites:writes,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
