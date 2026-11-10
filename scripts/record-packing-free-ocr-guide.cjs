// Actual UI with synthetic documents and ALL APIs intercepted. No ERP writes.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run'),root=process.cwd();
async function main(){
 const {upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create();const sheet=pdf.addPage([612,792]);sheet.drawText('TRAINING-001 / ROSE RED / 100 stems / USD 20.00',{x:35,y:730,size:14});
 const dummy=path.join(root,'.verify/46-1 무료OCR 연습.pdf');fs.mkdirSync(path.dirname(dummy),{recursive:true});fs.writeFileSync(dummy,await pdf.save());
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const secret=crypto.randomUUID(),base='http://127.0.0.1:'+port,log=fs.openSync('.verify/free-ocr-guide-server.log','w');
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);let browser;
 try{
  for(let i=0;i<90;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(i===89)throw Error('UI server unavailable');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>console.log('UI ERROR',e.message));await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  await page.setCookie({name:'nenovaToken',value:jwt.sign({userId:'guide-import',userName:'연습 담당자',authority:4,accountActive:true},secret,{expiresIn:'1h'}),url:base});
  const invoice={farm:'연습 농장',invoice:'TRAINING-001',currency:'USD',date:'2026-11-06',invoice_total:40,freight_total:0,products:[{description:'ROSE RED',pcs:1,steam_box:100,bunch_st:25,total_stems:100,u_price:.2,t_price:20,source_page:1,source_row:1},{description:'ROSE WHITE',pcs:1,steam_box:100,bunch_st:25,total_stems:100,u_price:.2,t_price:20,source_page:1,source_row:2}]};
  for(let n=3;n<=12;n++)invoice.products.push({...invoice.products[1],description:`TRAINING FLOWER ${n}`,source_row:n});invoice.invoice_total=240;
  const payload={content:[{type:'text',text:JSON.stringify({invoices:[invoice],free_ocr_review_issues:[{code:'HAWB_REVIEW',invoice:'TRAINING-001',invoicePrinted:'연습 A',manifest:'연습 B'}]})}],stop_reason:'end_turn',source:'ai'};
  let freeCalls=0,paidCalls=0,matchValue={version:1,entries:[]},matchRevision=0;
  await page.setRequestInterception(true);page.on('request',req=>{
   const u=new URL(req.url());if(!u.pathname.startsWith('/api/'))return req.continue();
   let body={success:true,products:[],value:null,revision:0,items:[],rows:[],history:[],data:[]},status=200;
   if(u.pathname==='/api/auth/me')body.user={userId:'guide-import',userName:'연습 담당자',authority:4,deptName:'수입부',accountActive:true};
   if(u.pathname==='/api/import/tools/product-matches'){
    if(req.method()==='POST'){const b=JSON.parse(req.postData()||'{}');assert.equal(b.expectedRevision,matchRevision);matchValue=upsertPackingErpMatch(matchValue,b,[{ProdKey:99001,ProdName:'ROSE RED TRAINING',country:'CO',selectable:true}]);matchRevision++;}
    body={success:true,value:matchValue,revision:matchRevision,products:[{ProdKey:99001,ProdName:'ROSE RED TRAINING',ProdCode:'TRAINING-ROSE',FlowerName:'장미',country:'CO',selectable:true,legacyExportSafe:true}]};
   }
   if(u.pathname==='/api/import/tools/parse-pdf'){
    const b=JSON.parse(req.postData()||'{}');if(b.cacheOnly){status=404;body={error:'No cached document'};}
    else if(b.freeOcrJobId){freeCalls++;body={status:'SUCCEEDED',result:payload,revalidation:{preserved:3,providerCalls:0}};}
    else{paidCalls++;body=payload;}
   }else if(u.pathname==='/api/import/tools/free-ocr')body={success:true,job:{jobId:'11111111-1111-4111-8111-111111111111',status:'SUCCEEDED',result:{sourceHash:'a'.repeat(64),pages:[]}}};
   return req.respond({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0',timeout:120000});
  console.log('page',new URL(page.url()).pathname,(await page.evaluate(()=>document.body.innerText)).slice(0,600));
  await page.waitForSelector('button[aria-label="콜롬비아"]');console.log('country ready');
  const sourceFiles=JSON.parse(fs.readFileSync('config/workflow-guides.json')).workflows.find(w=>w.id==='packing-free-ocr').sourceFiles;
  const rec=dry?null:await createWorkflowGuideRecorder(page,{workflowId:'packing-free-ocr',guideId:'import',title:'Claude 분석과 완료 구간 보존',sourceFiles,fixtureOnly:true});
  let number=0;const step=async(s,t)=>{number++;rec?.chapter(s,`${number}. ${t}`);if(rec){await rec.caption(`${number}. ${t}`);await rec.pause(5500);}};
  const focus=async selector=>{await page.$eval(selector,n=>n.scrollIntoView({block:'center',behavior:'instant'}));const p=await page.$eval(selector,n=>{const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});assert(p.y>=70&&p.y<=900,`Guide target outside camera: ${selector} ${JSON.stringify(p)}`);if(rec){await rec.pause(1200);await rec.focus(selector,number);}};
  await step('select','국가 선택 · 전체 화면에서 콜롬비아 버튼을 찾습니다.');
  await focus('button[aria-label="콜롬비아"]');
  await page.click('button[aria-label="콜롬비아"]');
  await rec?.unfocus();
  await step('recover','원본 PDF 선택 · 처음 올린 PDF는 Claude로 분석하고 저장 결과는 재사용합니다.');
  await focus('[role="button"][aria-label*="인보이스"]');
  const input=await page.$('input[type="file"][accept=".pdf"]');assert(input);await input.uploadFile(dummy);console.log('fixture selected');
  try{await page.waitForFunction(()=>document.body.innerText.includes('ROSE RED'));}catch(e){console.log((await page.evaluate(()=>document.body.innerText)).slice(-6000));throw e;}
  await rec?.unfocus();
  await step('review','미매칭 확인 · 원본 품목을 눌러 전산 품목을 검색하고 선택합니다.');
  await focus('[aria-label="ROSE RED 전산 품목 매칭"]');await page.click('[aria-label="ROSE RED 전산 품목 매칭"]');await rec?.unfocus();
  await page.waitForSelector('[aria-label="전산 품목 검색"]');
  if(rec)await rec.caption('3. 검색 입력 · ROSE RED를 입력하고 국가·품목명을 대조합니다.');
  await focus('[aria-label="전산 품목 검색"]');await page.type('[aria-label="전산 품목 검색"]','ROSE RED',{delay:180});if(rec)await rec.pause(3000);await rec?.unfocus();
  await focus('[data-candidate="99001"]');await page.click('[data-candidate="99001"]');await page.waitForFunction(()=>!document.querySelector('[data-testid="packing-match-dialog"]'));await rec?.unfocus();
  assert.equal(matchRevision,1);assert.equal(matchValue.entries[0].prodKey,99001);
  if(rec){await rec.caption('3. 저장 결과 확인 · 선택 즉시 창이 닫히고 팀 공용 매칭에 저장됩니다.\n원본 표기 차이는 별도 확인 대상으로 남으며 매칭만으로 입고되지 않습니다.');await rec.pause(6500);}
  await page.waitForFunction(()=>document.body.innerText.includes('팀 공용 수동 1'));
  if(rec)await rec.caption('3. 전체 보기로 저장된 품목을 다시 확인합니다.\n확인 필요만 보기에서는 해결된 행이 숨겨지지만 매칭은 유지됩니다.');
  await focus('[data-testid="packing-results-view-toggle"]');await page.click('[data-testid="packing-results-view-toggle"]');await rec?.unfocus();
  await page.waitForFunction(()=>document.body.innerText.includes('ROSE RED TRAINING'));
  await page.screenshot({path:'.verify/packing-guide-result.png'});
  assert.equal(freeCalls,0);assert.equal(paidCalls,1); // intercepted synthetic request, not a provider call
  if(rec){await rec.pause(5500);const result=await rec.stop();const file='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(file));const guide=registry.workflows.find(w=>w.id==='packing-free-ocr').guides[0];guide.status='ready';guide.chapters=result.chapters;fs.writeFileSync(file,JSON.stringify(registry,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,dry,freeCalls,paidCalls,productionWrites:0}));
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
