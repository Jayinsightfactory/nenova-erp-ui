const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
(async () => {
 const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try { for (const popup of [false,true]) {
  const page=await browser.newPage(), errors=[], writes=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
  await page.setViewport({width:1920,height:1080,deviceScaleFactor:1}); await page.setRequestInterception(true);
  const rows=[{deductionKey:498,custKey:315,customerName:'동산',prodKey:447,productName:'카네이션',quantity:4,sourceUnit:'단',orderYear:2026,orderWeek:'38',rowVersionNo:4,estimateKey:9534,status:'CARRYOVER',remainingQuantity:4,registrationEligible:false,note:''},{deductionKey:743,custKey:null,customerName:'꽃길',prodKey:null,productName:'카네이션',quantity:6,sourceUnit:'단',orderYear:2026,orderWeek:'40',rowVersionNo:2,status:'DRAFT',registrationEligible:true,note:''}];
  page.on('request',req=>{
   if(!req.url().includes('/api/')) { if(!['GET','HEAD'].includes(req.method())) return req.abort(); return req.continue(); }
   let body={success:true}; const url=new URL(req.url());
   if(req.method()!=='GET') {
    const data=JSON.parse(req.postData()||'{}'); writes.push(data);
    if(!['manage-edit','manage-archive'].includes(data.action)) return req.respond({status:403,contentType:'application/json',body:'{"error":"blocked"}'});
    if(data.action==='manage-edit'&&data.preview===true&&data.changes?.note==='충돌테스트') return req.respond({status:409,contentType:'application/json',body:JSON.stringify({success:false,error:'조회 버전이 변경됐습니다. 다시 조회하세요.'})});
    body.rows=[{noteOnly:data.rows[0].deductionKey===498}];
   } else if(url.pathname==='/api/auth/me') body.user={userId:'fixture',userName:'영업지원',authority:1};
   else if(url.pathname==='/api/sales/defect-deductions') {
    if(url.searchParams.get('view')==='lookups') body={success:true,customers:[{CustKey:315,CustName:'동산'}],products:[{ProdKey:447,ProdName:'CARNATION Moon Light',FlowerName:'카네이션'}]};
    else body={success:true,rows:['incoming','support','carryover'].includes(url.searchParams.get('view'))?rows:[],history:[],managerOptions:[]};
   }
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(`${process.env.SMOKE_BASE_URL||'http://localhost:3017'}/sales/defect-deductions${popup?'?popup=1':''}`,{waitUntil:'networkidle0',timeout:120000});
  const clickText=async text=>page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text); if(!b)throw Error('Missing '+text);b.click();},text);
  const scope=async value=>page.evaluate(value=>{const input=[...document.querySelectorAll('label')].find(el=>el.textContent.trim().startsWith('차수')).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await scope('40'); await clickText('영업지원 전산등록'); await page.waitForSelector('.support-grid tr.defect-row');
  await clickText('목록 수정·정리');
  await page.click('[aria-label="동산 정리 선택"]');
  assert.equal(await page.$$eval('.support-grid input[aria-label$=" 선택"]:checked',els=>els.filter(el=>!el.getAttribute('aria-label').includes('정리')).length),0,'Management selection never selects registration');
  await clickText('선택 1건 목록에서 제외');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('선택 0건 목록에서 제외')));
  const archive=writes.filter(w=>w.action==='manage-archive'); assert.equal(archive.length,2); assert.deepEqual(archive[1].rows,[{deductionKey:498,sourceYear:2026,sourceWeek:'38',expectedRowVersionNo:4}]); assert.equal(String(archive[1].week),'40'); assert.equal(archive[0].preview,true);assert.equal(archive[1].preview,false);
  await page.click('[aria-label="동산 정리 선택"]');
  await clickText('미처리·다음 차수 재시도');await page.waitForFunction(()=>document.querySelectorAll('.support-grid tr.defect-row').length===2);
  assert.equal(await page.$$eval('input[aria-label$="정리 선택"]',els=>els.length),0,'Carryover never inherits management controls');
  assert.equal(await page.$$eval('button',els=>els.filter(el=>el.textContent.includes('목록 수정·정리')).length),0);
  await page.waitForFunction(()=>[...document.querySelectorAll('.support-grid input[type=checkbox]')].some(el=>!el.disabled));
  await page.$$eval('.support-grid input[type=checkbox]',els=>els.find(el=>!el.disabled).click());
  assert(await page.$$eval('.support-grid input[type=checkbox]',els=>els.some(el=>el.checked&&!el.disabled)),'Carryover registration selection remains usable');
  await clickText('영업지원 전산등록');await page.waitForFunction(()=>document.querySelectorAll('.support-grid tr.defect-row').length===2);
  assert.equal(await page.$$eval('input[aria-label$="정리 선택"]',els=>els.length),0);
  assert.equal(await page.$$eval('button',els=>els.some(el=>el.textContent.includes('목록에서 제외'))),false);
  await clickText('목록 수정·정리');await page.click('[aria-label="동산 정리 선택"]');await scope('39');
  await page.waitForFunction(()=>!document.querySelector('input[aria-label$="정리 선택"]'));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='목록 수정·정리'&&!b.disabled));await clickText('목록 수정·정리');
  await page.$$eval('.support-grid tr.defect-row button',buttons=>buttons.find(b=>b.textContent==='수정').click());
  await page.waitForSelector('[aria-label="불량 목록 수정"]');
  assert.equal(await page.$('[aria-label="수정 수량"]'),null,'Linked row note-only');
  await page.$eval('[aria-label="수정 비고"]',el=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'충돌테스트');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await clickText('목록 수정 저장');await page.waitForFunction(()=>document.querySelector('[aria-label="불량 목록 수정"] [role=alert]')?.textContent.includes('조회 버전이 변경'));
  assert.equal(writes.filter(w=>w.action==='manage-edit'&&w.preview===false).length,0,'409 stops apply with visible modal error');
  await page.waitForFunction(()=>!document.querySelector('[aria-label="수정 비고"]').disabled);
  await page.$eval('[aria-label="수정 비고"]',el=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'확인');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await clickText('목록 수정 저장'); await page.waitForFunction(()=>!document.querySelector('[aria-label="불량 목록 수정"]'));
  const edit=writes.filter(w=>w.action==='manage-edit' && w.preview===false); assert.deepEqual(edit[0].changes,{note:'확인'});
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=tab]')].every(b=>!b.disabled));
  await scope('40');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='목록 수정·정리'&&!b.disabled));
  await clickText('수입부 확인'); await page.waitForSelector('.incoming-grid tr.defect-row');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='목록 수정·정리'&&!b.disabled));await clickText('목록 수정·정리');
  await page.click('[aria-label="꽃길 정리 선택"]');
  assert.equal(await page.$eval('[aria-label="꽃길 정리 선택"]',el=>el.checked),true,'Ineligible draft can be managed in incoming');
  await page.$$eval('.incoming-grid tr.defect-row',rs=>rs.find(r=>r.textContent.includes('꽃길')).querySelector('button').click());
  await page.waitForSelector('[aria-label="수정 수량"]');
  assert(await page.$('[aria-label="수정 검색 대상"]'),'Draft supports DB lookup');
  const rect=await page.$eval('[aria-label="불량 목록 수정"]',el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}); assert(rect.left>=0&&rect.right<=1920&&rect.top>=0&&rect.bottom<=1080);
  fs.mkdirSync('outputs/defect-management',{recursive:true});await page.screenshot({path:`outputs/defect-management/${popup?'popup':'normal'}-1920.png`});
  await page.$eval('[aria-label="수정 비고"]',el=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'미매칭 비고');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await clickText('목록 수정 저장');await page.waitForFunction(()=>!document.querySelector('[aria-label="불량 목록 수정"]'));
  const draftEdit=writes.filter(w=>w.action==='manage-edit'&&w.preview===false&&w.rows[0].deductionKey===743);assert.deepEqual(draftEdit[0].changes,{note:'미매칭 비고'},'Unmatched draft note edit omits unchanged null keys');
  for (const request of writes) {
    for (const row of request.rows || []) {
      assert.equal(Number(row.sourceYear), Number(request.year), 'Every management request preserves selected/source year');
      assert(Number(row.sourceWeek) <= Number(request.week), 'Every management request has source week no later than selected week');
    }
  }
  assert.deepEqual(errors,[]);assert.equal(await page.$$eval('[data-ui-shell]',els=>els.length),1);
  console.log(`PASS ${popup?'popup':'normal'} 1920x1080: independent management selection; ineligible/linked rows; source38 selected40; stale scope reset; linked note-only; editable draft; all writes intercepted`);
  await page.close();
 }} finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
