// Actual UI with synthetic documents and ALL APIs intercepted. No ERP writes.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run'),root=process.cwd();
async function main(){
 const {PDFDocument}=require('pdf-lib'),pdf=await PDFDocument.create();pdf.addPage([612,792]);
 const dummy=path.join(root,'.verify/46-1 무료OCR 연습.pdf');fs.mkdirSync(path.dirname(dummy),{recursive:true});fs.writeFileSync(dummy,await pdf.save());
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const secret=crypto.randomUUID(),base='http://127.0.0.1:'+port,log=fs.openSync('.verify/free-ocr-guide-server.log','w');
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);let browser;
 try{
  for(let i=0;i<90;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(i===89)throw Error('UI server unavailable');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>console.log('UI ERROR',e.message));await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  await page.setCookie({name:'nenovaToken',value:jwt.sign({userId:'guide-import',userName:'연습 담당자',authority:4,accountActive:true},secret,{expiresIn:'1h'}),url:base});
  const invoice={farm:'연습 농장',invoice:'TRAINING-001',currency:'USD',date:'2026-11-06',invoice_total:20,freight_total:0,products:[{description:'ROSE RED',pcs:1,steam_box:100,bunch_st:25,total_stems:100,u_price:.2,t_price:20,source_page:1,source_row:1}]};
  const payload={content:[{type:'text',text:JSON.stringify({invoices:[invoice],free_ocr_review_issues:[{code:'HAWB_REVIEW',invoice:'TRAINING-001',invoicePrinted:'연습 A',manifest:'연습 B'}]})}],stop_reason:'end_turn',source:'free-ocr'};
  let freeCalls=0,paidCalls=0;
  await page.setRequestInterception(true);page.on('request',req=>{
   const u=new URL(req.url());if(!u.pathname.startsWith('/api/'))return req.continue();
   let body={success:true,products:[],value:null,revision:0,items:[],rows:[],history:[],data:[]},status=200;
   if(u.pathname==='/api/auth/me')body.user={userId:'guide-import',userName:'연습 담당자',authority:4,deptName:'수입부',accountActive:true};
   if(u.pathname==='/api/import/tools/parse-pdf'){
    const b=JSON.parse(req.postData()||'{}');if(b.cacheOnly){status=404;body={error:'No cached document'};}
    else if(b.freeOcrJobId){freeCalls++;body={status:'SUCCEEDED',result:payload,revalidation:{preserved:3,providerCalls:0}};}
    else{paidCalls++;status=403;body={error:'Paid calls forbidden in guide'};}
   }else if(u.pathname==='/api/import/tools/free-ocr')body={success:true,job:{jobId:'11111111-1111-4111-8111-111111111111',status:'SUCCEEDED',result:{sourceHash:'a'.repeat(64),pages:[]}}};
   return req.respond({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0',timeout:120000});
  console.log('page',new URL(page.url()).pathname,(await page.evaluate(()=>document.body.innerText)).slice(0,600));
  await page.waitForSelector('button[aria-label="콜롬비아"]');console.log('country ready');
  const rec=dry?null:await createWorkflowGuideRecorder(page,{workflowId:'packing-free-ocr',guideId:'import',title:'무료 OCR 복구',sourceFiles:['components/import-tools/PackingListTool.js'],fixtureOnly:true});
  const step=async(s,t)=>{rec?.chapter(s,t);if(rec){await rec.caption(t);await rec.pause(4500);}};
  await step('select','국가를 선택합니다. 무료 OCR 지원 서식을 먼저 확인하세요.');
  await page.click('button[aria-label="콜롬비아"]');
  await step('recover','원본 PDF를 선택합니다. 완료된 구간을 유지하고 유료 호출 없이 복구합니다.');
  const input=await page.$('input[type="file"][accept=".pdf"]');assert(input);await input.uploadFile(dummy);console.log('fixture selected');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('무료 OCR · 완료')));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('무료 OCR · 완료')&&!b.disabled));
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('무료 OCR · 완료')).click());
  try{await page.waitForFunction(()=>document.body.innerText.includes('ROSE RED'));}catch(e){console.log((await page.evaluate(()=>document.body.innerText)).slice(-6000));throw e;}
  await step('review','원본 품목과 DB 매칭을 비교합니다. 미매칭과 원본 표기 차이는 확인 필요로 남습니다.');
  assert(freeCalls>0);assert.equal(paidCalls,0);
  if(rec){await rec.pause(5500);const result=await rec.stop();const file='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(file));const guide=registry.workflows.find(w=>w.id==='packing-free-ocr').guides[0];guide.status='ready';guide.chapters=result.chapters;fs.writeFileSync(file,JSON.stringify(registry,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,dry,freeCalls,paidCalls,productionWrites:0}));
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
