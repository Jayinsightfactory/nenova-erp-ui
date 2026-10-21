// Manual CI-only authenticated production READ smoke. Never prints data or credentials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core'),XLSX=require('xlsx-js-style'),crypto=require('node:crypto');
(async()=>{
 const token=process.env.NENOVAWEB_SERVICE_TOKEN;
 if(!token)throw Error('Configured service credential is unavailable');
 const year=String(process.env.PROBE_YEAR||'2026'),weeks=String(process.env.PROBE_WEEK||'18').split(',').map(w=>w.trim().padStart(2,'0'));
 if(!/^20\d\d$/.test(year)||weeks.length>6||new Set(weeks).size!==weeks.length||weeks.some(week=>!/^\d{2}$/.test(week)||+week<1||+week>53))throw Error('Invalid probe scope');
 const origin='https://nenovaweb.com';
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-profit-read-smoke-'));
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:process.env.CI?['--no-sandbox']:[]});
 try {
  const context=await browser.createBrowserContext({downloadBehavior:{policy:'allow',downloadPath:directory}});
  for(const week of weeks) {
  const page=await context.newPage();await page.setViewport({width:1440,height:1000});
  await page.evaluateOnNewDocument(()=>localStorage.setItem('nenova_profitReport_outputCols_v1',JSON.stringify(['category','C','E','F','G','H','I','J','K'])));
  const responses=[],requests=[];let blockedWrites=0;
  await page.setRequestInterception(true);
  page.on('request',req=>{
   const u=new URL(req.url());
   if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return req.abort('blockedbyclient');}
   if(u.origin===origin&&u.pathname.startsWith('/api/')){
    if(u.pathname==='/api/sales/profit-report-output'){
     assert.equal(u.searchParams.get('year'),year);assert.equal(u.searchParams.get('week'),week);
     requests.push(Date.now());
    }
    return req.continue({headers:{...req.headers(),authorization:'Bearer '+token}});
   }
   return req.continue();
  });
  page.on('response',res=>{if(new URL(res.url()).pathname==='/api/sales/profit-report-output')responses.push(res.status());});
  await page.goto(`${origin}/sales/profit-report?year=${year}&week=${week}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.startsWith('엑셀 다운로드')&&!e.disabled),{timeout:120000});
  const button=await page.evaluateHandle(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.startsWith('엑셀 다운로드')));
  const label=await button.evaluate(e=>e.textContent);
  assert.match(label,/1개 차수 · 1개 시트/,'default must select only requested week');
  const started=Date.now();await button.asElement().click();
  const file=path.join(directory,`매출이익_${year}_${week}차.xlsx`);
  while(!fs.existsSync(file)){
   if(Date.now()-started>180000)throw Error(`Download did not complete; HTTP statuses=${responses.join(',')||'none'}`);
   const failure=await page.evaluate(()=>[...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('부분 파일은 생성하지 않았습니다')));
   if(failure)throw Error(`Download failed; HTTP statuses=${responses.join(',')||'none'}`);
   await new Promise(resolve=>setTimeout(resolve,300));
  }
  const wb=XLSX.readFile(file);
  assert.deepEqual(wb.SheetNames,[week+'차']);assert.ok(fs.statSync(file).size>1000);
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[week+'차'],{header:1});assert.ok(rows.length>10);
  assert.ok(requests.length>=1&&requests.length<=3);assert.equal(responses.at(-1),200);
  const financialRows=rows.filter(r=>typeof r[0]==='string'&&r.slice(1,9).some(v=>typeof v==='number')).map(r=>r.slice(0,9).map(v=>v==null||v===''?null:v));
  const financialDigest=crypto.createHash('sha256').update(JSON.stringify(financialRows)).digest('hex');
  console.log(JSON.stringify({status:'PASS',scope:{year,week},requests:requests.length,httpStatuses:responses,sheets:wb.SheetNames.length,rowCount:rows.length,bytes:fs.statSync(file).size,elapsedMs:Date.now()-started,blockedWrites,actualBusinessWrites:0,financialDigest}));
  await page.close();
  }
 }finally{
  await browser.close();
  const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.join(os.tmpdir(),'nenova-profit-read-smoke-')));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
