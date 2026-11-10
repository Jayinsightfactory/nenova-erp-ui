// Local UI fixture only. Every API request is intercepted; never writes ERP data.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const puppeteer=require('puppeteer-core');
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage(),errors=[];await page.setViewport({width:1920,height:1080});
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const user={userId:'fixture',userName:'검증',authority:'A',Authority:'A'};
    await page.evaluateOnNewDocument(u=>localStorage.setItem('nenovaUser',JSON.stringify(u)),user);
    let previews=0,exports=0;
    await page.setRequestInterception(true);
    page.on('request',async req=>{
      const url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return req.continue();
      let data={success:true,rows:[],favorites:[],data:[],user};
      if(url.pathname.endsWith('/distribute-import-preview')) {
        previews++;
        const row={key:'1|2',custKey:1,prodKey:2,custName:'라움',prodName:'Quicksand',displayName:'퀵샌드',outUnit:'단',orderQty:30,uploadQty:40,excelQty:40,currentOutQty:30,orderDiffQty:10,changeQty:10,shipmentDiffQty:10,needsShipmentApply:true,status:'변경',cells:['장미!R5C2'],farmChanged:true,farmBeforeText:'Elite 30',farmText:'Elite 30 / Valores 10',farmAssignments:[{farmKey:3,shipmentQuantity:30},{farmKey:4,shipmentQuantity:10}]};
        const invalid=previews>1;
        data={success:true,orderYear:'2026',week:'45-01',rows:[row],unmatched:[],logs:[],summaryByCustomer:[],customerOptions:[],productOptions:[],replacementPlan:invalid?null:'signed-fixture',exportPlan:invalid?null:'export-fixture',replacementCategories:['콜롬비아장미'],replacementProductKeys:[2],earlyImport:{mode:'ORIGINAL_INCLUDES_EARLY',fingerprint:'fixture',scope:{year:'2026',majorWeek:'45',orderWeek:'45-01',custKeys:[1],prodKeys:[2]}},farmImport:{changedCount:1,errors:invalid?[{message:'농장 합계 불일치'}]:[],layoutErrors:[],reviews:[]}};
      }
      if(url.pathname.endsWith('/distribute-import-export')){exports++;return req.respond({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('fixture')});}
      if(url.pathname.endsWith('/distribute-import-apply'))throw new Error('This read-only smoke must not submit ERP apply');
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto((process.env.FARM_SMOKE_URL || 'http://127.0.0.1:3128')+'/shipment/distribute-import',{waitUntil:'networkidle2',timeout:120000});
    await page.waitForSelector('textarea[aria-label="농장분배 카톡 내용"]');
    const fixtureFile=path.join(os.tmpdir(),'farm-text-ui-fixture.xlsx');fs.writeFileSync(fixtureFile,Buffer.from('UI fixture'));
    await (await page.$('input[type=file]')).uploadFile(fixtureFile);
    await page.type('textarea[aria-label="농장분배 카톡 내용"]','42-2 장미 농장분배\n-라움\n퀵샌드 40단(엘리떼 30, 발로레스 10)');
    const click=async label=>{const buttons=await page.$$('button');for(const button of buttons){if((await button.evaluate(e=>e.textContent)).trim()===label){await button.click();return;}}throw new Error('Missing button: '+label);};
    await click('수정 내역 + 농장분배 검증');await page.waitForSelector('[aria-label="검증표 확대 축소"]');
    assert.equal(previews,1);assert.equal(await page.$eval('[aria-label="검증표 확대 축소"]',e=>Number(e.value))<=100,true);
    await click('100%');assert.equal(await page.$eval('[aria-label="검증표 확대 축소"]',e=>e.value),'100');
    await page.click('[aria-label="검증표 축소"]');assert.equal(await page.$eval('[aria-label="검증표 확대 축소"]',e=>e.value),'90');
    await click('전체 맞춤');assert.ok(await page.$eval('.farm-comparison-canvas',e=>Number(e.style.zoom))<=1);
    assert.ok((await page.$eval('.farm-comparison-canvas',e=>e.textContent)).includes('Valores 10'));
    await click('검증된 엑셀 다운로드');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('다운로드 준비')));assert.equal(exports,1);
    await page.$eval('textarea[aria-label="농장분배 카톡 내용"]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(e,'INVALID');e.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.ok(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='검증된 엑셀 다운로드').disabled));
    await click('수정 내역 + 농장분배 검증');await page.waitForFunction(()=>document.body.textContent.includes('농장 합계 불일치'));
    assert.ok(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='검증된 엑셀 다운로드').disabled));
    await page.$eval('.farm-comparison-canvas',e=>e.scrollIntoView({block:'center'}));
    await page.screenshot({path:path.join(os.tmpdir(),'farm-text-ui-desktop.png'),fullPage:true});
    await page.setViewport({width:390,height:844});await page.$eval('.farm-comparison-canvas',e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(os.tmpdir(),'farm-text-ui-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('UI PASS: chat input, integrated highlight, fit/zoom/reset, download, stale invalidation, invalid totals, 1920/390');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
