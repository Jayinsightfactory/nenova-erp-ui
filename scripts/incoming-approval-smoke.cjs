const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
async function main(){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const secret=crypto.randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret},stdio:'ignore',windowsHide:true});let browser;
 try{
  for(let n=0;n<45;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===44)throw Error('Local server did not start');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[],posts=[];await page.setViewport({width:1920,height:1080});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const user={userId:'fixture',userName:'화면 검증',authority:1,deptName:'대표',accountActive:true};
  await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'10m'}),url:base});
  const receipt={warehouseKey:90,orderYear:'2026',orderWeek:'41-01',mode:'REPLACE',farmName:'Farm A'},header={WarehouseKey:90,OrderYear:'2026',OrderWeek:'41-01',FarmName:'Farm A'};
  const requests=[{requestId:1,status:'draft',revision:1,reason:'수정 요청 시험',correction:receipt,baseline:{receipt:{header}},matching:{rows:[],farms:[]}},{requestId:2,status:'requested',revision:1,reason:'품목 이동 시험',correction:receipt,baseline:{receipt:{header}},matching:{rows:[],farms:[]}}];
  const products=[{ProdKey:1,ProdName:'Flower A',OutUnit:'단'},{ProdKey:2,ProdName:'Flower B',OutUnit:'단'}];
  const facts={receiptPlan:{detailsChanged:true,changes:[{prodKey:1,prodName:'Flower A',unit:'단',before:100,after:0,delta:-100},{prodKey:2,prodName:'Flower B',unit:'단',before:0,after:100,delta:100}]},products,masters:[{ShipmentKey:10,CustName:'TEST 거래처',OrderYear:'2026',OrderWeek:'41-01'}],details:[{SdetailKey:20,ShipmentKey:10,ProdKey:1}],dates:[{SdateKey:30,SdetailKey:20,ShipmentQuantity:100,EstQuantity:100,Cost:110,DateText:'2026-10-08'}],farmAssignments:[],farms:[]};
  let failOnce=true;
  await page.setRequestInterception(true);page.on('request',r=>{
   const u=new URL(r.url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();
   let status=200,d={success:true,items:[],rows:[],data:[],products:[],countries:[],records:[],history:[],references:[],options:[],value:null,revision:0};
   if(u.pathname==='/api/auth/me')d.user=user;
   if(u.pathname==='/api/warehouse')d.masters=[];
   if(u.pathname==='/api/warehouse/approval'){
    if(r.method()==='GET'){
     const id=Number(u.searchParams.get('requestId'));d=id?{success:true,permissions:{request:true,review:true},request:requests.find(x=>x.requestId===id),facts}:{success:true,permissions:{request:true,review:true},requests:requests.map(x=>({RequestId:x.requestId,Status:x.status,RequestedBy:'fixture',correction:x.correction,reason:x.reason,revision:x.revision}))};
    }else{
     const b=JSON.parse(r.postData());posts.push(b);const request=requests.find(x=>x.requestId===b.requestId);
     if(b.action==='submit'){request.status='requested';request.revision++;}
     if(b.action==='saveMatching'){request.matching=b.matching;request.revision++;}
     if(b.action==='preview')d={success:true,canCommit:true,issues:[],digest:'a'.repeat(64),externalDocuments:'발송한 견적서는 재발행 필요',groups:[{key:'10:2',customer:'TEST 거래처',year:'2026',week:'41-01',product:'Flower B',unit:'단',before:0,after:100,beforeAmount:0,afterAmount:10000,beforeVat:0,afterVat:1000,stockDelta:-100}]};
     if(b.action==='approve'){if(failOnce){status=409;d={success:false,error:'통신 결과 확인 시험'};failOnce=false;}else{request.status='applied';request.result={warehouseKey:90,shipmentGroups:2,stockProducts:2};request.appliedAt='2026-11-04';}}
    }
   }
   return r.respond({status,contentType:'application/json',body:JSON.stringify(d)});
  });
  const click=async text=>{const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===text&&!b.disabled),text);assert(h.asElement(),`Missing enabled ${text}`);await h.asElement().focus();await page.keyboard.press('Enter');await h.dispose();};
  await page.goto(base+'/import/tools?tab=incoming',{waitUntil:'networkidle0'});await page.waitForSelector('nav[aria-label="입고 정정 처리 단계"]');
  await click('#1 열기');await page.waitForSelector('[aria-label="정정 요청 상세"]');await click('영업지원에 수정 요청');await page.waitForFunction(()=>document.querySelector('[aria-label="정정 요청 상세"]')?.textContent.includes('검토 대기'));
  await click('요청 목록으로');await click('매칭·확정');await click('#2 열기');await page.waitForSelector('input[aria-label="분배 30 선택"]');await page.click('input[aria-label="분배 30 선택"]');
  await page.select('select[aria-label="1행 대상 품목"]','2');await page.click('input[type="checkbox"]:not([aria-label])');
  assert(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='최종 확정').disabled));
  await click('매칭 임시저장');await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='입고·분배·견적·매출 영향 검토').disabled);
  await click('입고·분배·견적·매출 영향 검토');await page.waitForFunction(()=>document.body.textContent.includes('10,000'));
  await page.evaluate(()=>{const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('입고와 분배의 최종값'));label.querySelector('input').click();});
  await click('최종 확정');await page.waitForFunction(()=>document.body.textContent.includes('통신 결과 확인 시험'));await click('같은 확정 결과 다시 확인');
  await page.waitForFunction(()=>document.querySelector('[aria-label="정정 요청 상세"]')?.textContent.includes('적용 완료'));
  const approvals=posts.filter(p=>p.action==='approve');assert.equal(approvals.length,2);assert.equal(approvals[0].operationId,approvals[1].operationId);
  assert.equal(posts.find(p=>p.action==='saveMatching').matching.rows[0].prodKey,2);
  await click('요청 목록으로');await click('처리 이력');await page.waitForFunction(()=>document.body.textContent.includes('#2 열기'));
  fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/approval-desktop.png'});
  await page.setViewport({width:390,height:844});await click('#2 열기');await page.waitForSelector('[aria-label="정정 요청 상세"]');await page.screenshot({path:'.verify/approval-mobile.png'});
  await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  await click('요청 목록으로');await page.focus('nav[aria-label="입고 정정 처리 단계"] button');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'매칭·확정');await page.keyboard.press('Space');
  assert.deepEqual(errors,[]);console.log('PASS mock browser: import submit; support select/match/draft/preview/confirm; same-operation retry; history; keyboard; 1920/390; all API mocked, operating writes=0');
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
