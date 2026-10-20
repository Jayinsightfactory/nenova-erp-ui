// Local browser regression: every API request is fulfilled with synthetic data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const puppeteer=require('puppeteer-core');
const target=process.argv[2]||'http://127.0.0.1:3094/stats/pivot?popup=1';
const origin=new URL(target).origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(target).hostname));
const base={OrderYear:'2026',OrderWeek:'44-01',CounName:'콜롬비아',FlowerName:'수국',ProdName:'signed-order-fixture',ListType:'02. 주문'};
const rows=[{...base,CustName:'positive-fixture',Quantity:10},{...base,CustName:'negative-fixture',Quantity:-3}];
(async()=>{
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'signed-fixture',role:'admin'})));
  await page.setRequestInterception(true);
  page.on('request',r=>{
   const u=new URL(r.url());
   if(['blob:','data:'].includes(u.protocol))return r.continue();
   if(u.origin!==origin)return r.abort();
   if(!u.pathname.startsWith('/api/'))return r.continue();
   let body={success:true,rows:[],data:[],favorites:[]};
   if(u.pathname==='/api/auth/me')body={success:true,user:{userId:'signed-fixture',role:'admin'}};
   if(u.pathname==='/api/stats/pivot-exe')body=u.searchParams.get('mode')==='weeks'
    ?{success:true,weeks:[{...base,OrderYearWeek:'20264401'}]}
    :{success:true,columns:Object.keys(rows[0]),rows,scope:{orderYear:'2026',weekStart:'44-01',weekEnd:'44-01'}};
   return r.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  for(const width of [1920,1280]){
   await page.setViewport({width,height:width===1920?1080:800,deviceScaleFactor:1});
   await page.goto(target,{waitUntil:'networkidle0'});
   await page.waitForFunction(()=>{const t=document.querySelector('[data-testid="pivot-exe-grid"]');return t&&t.innerText.includes('-3.00')&&t.innerText.includes('7.00');},{timeout:60000});
   const text=await page.$eval('[data-testid="pivot-exe-grid"]',e=>e.innerText);
   assert.ok(text.includes('10.00')&&text.includes('-3.00')&&text.includes('7.00'));
   fs.mkdirSync('outputs',{recursive:true});
   await page.screenshot({path:`outputs/pivot-signed-${width}.png`,fullPage:false});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: signed rows +10/-3, total7 rendered at 1920x1080 and 1280x800; APIs mocked, no ledger writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
