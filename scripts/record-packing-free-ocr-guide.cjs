// Actual UI with synthetic documents and ALL APIs intercepted. No ERP writes.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const {createPackingHistoryFixture}=require('./lib/packing-history-fixture.cjs');
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
  const uploadHistory=createPackingHistoryFixture();
  const cachePayloads=new Map();let cacheReadHits=0;
  let freeCalls=0,paidCalls=0,matchValue={version:1,entries:[]},matchRevision=0,external=0,writes=0,holdHistory=false,heldHistory=null;
  await page.setRequestInterception(true);page.on('request',req=>{
   const u=new URL(req.url());if(!/^https?:$/.test(u.protocol))return req.continue();
   if(!['127.0.0.1','localhost'].includes(u.hostname)){external++;return req.abort();}
   if(!u.pathname.startsWith('/api/'))return req.continue();
   if(/\/commit$|\/cost-revisions$|^\/api\/warehouse/.test(u.pathname)&&req.method()!=='GET'){writes++;return req.abort();}
   const history=uploadHistory.handle(req);if(history){
    if(holdHistory&&req.method()==='GET'&&!u.searchParams.has('id')){holdHistory=false;heldHistory={req,history};return;}
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify(history)});
   }
   let body={success:true,products:[],value:null,revision:0,items:[],rows:[],history:[],data:[]},status=200;
   if(u.pathname==='/api/auth/me')body.user={userId:'guide-import',userName:'연습 담당자',authority:4,deptName:'수입부',accountActive:true};
   if(u.pathname==='/api/import/tools/product-matches'){
    if(req.method()==='POST'){const b=JSON.parse(req.postData()||'{}');assert.equal(b.expectedRevision,matchRevision);matchValue=upsertPackingErpMatch(matchValue,b,[{ProdKey:99001,ProdName:'ROSE RED TRAINING',country:'CO',selectable:true}]);matchRevision++;}
    body={success:true,value:matchValue,revision:matchRevision,products:[{ProdKey:99001,ProdName:'ROSE RED TRAINING',ProdCode:'TRAINING-ROSE',FlowerName:'장미',country:'CO',selectable:true,legacyExportSafe:true}]};
   }
   if(u.pathname==='/api/import/tools/parse-pdf'){
    const b=JSON.parse(req.postData()||'{}');if(b.cacheOnly){if(cachePayloads.has(b.pdfBase64)){cacheReadHits++;body={...cachePayloads.get(b.pdfBase64),source:'cache'};}else{status=404;body={error:'No cached document'};}}
    else if(b.freeOcrJobId){freeCalls++;body={status:'SUCCEEDED',result:payload,revalidation:{preserved:3,providerCalls:0}};}
    else{paidCalls++;body=payload;}
   }else if(u.pathname==='/api/import/tools/free-ocr')body={success:true,job:{jobId:'11111111-1111-4111-8111-111111111111',status:'SUCCEEDED',result:{sourceHash:'a'.repeat(64),pages:[]}}};
   return req.respond({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0',timeout:120000});
  console.log('page',new URL(page.url()).pathname,(await page.evaluate(()=>document.body.innerText)).slice(0,600));
  await page.waitForSelector('button[aria-label="콜롬비아"]');console.log('country ready');
  const sourceFiles=JSON.parse(fs.readFileSync('config/workflow-guides.json')).workflows.find(w=>w.id==='packing-free-ocr').sourceFiles;
  for (const file of ['styles/ImportReviewTypography.module.css', 'pages/import/tools.js', 'styles/ImportTools.module.css']) {
    if (!sourceFiles.includes(file)) sourceFiles.push(file);
  }
  const rec=dry?null:await createWorkflowGuideRecorder(page,{workflowId:'packing-free-ocr',guideId:'import',title:'Claude 분석과 완료 구간 보존',sourceFiles,fixtureOnly:true,encodingPreset:'veryfast'});
  let number=0;const step=async(s,t)=>{number++;rec?.chapter(s,`${number}. ${t}`);if(rec){await rec.caption(`${number}. ${t}`);await rec.pause(5500);}};
  const focus=async selector=>{await page.$eval(selector,n=>n.scrollIntoView({block:'center',behavior:'instant'}));const p=await page.$eval(selector,n=>{const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});assert(p.y>=70&&p.y<=900,`Guide target outside camera: ${selector} ${JSON.stringify(p)}`);if(rec){await rec.pause(1200);await rec.focus(selector,number);}};
  await step('select','국가 선택 · 전체 화면에서 콜롬비아 버튼을 찾습니다.');
  await focus('button[aria-label="콜롬비아"]');
  await page.click('button[aria-label="콜롬비아"]');
  await rec?.unfocus();
  await step('recover','원본 PDF 선택 · 처음 올린 PDF는 Claude로 분석하고 저장 결과는 재사용합니다.');
  await focus('[role="button"][aria-label*="인보이스"]');
  const input=await page.$('input[type="file"][accept=".pdf"]');assert(input);await input.uploadFile(dummy);console.log('fixture selected');
  await rec?.unfocus();
  if(rec)await rec.caption('2. 최초 파일은 자동 분석합니다. 같은 내용의 저장 분석은 바로 불러옵니다.\n같은 이름의 변경본만 기존 분석과 새 분석 중 선택합니다.');
  try{await page.waitForFunction(()=>document.body.innerText.includes('ROSE RED'));}catch(e){console.log((await page.evaluate(()=>document.body.innerText)).slice(-6000));throw e;}
  if(await page.$('[data-testid="packing-match-modal-later"]')){await page.click('[data-testid="packing-match-modal-later"]');await page.waitForSelector('[data-testid="packing-upload-match-modal"]',{hidden:true});}
  await rec?.unfocus();
  await step('review','미매칭 확인 · 원본 품목을 눌러 전산 품목을 검색하고 선택합니다.');
  const rowSearch='[aria-label="ROSE RED 매칭 품목 검색"]';
  const rowInput='[aria-label="ROSE RED 같은 국가 품목 검색"]';
  const rowResult='[data-testid="packing-inline-search-result"][data-prod-key="99001"]';
  await focus(rowSearch);await page.click(rowSearch);await rec?.unfocus();
  await page.waitForSelector(rowInput);
  if(rec)await rec.caption('3. 같은 행 검색 · ROSE RED를 입력하고 국가·품목명을 대조합니다.');
  await focus(rowInput);await page.type(rowInput,'ROSE RED',{delay:180});if(rec)await rec.pause(3000);await rec?.unfocus();
  await focus(rowResult);await page.click(rowResult);await page.waitForFunction(selector=>!document.querySelector(selector),{},rowInput);await rec?.unfocus();
  assert.equal(matchRevision,1);assert.equal(matchValue.entries[0].prodKey,99001);
  if(rec){await rec.caption('3. 저장 결과 확인 · 선택한 품목과 확인 상태가 같은 행에 표시됩니다.\n원본 표기 차이는 별도로 확인합니다.');await rec.pause(6500);}
  await page.waitForFunction(()=>document.body.innerText.includes('팀 공용 수동 1'));
  if(rec)await rec.caption('3. 저장한 품목이 전체 목록 맨 위에 표시됩니다.\n확인 필요만 보기로 남은 품목을 볼 수 있습니다.');
  await focus('[data-testid="packing-results-view-toggle"]');await page.click('[data-testid="packing-results-view-toggle"]');
  await page.waitForFunction(selector=>!document.querySelector(selector),{},rowSearch);
  await page.click('[data-testid="packing-results-view-toggle"]');await rec?.unfocus();
  await page.waitForSelector(rowSearch);
  await page.screenshot({path:'.verify/packing-guide-result.png'});
  assert.equal(freeCalls,0);assert.equal(paidCalls,1); // intercepted synthetic request, not a provider call
  await step('reuse','기존 분석 재사용 · 파일을 다시 올리지 않고 저장 분석에서 바로 이어갑니다.');
  await page.waitForFunction(()=>document.body.innerText.includes('팀 업로드 이력 보관 완료'));
  await focus('[data-testid="packing-history-open"]');await page.click('[data-testid="packing-history-open"]');await rec?.unfocus();
  await page.waitForSelector('[data-testid="packing-history-resume"]');
  await focus('[data-testid="packing-history-resume"]');await page.click('[data-testid="packing-history-resume"]');await rec?.unfocus();
  await page.waitForFunction(()=>document.body.innerText.includes('저장 분석 재사용 · API 호출 없음'));
  assert.equal(paidCalls,1);
  if(rec){await rec.caption('4. 동일 내용의 파일을 다시 선택해도 저장 분석으로 바로 복구합니다.\n파일명만 바뀐 경우도 같은 내용이면 다시 분석하지 않습니다.');await rec.pause(4500);}
  await focus('[role="button"][aria-label*="인보이스"]');await input.uploadFile(dummy);await rec?.unfocus();
  await page.waitForFunction(()=>document.body.innerText.includes('저장 분석 재사용 · API 호출 없음'));await page.waitForNetworkIdle({idleTime:200});assert.equal(paidCalls,1);
  await step('changed','변경본 선택 · 내용이 다른 파일은 기존 분석과 새 파일 분석 중 선택합니다.');
  const changedDir=path.join(root,'.verify/changed-invoice');fs.mkdirSync(changedDir,{recursive:true});
  const changed=path.join(changedDir,path.basename(dummy));const changedPdf=await PDFDocument.load(fs.readFileSync(dummy));changedPdf.setTitle('TRAINING CHANGED VERSION');fs.writeFileSync(changed,await changedPdf.save());
  await focus('[role="button"][aria-label*="인보이스"]');await input.uploadFile(changed);await rec?.unfocus();
  await page.waitForSelector('[data-testid="packing-reuse-previous"]');assert.equal(paidCalls,1);
  if(rec){await rec.caption('5. 이전 분석을 선택하면 새 파일을 분석하지 않습니다.\n기존 원본·저장 연도·매칭으로 작업을 이어갑니다.');await rec.pause(4000);}
  await focus('[data-testid="packing-reuse-previous"]');await page.click('[data-testid="packing-reuse-previous"]');await rec?.unfocus();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="packing-file-choice"]'));assert.equal(paidCalls,1);
  await focus('[role="button"][aria-label*="인보이스"]');await input.uploadFile(changed);await rec?.unfocus();
  await page.waitForSelector('[data-testid="packing-analyze-selected"]');assert.equal(paidCalls,1);
  if(rec){await rec.caption('5. 변경본을 처리할 때만 새 파일 분석을 누릅니다.\n이 영상은 연습 응답이며 실제 유료 API·운영 입고 저장은 호출하지 않습니다.');await rec.pause(4500);}
  await focus('[data-testid="packing-analyze-selected"]');await page.click('[data-testid="packing-analyze-selected"]');await rec?.unfocus();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="packing-file-choice"]')&&document.body.innerText.includes('TRAINING-001'));
  if(await page.$('[data-testid="packing-match-modal-later"]')){await page.click('[data-testid="packing-match-modal-later"]');await page.waitForSelector('[data-testid="packing-upload-match-modal"]',{hidden:true});}
  await page.waitForNetworkIdle({idleTime:1000});
  assert.equal(paidCalls,2);assert.equal(external,0);assert.equal(writes,0);
  await step('history','업로드 이력 · 원본과 보관 분석의 수량·금액을 비교합니다.');
  await focus('button[aria-controls="import-panel-history"]');await page.click('button[aria-controls="import-panel-history"]');await rec?.unfocus();
  await page.waitForSelector('[aria-label="팀 업로드 이력"]');
  const compareSelector='[aria-label="팀 업로드 이력"] tbody tr:first-child td:last-child button:last-child';
  await focus(compareSelector);await page.click(compareSelector);await rec?.unfocus();
  await page.waitForSelector('[aria-label="보관 원본·분석 수량 금액 대조"]');
  assert((await page.$eval('[aria-label="보관 원본·분석 수량 금액 대조"]',node=>node.innerText)).includes('상품 총금액'));
  if(rec){await rec.caption('6. 대조 결과 · 송장별 품목·박스·단·송이와 행별 단가·금액을 확인합니다.\n미확인은 0이 아니며 실제 입고 저장 결과와 구분합니다.');await rec.pause(6500);}
  await page.click('button[aria-controls="import-panel-packing"]');await page.waitForSelector('[data-testid="packing-country-back"]');
  if(rec){const result=await rec.stop();const file='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(file));const workflow=registry.workflows.find(w=>w.id==='packing-free-ocr');workflow.sourceFiles=sourceFiles;const guide=workflow.guides[0];guide.status='ready';guide.chapters=result.chapters;fs.writeFileSync(file,JSON.stringify(registry,null,2)+'\n');}
  if(dry){
    // A completed API response not yet saved in team history also reuses, not re-analyzes.
    const cachedPdf=await PDFDocument.load(fs.readFileSync(dummy));cachedPdf.setSubject('UNCONSUMED CACHE FIXTURE');
    const cachedBytes=await cachedPdf.save(),cachedFile=path.join(changedDir,'46-1 cached.pdf');fs.writeFileSync(cachedFile,cachedBytes);
    cachePayloads.set(Buffer.from(cachedBytes).toString('base64'),payload);
    await input.uploadFile(cachedFile);await page.waitForFunction(()=>document.body.innerText.includes('46-1 cached.pdf')&&document.body.innerText.includes('TRAINING-001'));
    if(await page.$('[data-testid="packing-match-modal-later"]')){await page.click('[data-testid="packing-match-modal-later"]');await page.waitForSelector('[data-testid="packing-upload-match-modal"]',{hidden:true});}
    await page.waitForNetworkIdle({idleTime:1000});assert.equal(cacheReadHits,1);assert.equal(paidCalls,2);
    // Corrupt history must leave the active work intact and cannot trigger AI.
    await page.waitForFunction(()=>document.body.innerText.includes('팀 업로드 이력 보관 완료'));
    const originals=new Map(uploadHistory.files);for(const key of originals.keys())uploadHistory.files.set(key,Buffer.from('CORRUPT FIXTURE').toString('base64'));
    await page.click('[data-testid="packing-history-open"]');await page.waitForSelector('[data-testid="packing-history-resume"]');await page.click('[data-testid="packing-history-resume"]');
    await page.waitForFunction(()=>document.body.innerText.includes('저장 분석 불러오기 실패'));
    assert.equal(paidCalls,2);assert((await page.evaluate(()=>document.body.innerText)).includes('TRAINING-001'));
    for(const [key,bytes]of originals)uploadHistory.files.set(key,bytes);
    // Late history responses cannot replace a newer file or another country.
    const awaitHeld=async()=>{for(let i=0;i<200&&!heldHistory;i++)await new Promise(r=>setTimeout(r,25));assert(heldHistory);};
    const release=async()=>{const h=heldHistory;heldHistory=null;await h.req.respond({status:200,contentType:'application/json',body:JSON.stringify(h.history)});await page.waitForNetworkIdle({idleTime:150});};
    const racePdf=await PDFDocument.load(fs.readFileSync(changed));racePdf.setSubject('RACE UNIQUE');const race=path.join(changedDir,path.basename(dummy));fs.writeFileSync(race,await racePdf.save());
    holdHistory=true;await input.uploadFile(dummy);await awaitHeld();await input.uploadFile(race);
    await page.waitForFunction(name=>document.querySelector('[data-testid="packing-file-choice"]')?.innerText.includes(name),{},path.basename(race));
    await release();assert((await page.$eval('[data-testid="packing-file-choice"]',n=>n.innerText)).includes(path.basename(race)));assert.equal(paidCalls,2);
    await page.focus('[data-testid="packing-file-cancel"]');await page.keyboard.press('Escape');await page.waitForSelector('[data-testid="packing-file-choice"]',{hidden:true});
    holdHistory=true;await input.uploadFile(dummy);await awaitHeld();await page.click('[data-testid="packing-country-back"]');await page.click('button[aria-label="네덜란드"]');await release();
    assert(!(await page.evaluate(()=>document.body.innerText)).includes('TRAINING-001'));assert.equal(paidCalls,2);
    await page.click('[data-testid="packing-country-back"]');await page.click('button[aria-label="콜롬비아"]');
    await page.focus('[data-testid="packing-history-open"]');await page.keyboard.press('Enter');await page.waitForSelector('[aria-label="보관된 파일명 검색"]');
    await page.focus('[aria-label="보관된 파일명 검색"]');await page.type('[aria-label="보관된 파일명 검색"]',path.basename(dummy));await page.keyboard.press('Tab');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.body.innerText.includes('저장 분석 재사용 · API 호출 없음'));
    await page.setViewport({width:390,height:844,deviceScaleFactor:1});await page.waitForNetworkIdle({idleTime:150});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile page overflow');
    await page.screenshot({path:'.verify/packing-reuse-mobile.png'});assert.equal(paidCalls,2);assert.equal(external,0);assert.equal(writes,0);
  }
  console.log(JSON.stringify({passed:true,dry,freeCalls,mockAnalysisRequests:paidCalls,providerCalls:0,productionWrites:writes,external}));
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
