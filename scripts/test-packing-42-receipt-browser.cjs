// Private real-file fixture. Called only inside the existing loopback-only SQL harness.
// Production evidence is read-only; all browser APIs are intercepted and SQL uses the
// invocation-owned NenovaInvoiceFixture_* pool. No production credentials are loaded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
module.exports=async function({pool,sql,query,writer,documents,ctx,protectedSnapshot}){
 const evidence=JSON.parse(fs.readFileSync(process.env.NENOVA_FIXTURE_42_EVIDENCE,'utf8'));
 assert.match(pool.config.database,/^NenovaInvoiceFixture_/);assert.equal(pool.config.server,'127.0.0.1');assert.equal(pool.config.port,14339);
 const {upsertPackingErpMatch}=await import('../lib/importPackingErpMatches.js');
 let catalog={...evidence.catalog,value:{version:1,entries:[]}};
 for(const m of evidence.mappings.slice(1))catalog.value=upsertPackingErpMatch(catalog.value,{country:'CN',description:m.source,prodKey:m.prodKey},catalog.products);
 assert.equal(evidence.mappings.length,64);assert.equal(evidence.products.length,61);
 console.log('42 fixture: seed products');
 for(const p of evidence.products){
  const ps={};for(const [k,v]of Object.entries(p))if(k!=='isDeleted')ps[k]={type:typeof v==='number'?sql.Float:sql.NVarChar,value:v};
  ps.ProdKey={type:sql.Int,value:p.ProdKey};
  await query(pool,`INSERT dbo.Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Stock,isDeleted)
    VALUES(@ProdKey,@ProdName,@CountryFlower,@CounName,@FlowerName,@OutUnit,@EstUnit,@BunchOf1Box,@SteamOf1Bunch,@SteamOf1Box,0,0);
    INSERT dbo.ProductStock(StockKey,ProdKey,Stock) VALUES(2501,@ProdKey,0);`,ps);
 }
 await query(pool,"INSERT dbo.Farm(FarmKey,FarmName,CounKey,isDeleted) VALUES(7102,N'HUBFRESH',1,0);");
 await query(pool,`UPDATE dbo.StockMaster SET OrderWeek='42-01',OrderYearWeek=OrderYear+'4201' WHERE StockKey IN (2501,2601);
 CREATE TABLE SystemActionLog(LogKey int IDENTITY PRIMARY KEY,ActionDtm datetime DEFAULT GETDATE(),Actor nvarchar(100),ActionType nvarchar(100),Method nvarchar(20),Endpoint nvarchar(200),AffectedTable nvarchar(100),AffectedCount int,Payload nvarchar(max),Result nvarchar(20),ResultDesc nvarchar(300),RiskLevel nvarchar(20));`);
 const protectedBefore=await protectedSnapshot(pool);console.log('42 fixture: browser start');
 if(process.env.NENOVA_NATIVE_UI_TEST==='1')return require('./test-packing-native-local.cjs')({pool,sql,query,writer,documents,ctx,protectedSnapshot,protectedBefore,catalog,upsertPackingErpMatch});
 const listener=require('node:net').createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://127.0.0.1:${port}`,secret=randomUUID(),env={...process.env,JWT_SECRET:secret};
 for(const k of Object.keys(env))if(/^(DB_|MSSQL|SQL_|NENOVAWEB_SERVICE)/.test(k))delete env[k];
 // Use the previously verified production build of the same packing components.
 const buildRoot=path.resolve(__dirname,'..');
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{cwd:buildRoot,env,stdio:'ignore',windowsHide:true});
 let browser,committed,commitRequest,saved,preview;const errors=[],apiErrors=[],dialogs=[],auditRows=[];
 const {appendUploadIssue}=await import('../lib/invoiceUploadIssue.js');
 try{
  for(let i=0;i<100;i++){try{await fetch(base);break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await require('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const c=await browser.createBrowserContext();await c.setCookie({name:'nenovaToken',value:require('jsonwebtoken').sign({userId:'invoice-fixture',authority:1,accountActive:true},secret,{expiresIn:'30m'}),url:base});
  const p=await c.newPage();await p.setViewport({width:1920,height:1080});p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
  await p.setRequestInterception(true);p.on('request',async r=>{
   const u=new URL(r.url());if(['data:','blob:'].includes(u.protocol))return r.continue();if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();
   let d={success:true,rows:[],items:[],documents:[],value:null,revision:0};let status=200;
   try{
    const body=r.postData()?JSON.parse(r.postData()):{},route=u.pathname,parts=route.split('/'),id=parts[4];
    if(route==='/api/auth/me')d={success:true,user:{userId:'invoice-fixture',authority:1,accountActive:true}};
    else if(route==='/api/import/tools/product-matches'){
      if(r.method()==='POST')catalog.value=upsertPackingErpMatch(catalog.value,body,catalog.products);
      d={success:true,scope:'team',...catalog,revision:1};
    }
    else if(route==='/api/import/upload-issues'){
      if(r.method()==='POST')await appendUploadIssue({withTransaction:ctx.withTransactionFn,sql,actor:'invoice-fixture',input:body});
      const logs=(await query(pool,"SELECT LogKey,Actor,Payload FROM SystemActionLog WHERE ActionType='INVOICE_UPLOAD_ISSUE'")).recordset;
      auditRows.splice(0,auditRows.length,...logs.map(x=>({id:x.LogKey,actor:x.Actor,...JSON.parse(x.Payload)})));d={success:true,rows:auditRows};
    }
    else if(route==='/api/arrival-cost')d={success:true,farms:[{FarmKey:7102,FarmName:'HUBFRESH'}]};
    else if(route==='/api/import/tools/upload-history')d={success:true,record:{id:'isolated-only'},rows:[]};
    else if(route==='/api/import/receipts/drafts'&&r.method()==='POST'){
      saved=await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,input:body,actor:'invoice-fixture'});d={success:true,document:saved};
    }else if(route.endsWith('/preview')){
      preview=await writer.previewInvoiceReceipt({queryFn:ctx.queryFn,types:sql,documentId:id,revision:body.revision});d={success:true,preview};
    }else if(route.endsWith('/commit')){
      commitRequest={...body,documentId:id,actor:'invoice-fixture'};committed=await ctx.create(commitRequest);d={success:true,result:committed};
    }else if(route.startsWith('/api/import/receipts/')&&parts.length===5&&id!=='drafts'){
      if(r.method()==='PATCH')saved=await documents.saveInvoiceDraft({withTransactionFn:ctx.withTransactionFn,types:sql,input:body,actor:'invoice-fixture',documentId:id});
      d={success:true,document:await documents.getInvoiceDocument({queryFn:ctx.queryFn,types:sql,documentId:id})};
    }
   }catch(e){status=400;d={success:false,code:e.code,error:e.message};apiErrors.push({path:u.pathname,code:e.code,message:e.message});}
   await r.respond({status,contentType:'application/json',body:JSON.stringify(d)});
  });
  const click=async text=>{await p.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===t&&!b.disabled),{},text);await p.evaluate(t=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===t).click(),text);};
  const set=async(sel,v)=>p.$eval(sel,(e,value)=>{Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},v);
  await p.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0'});console.log('42 fixture: page',await p.evaluate(()=>window.__NEXT_DATA__?.props?.pageProps));await p.click('button[aria-label="중국"]');
  await(await p.$('input[accept*=".pdf"]')).uploadFile(path.resolve(__dirname,'../42-1 CHINA CI.test.pdf'));await click('패킹 리스트 생성');
  console.log('42 fixture: generate clicked');await p.waitForSelector('[data-testid="packing-product-match"]',{timeout:45000});
  await p.evaluate(()=>Array.from(document.querySelectorAll('[data-testid="packing-product-match"]')).find(b=>/Ammi|아미초/i.test(b.closest('tr').innerText)).click());
  await p.waitForSelector('[data-testid="packing-match-dialog"]');await p.click(`[data-candidate="${evidence.mappings[0].prodKey}"]`);
  await p.waitForFunction(()=>!document.querySelector('[data-testid="packing-match-dialog"]'));
  assert.ok(catalog.value.entries.some(e=>e.prodKey===evidence.mappings[0].prodKey));
  await p.waitForSelector('[data-testid="packing-review-open"]',{timeout:45000});
  await p.screenshot({path:'.test-42-matched.png'});
  await p.click('[data-testid="packing-review-open"]');
  await p.waitForSelector('[data-testid="metadata-date"]');await set('[data-testid="metadata-date"]','2026-10-10');await click('수정값 적용 · 결과 재생성');
  await p.waitForSelector('[data-testid="packing-review-blocked"]');assert.match(dialogs.at(-1),/인쇄 날짜 확인 사유/);
  await new Promise(r=>setTimeout(r,300));assert.ok(auditRows.some(x=>x.code==='REVIEW_BLOCKED'&&/인쇄 날짜 확인 사유/.test(x.detail)));
  await set('[data-testid="metadata-reason-date"]','TEST_ONLY 원문 10/10/2026 날짜 확인');
  await click('수정값 적용 · 결과 재생성');
  await p.waitForFunction(()=>!document.querySelector('[data-testid="metadata-date"]'));
  const next=await p.evaluate(()=>Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim()).filter(t=>/입고.*준비|다음.*입고/.test(t)));console.log('NEXT_BUTTONS',next);
  await click(next[0] || '입고 업로드로 이동');await p.waitForSelector('[data-testid="invoice-receipt-workbench"]');
  const field=async(label,value)=>{const selector=await p.evaluate(t=>{const l=Array.from(document.querySelectorAll('[data-testid="invoice-receipt-workbench"] label')).find(l=>l.textContent.trim().startsWith(t));if(!l)throw Error('missing field '+t);const e=l.querySelector('input,select');e.dataset.testField=t;return `[data-test-field="${t}"]`;},label);if(await p.$eval(selector,e=>e.tagName==='SELECT'))await p.select(selector,value);else await set(selector,value);};
  await field('입고 연도','2026');await field('세부차수','42-01');await field('입고일','2026-10-10');await field('농장 선택','7102');
  await click('초안 저장');await click('서버 미리보기');
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='ERP 입고 등록 확인'&&!b.disabled),{timeout:30000}).catch(async e=>{console.log('PREVIEW_ISSUES',preview?.issues,apiErrors);throw e;});
  assert.equal(preview.canCommit,true);assert.equal(preview.lines.length,64);assert.ok(saved.lines.every(l=>l.prodKey));
  await click('ERP 입고 등록 확인');await set('[role="dialog"][aria-label="ERP 입고 등록 최종 확인"] textarea','TEST_ONLY 실제 인보이스 64행 격리 SQL 검증; 기존 입고 연결 재현, 운영 쓰기 금지');await click('이 범위로 등록');
  await p.waitForFunction(()=>document.body.innerText.includes('WarehouseKey'),{timeout:30000});
  assert.ok(committed?.warehouseKey);
  await p.waitForFunction(()=>document.body.innerText.includes('등록 문서 · WarehouseKey 91001'));
  assert.doesNotMatch(await p.$eval('body',e=>e.innerText),/WarehouseKey undefined/);
  await p.screenshot({path:'.test-42-committed.png'});
  const readback=await documents.getInvoiceDocument({queryFn:ctx.queryFn,types:sql,documentId:saved.documentId});assert.equal(readback.receiptStatus,'COMMITTED');
  const details=(await query(pool,'SELECT * FROM dbo.WarehouseDetail WHERE WarehouseKey=@wk ORDER BY WdetailKey',{wk:{type:sql.Int,value:committed.warehouseKey}})).recordset;
  assert.equal(details.length,64);for(const [i,d]of details.entries()){const s=evidence.corrected.products[i];assert.equal(d.ProdKey,evidence.mappings[i].prodKey);for(const [k,v]of Object.entries({BoxQuantity:s.pcs,BunchQuantity:s.total_bunch,SteamQuantity:s.total_stems,UPrice:s.u_price,TPrice:s.t_price}))assert.ok(Math.abs(d[k]-v)<1e-6,`${i+1} ${k}`);}
  const replay=await ctx.create(commitRequest);assert.deepEqual(replay,committed);
  const stocks=(await query(pool,`SELECT p.ProdKey,p.Stock,ps.Stock WeekStock,prior.Stock PriorStock
    FROM dbo.Product p JOIN dbo.ProductStock ps ON ps.ProdKey=p.ProdKey AND ps.StockKey=2601
    JOIN dbo.ProductStock prior ON prior.ProdKey=p.ProdKey AND prior.StockKey=2501
    WHERE p.ProdKey NOT IN (7201,7202)`)).recordset;
  assert.equal(stocks.length,61);
  for(const row of stocks){const expected=details.filter(d=>d.ProdKey===row.ProdKey).reduce((n,d)=>n+Number(d.BunchQuantity),0);
    assert.equal(Number(row.PriorStock),0);assert.ok(Math.abs(Number(row.WeekStock)-expected)<1e-6);assert.ok(Math.abs(Number(row.Stock)-expected)<1e-6);}
  const duplicate=await ctx.preview(saved.documentId,readback.revision);assert.ok(duplicate.issues.some(x=>x.code==='ALREADY_COMMITTED'));
  assert.deepEqual(await protectedSnapshot(pool),protectedBefore);assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[]);
  const blocked=auditRows.find(x=>x.code==='REVIEW_BLOCKED');assert.ok(blocked);assert.equal(blocked.actor,'invoice-fixture');
  await appendUploadIssue({withTransaction:ctx.withTransactionFn,sql,actor:'invoice-fixture',input:blocked});
  assert.equal((await query(pool,"SELECT COUNT(*) n FROM SystemActionLog WHERE JSON_VALUE(Payload,'$.eventId')=@id",{id:{type:sql.NVarChar(36),value:blocked.eventId}})).recordset[0].n,1);
  await click('업로드 문제 로그');await p.waitForFunction(()=>document.querySelector('[aria-label="인보이스 업로드 문제 로그"]').innerText.includes('인쇄 날짜 확인 사유'));
  const total=k=>details.reduce((s,d)=>s+Number(d[k]),0);
  const report={mode:'TEST_ONLY actual PDF + history-backed mapping + isolated SQL commit',mappedRows:64,uniqueProducts:61,warehouseRows:details.length,boxes:total('BoxQuantity'),bunches:total('BunchQuantity'),stems:total('SteamQuantity'),goodsCny:total('TPrice'),idempotentReplay:true,dateBlockLogged:true,operationalWrites:0};
  fs.writeFileSync('.test-42-report.json',JSON.stringify(report,null,2));console.log('PACKING42_BROWSER_SQL_PASS',JSON.stringify(report));
 }catch(e){if(browser){const pages=await browser.pages();await pages.at(-1)?.screenshot({path:'.test-42-failure.png'});console.log('UI_FAILURE',e.message,(await pages.at(-1)?.$eval('body',e=>e.innerText)).slice(-7000));console.log('API_ERRORS',apiErrors);}throw e;}
 finally{child.kill();if(browser){await Promise.race([browser.close(),new Promise(r=>setTimeout(()=>{browser.process()?.kill();r();},5000))]);}}
};
