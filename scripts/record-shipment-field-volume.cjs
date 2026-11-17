const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const {fixture}=require('./lib/shipment-field-fixture.cjs');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run'),base=process.env.GUIDE_BASE_URL||'http://localhost:33241';
(async()=>{const f=await fixture();fs.mkdirSync('.verify/field-volume',{recursive:true});const input=path.resolve('.verify/field-volume/input.xlsx');fs.writeFileSync(input,f.input);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-dev-shm-usage']});
try{const context=await browser.createBrowserContext({downloadBehavior:{policy:'allow',downloadPath:path.resolve('.verify/field-volume')}});await context.setCookie({name:'nenovaToken',value:require('jsonwebtoken').sign({userId:'fixture',authority:1,accountActive:true},'isolated-field-volume-fixture'),url:base});
const page=await context.newPage();page.setDefaultTimeout(60000);await page.setViewport({width:1920,height:1080});const errors=[],downloads=[];let stage=0,previewCount=0,exportCount=0,rawExportCount=0;
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.evaluateOnNewDocument(()=>{localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'연습',authority:1,accountActive:true}));});
await page.setRequestInterception(true);page.on('request',async req=>{try{const url=new URL(req.url());if(['blob:','data:'].includes(url.protocol))return req.continue();if(url.origin!==base)return req.abort();
if(url.pathname==='/__raw-print.png')return req.respond({status:200,contentType:'image/png',body:fs.readFileSync('.verify/field-volume/raw-print.png')});
if(url.pathname==='/__field-print.png')return req.respond({status:200,contentType:'image/png',body:fs.readFileSync('.verify/field-volume/print.png')});
if(!url.pathname.startsWith('/api/'))return req.continue();let data={success:true,rows:[],items:[],data:[],history:[],operations:[]};
if(url.pathname==='/api/auth/me')data.user={userId:'fixture',userName:'연습',authority:1,accountActive:true};
if(url.pathname==='/api/shipment/distribute-import-preview'){
previewCount++;const farmInput=await req.fetchPostData()||'';
const hasFarm=farmInput.includes('연습농장'),r={...f.row,currentOutQty:stage>0?3:0,shipmentDiffQty:stage>0?0:3,needsShipmentApply:stage===0||(hasFarm&&stage<2),farmChanged:hasFarm&&stage<2,farmText:hasFarm?'연습농장 3':'',farmAssignments:hasFarm?[{farmKey:4,shipmentQuantity:3}]:undefined,farmBefore:stage>=2?[{farmKey:4,shipmentQuantity:3}]:[],farmBeforeText:stage>=2?'연습농장 3':''};
data={success:true,orderYear:'2026',week:'46-02',rows:[r],applyRows:r.needsShipmentApply?[r]:[],changedRows:[],unmatched:[],summaryByCustomer:[],replacementCategories:['연습카네이션'],replacementScopeLabels:['연습카네이션'],replacementProductKeys:[2],replacementPlan:'fixture',exportPlan:'fixture-original',fieldExportPlan:'fixture-field',fieldExportReady:stage>=2&&!r.farmChanged,fieldExportError:'',drawingFarmText:'-연습업체\n돈셀 3(연습농장)',farmImport:{errors:[],reviews:[],changedCount:r.farmChanged?1:0,layoutErrors:[]},earlyImport:{mode:'ALREADY_EXCLUDED',fingerprint:'fixture',scope:[]},totals:{rows:1,uploadQty:3},logs:['연습 물량표 검증 완료']};}
if(url.pathname==='/api/shipment/distribute-import-farms'){assert.equal(stage,0);assert((await req.fetchPostData()).includes('연습농장'));stage=2;data={success:true,changed:1};}
if(url.pathname==='/api/shipment/distribute-import-apply')throw Error('독립 작업에서 주문분배 API 호출');
if(url.pathname==='/api/shipment/field-sources'){
 const item={id:'fixture:carnation',revision:'fixture',label:'카네이션',filename:'input.xlsx'};
 const body=req.method()==='POST'?(await req.fetchPostData()||''):'';
 if(body.includes('name="selection"')){
   assert(body.includes(item.id));
   assert.match(body,new RegExp('name="includePrevious"\\s+(?:'+(stage===0?'true':'false')+')'));
   const raw=stage===0;if(raw)rawExportCount++;else exportCount++;
   const filename=raw?'input-신형현장물량표-업로드기준.xlsx':'input-신형현장물량표.xlsx';
   return req.respond({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filename)},body:raw?f.rawOutput:f.currentOutput});
 }
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify({items:req.method()==='POST'||rawExportCount?[item]:[]})});
}
if(url.pathname==='/api/shipment/distribute-import-export'){const body=await req.fetchPostData();const raw=body.includes('field-upload');assert(raw||body.includes('field-volume'));if(raw){assert.equal(stage,0);assert.equal(previewCount,0);rawExportCount++;}else exportCount++;return req.respond({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename="field.xlsx"'},body:raw?f.rawOutput:f.currentOutput});}
return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
}catch(e){errors.push(e.message);try{await req.abort();}catch{}}});
const client=await page.createCDPSession();await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.resolve('.verify/field-volume'),eventsEnabled:true});client.on('Browser.downloadProgress',d=>{if(d.state==='completed')downloads.push(d.guid);});
await page.goto(base+'/shipment/distribute-import?week=2026-46-02',{waitUntil:'networkidle0'});await page.waitForSelector('input[type=file]');
const button=async label=>{const bs=await page.$$('button');for(const b of bs)if(await b.evaluate((e,s)=>e.textContent.trim()===s,label))return b;throw Error('Missing button '+label);};
const mark=async label=>{const b=await button(label);await b.evaluate(e=>{e.scrollIntoView({block:'center'});document.querySelectorAll('[data-field-focus]').forEach(x=>x.removeAttribute('data-field-focus'));e.dataset.fieldFocus='true';});return b;};
let rec;if(!dry)rec=await createWorkflowGuideRecorder(page,{workflowId:'shipment-field-volume',guideId:'support',title:'물량표 바로 생성 · 분배·농장 적용 후 생성',sourceFiles:['pages/shipment/distribute-import.js'],fixtureOnly:true});
const step=async(n,scenario,title,selector,action)=>{if(rec){rec.chapter(scenario,`${n}. ${title}`);await rec.caption(`${n}. ${title}`);await rec.focus(selector,n);}console.log('step',n,title);await action();if(rec){await rec.pause(2800);await rec.unfocus();}};
await page.waitForFunction(()=>document.querySelector('input[placeholder="22-01"]')?.value==='2026-46-02');
await mark('파일 선택');await step(1,'upload','파일 선택으로 물량표를 올립니다','[data-field-focus]',async()=>{const chooser=page.waitForFileChooser();await(await button('파일 선택')).click();await(await chooser).accept([input]);});
await page.waitForFunction(()=>document.body.innerText.includes('파일 선택 완료'));assert.equal(downloads.length,0);assert.equal(rawExportCount,0);
await mark('신형 물량표 다운로드');await step(1,'upload-only','원하는 시점에 신형 물량표 다운로드를 누릅니다','[data-field-focus]',async()=>{await(await button('신형 물량표 다운로드')).click();});
await new Promise(r=>setTimeout(r,600));assert.equal(rawExportCount,1,JSON.stringify(errors));assert.equal(stage,0);assert.equal(previewCount,0);assert.deepEqual(fs.readFileSync('.verify/field-volume/input-신형현장물량표-업로드기준.xlsx'),f.rawOutput);
const area='textarea[aria-label="농장분배 카톡 내용"]';await page.$eval(area,e=>e.scrollIntoView({block:'center'}));
await step(2,'farm','카톡 내용을 붙여넣어 업체·품목·농장을 지정합니다',area,async()=>{await page.focus(area);await page.type(area,'-연습업체\n돈셀 3(연습농장)',{delay:90});});
await mark('카톡 농장 적용');await step(2,'farm','카톡 농장 적용으로 기존 출고의 농장만 저장합니다','[data-field-focus]',async()=>{await(await button('카톡 농장 적용')).click();await page.waitForFunction(()=>document.body.innerText.includes('농장분배 1건 적용 완료'));});
assert.equal(previewCount,0);
const combine=await page.waitForSelector('label:has(input[type=checkbox]):not(fieldset label) input[type=checkbox]');assert(await combine.evaluate(el=>el.checked));await combine.click();
await mark('신형 물량표 다운로드');await step(3,'generate','1차 물량 합산을 풀고 2차 작업량을 다운로드합니다','[data-field-focus]',async()=>{const b=await button('신형 물량표 다운로드');await b.focus();await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert(await b.evaluate(e=>e===document.activeElement));await page.keyboard.press('Enter');await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.includes('다운로드 준비')));});
await new Promise(r=>setTimeout(r,600));assert.equal(exportCount,1);assert.equal(stage,2);const downloaded=path.resolve('.verify/field-volume/input-신형현장물량표.xlsx');assert(fs.existsSync(downloaded),'actual downloaded workbook missing');assert.deepEqual(fs.readFileSync(downloaded),f.currentOutput);
await page.screenshot({path:'.verify/field-volume/page-1920.png',fullPage:true});
await page.goto(base+'/__raw-print.png',{waitUntil:'networkidle0'});await page.waitForSelector('img');await page.$eval('img',img=>{img.style.width='3200px';img.style.maxWidth='none';img.style.height='auto';document.body.style.margin='0';document.body.style.background='white';});if(rec){await rec.restoreOverlay();rec.chapter('review','4. 바로 생성 엑셀의 원본 수량을 확인합니다');await rec.caption('4. 바로 생성 결과: 원본 돈셀 3 · 입고 5 · 재고 1\n이전차수 분배는 포함하지 않습니다.');await rec.pause(5500);}
await page.goto(base+'/__field-print.png',{waitUntil:'networkidle0'});await page.waitForSelector('img');await page.$eval('img',img=>{img.style.width='3200px';img.style.maxWidth='none';img.style.height='auto';document.body.style.margin='0';document.body.style.background='white';});if(rec){await rec.restoreOverlay();rec.chapter('review','4. 생성 엑셀의 인쇄 결과와 수량을 확인합니다');await rec.caption('4. 1차 물량 합산 해제 · 돈셀 2차 작업량 3\n요일색과 입고 5 · 출고 3 · 재고 1 · 잔량 3을 확인합니다.');await rec.pause(7000);const result=await rec.stop();require('./lib/shipment-field-guide-caption.cjs').finalize();const p='config/workflow-guides.json',r=JSON.parse(fs.readFileSync(p));const g=r.workflows.find(w=>w.id==='shipment-field-volume').guides[0];g.status='ready';g.chapters=result.chapters;fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n');}
await page.goto(base+'/shipment/distribute-import?week=2026-46-02',{waitUntil:'networkidle0'});await page.setViewport({width:390,height:844});await page.screenshot({path:'.verify/field-volume/page-390.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:'PASS',stage,previewCount,exportCount,downloads:downloads.length,mode:dry?'dry-run':'recorded'}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
