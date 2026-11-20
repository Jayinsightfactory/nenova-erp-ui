// Synthetic local UI smoke. All API traffic intercepted; no ERP write is possible.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const puppeteer=require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];await page.setViewport({width:1920,height:1080});
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});let repeatWarnings=0;
  page.on('dialog',d=>{if(d.message().includes('한 번 더 합산')){repeatWarnings++;return d.dismiss();}return d.accept();});
  const user={userId:'fixture',userName:'합산 연습',authority:1,Authority:1,accountActive:true};
  await page.evaluateOnNewDocument(u=>localStorage.setItem('nenovaUser',JSON.stringify(u)),user);
  let previews=0,applies=0,exports=0,kind='FINAL',mode='REPLACE';
  await page.setRequestInterception(true);
  page.on('request',async req=>{
   const u=new URL(req.url());if(!u.pathname.startsWith('/api/'))return req.continue();
   let data={success:true,rows:[],items:[],favorites:[],data:[],user};
   if(u.pathname.endsWith('/distribute-import-preview')){
    previews++;const body=await req.fetchPostData()||'';mode=/name="addToExisting"\r\n\r\ntrue/.test(body)?'ADD':'REPLACE';kind=/name="downloadKind"\r\n\r\nADDITIONAL/.test(body)?'ADDITIONAL':'FINAL';console.log('Preview fixture',previews,mode,kind);
    const qty=mode==='ADD'?13:3;
    const row={key:'1|2',custKey:1,prodKey:2,custName:'연습업체',prodName:'Moonlight',displayName:'문라이트',outUnit:'단',orderQty:10,uploadQty:qty,inputQty:3,excelQty:3,currentOutQty:10,orderDiffQty:0,changeQty:0,shipmentDiffQty:qty-10,needsShipmentApply:true,status:'변경',distributionMode:mode,cells:['연습!R5C2'],farmChanged:false,farmBeforeText:'연습농장 5',farmText:'연습농장 5',farmAssignments:[{farmKey:3,shipmentQuantity:5}],unassignedQty:8};
    data={success:true,distributionMode:mode,downloadKind:kind,orderYear:'2026',week:'45-01',rows:[row],unmatched:[],logs:[],summaryByCustomer:[],customerOptions:[],productOptions:[],replacementPlan:'signed-fixture',exportPlan:'export-fixture',replacementCategories:['콜롬비아카네이션'],replacementProductKeys:[2],earlyImport:{mode:'ORIGINAL_INCLUDES_EARLY',fingerprint:'fixture',scope:{year:'2026',majorWeek:'45',orderWeek:'45-01',custKeys:[1],prodKeys:[2]}},farmImport:{changedCount:0,errors:[],layoutErrors:[],reviews:[]}};
   }
   if(u.pathname.endsWith('/distribute-import-export')){exports++;return req.respond({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':`attachment; filename="fixture-${kind}.xlsx"`},body:Buffer.from('UI-only fixture')});}
   if(u.pathname.endsWith('/distribute-import-apply')){applies++;data={success:true,applied:1,verification:{mismatchCount:0},logs:['최종13 검증완료'],appliedRows:[]};}
   if(u.pathname.endsWith('/distribute-import-apply-progress'))data={success:true,progress:{status:'RUNNING',done:0,total:1}};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.setCookie({name:'nenovaToken',value:require('jsonwebtoken').sign({userId:'fixture',authority:1,accountActive:true},'nenova-dev-only-secret-change-me'),url:'http://localhost:3156'});
  await page.goto((process.env.ADDITIVE_SMOKE_URL||'http://localhost:3156')+'/shipment/distribute-import?week=2026-45-01',{waitUntil:'networkidle2',timeout:120000});
  console.log('Loaded',page.url(),'page errors',errors);
  const rec=process.argv.includes('--record')?await require('./lib/workflow-guide-recorder.cjs').createWorkflowGuideRecorder(page,{workflowId:'shipment-additive-import',guideId:'support',title:'기존 분배 합산 · 합산본/추가분 다운로드',sourceFiles:['pages/shipment/distribute-import.js'],fixtureOnly:true}):null;
  const step=async(n,scenario,title,selector)=>{if(!rec)return;await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));rec.chapter(scenario,`${n}. ${title}`);await rec.caption(`${n}. ${title}`);await rec.focus(selector,n);await rec.pause(1500);await rec.unfocus();};
  const checkbox='input[aria-label="기존 분배에 합산하기"]';await page.waitForSelector(checkbox);
  assert.equal(await page.$eval(checkbox,e=>e.checked),false);
  const fixture=path.join(os.tmpdir(),'additive-ui-fixture.xlsx');fs.writeFileSync(fixture,'UI fixture');await(await page.$('input[type=file]')).uploadFile(fixture);
  await step(1,'upload','파일을 선택한 뒤 기본 교체 방식과 대상 차수를 확인합니다',checkbox);
  const click=async label=>{await page.waitForFunction(s=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===s&&!b.disabled),{},label);for(const b of await page.$$('button'))if((await b.evaluate(e=>e.textContent)).trim()===label){console.log('Click',label);await b.focus();await page.keyboard.press('Enter');return;}throw Error('Missing button '+label);};
  const verify=async()=>{const n=previews;await click('수정 내역 + 농장분배 검증');await page.waitForFunction(()=>document.body.textContent.includes('검증된 품종 범위')||document.body.textContent.includes('기존 분배에 추가분 합산'));assert.equal(previews,n+1);};
  assert.equal(exports,0,'File selection must not auto-download');
  await verify();assert.equal(mode,'REPLACE');
  await page.focus(checkbox);await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('input[aria-label="기존 분배에 합산하기"]').checked);await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='검증된 엑셀 다운로드').disabled);
  assert.equal((await page.$$('input[type=radio]')).length>=2,true);
  await step(2,'add','기존 분배에 합산하기를 체크합니다',checkbox);
  await page.click('input[type=radio][value=ADDITIONAL]');await verify();assert.equal(mode,'ADD');assert.equal(kind,'ADDITIONAL');
  await step(3,'additional','추가분 별도를 선택하고 검증하면 이번 추가수량만 다운로드됩니다','input[type=radio][value=ADDITIONAL]');
  assert.ok((await page.$eval('.farm-comparison-canvas',e=>e.textContent)).includes('13'));
  await step(4,'verify','합산전10 + 추가3 = 최종13과 농장 미배정 수량을 함께 확인합니다','[aria-label="검증표 확대 축소"]');
  await click('검증된 엑셀 다운로드');await page.waitForFunction(()=>!document.body.textContent.includes('다운로드 준비 중'));assert.equal(exports,1);
  await page.focus('input[type=radio][value=FINAL]');await page.keyboard.press('Space');await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='검증된 엑셀 다운로드').disabled);await verify();assert.equal(kind,'FINAL');
  await step(5,'final','합산본을 선택하면 다시 검증한 최종합계13을 다운로드합니다','input[type=radio][value=FINAL]');
  const proof=process.env.ADDITIVE_PROOF_DIR||os.tmpdir();await page.screenshot({path:path.join(proof,'additive-desktop.png'),fullPage:true});
  const before=previews;await click('승인 후 주문등록+분배');await page.waitForFunction(()=>document.body.textContent.includes('합산 반영 완료'));
  assert.equal(applies,1);assert.equal(previews,before,'Successful addition must not auto-preview again');assert.equal(await page.$eval('input[type=radio][value=FINAL]',e=>e.matches(':disabled')),true);
  await step(6,'apply','승인 후 최종13을 저장하며 완료한 합산은 중복 승인하지 않습니다','input[type=radio][value=FINAL]');
  await click('검증된 엑셀 다운로드');await page.waitForFunction(()=>!document.body.textContent.includes('다운로드 준비 중'));assert.equal(exports,2,'Completed verified snapshot remains downloadable');
  await click('수정 내역 + 농장분배 검증');assert.equal(repeatWarnings,1);assert.equal(previews,before);
  if(rec){const result=await rec.stop();console.log('GUIDE',JSON.stringify(result));const file='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(file,'utf8'));const item={id:'shipment-additive-import',title:'기존 분배 합산과 다운로드 선택',entryPaths:['/shipment/distribute-import'],sourceFiles:['pages/shipment/distribute-import.js'],requiredScenarios:['upload','add','additional','verify','final','apply'],guides:[{id:'support',role:'영업지원',title:'기존 분배 합산 · 합산본/추가분 다운로드',status:'ready',src:'/guides/shipment-additive-import/support.mp4',captions:'/guides/shipment-additive-import/support.ko.vtt',proof:'/guides/shipment-additive-import/support.proof.json',chapters:result.chapters}]};const i=registry.workflows.findIndex(w=>w.id===item.id);if(i<0)registry.workflows.push(item);else registry.workflows[i]=item;fs.writeFileSync(file,JSON.stringify(registry,null,2)+'\n');}
  await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(proof,'additive-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS local Chrome: default REPLACE, ADD 10+3=13, both formats, invalidation, download, locked completed snapshot, explicit repeat warning, 1920/390; operational writes=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
