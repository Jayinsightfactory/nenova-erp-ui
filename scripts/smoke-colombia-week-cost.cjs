// Real 46-02 UI and workbook exporter on a loopback-only synthetic fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process'),puppeteer=require('puppeteer-core');
const endpoint='/api/import/receipts/colombia-week-cost';
async function main(){
 const child=spawn(process.execPath,['scripts/shared-awb-ui-fixture.cjs','--week'],{windowsHide:true,stdio:['ignore','pipe','inherit']});let browser;
 try{
  const base=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('exit',code=>reject(Error('Fixture exited '+code)));setTimeout(()=>reject(Error('Fixture startup timeout')),20000).unref();});
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});await page.goto(base,{waitUntil:'networkidle0'});
  const downloadPath=path.resolve('.verify','co-week-download-'+randomUUID());
  fs.mkdirSync(downloadPath,{recursive:true});
  const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath});
  const readDownload=async(count)=>{for(let i=0;i<100;i++){const files=fs.readdirSync(downloadPath).filter(f=>f.endsWith('.xlsx'));if(files.length===count)return files.map(f=>fs.readFileSync(path.join(downloadPath,f)));await new Promise(r=>setTimeout(r,100));}throw Error('Browser did not save '+count+' XLSX file(s)');};
  const button=async(text)=>{const handle=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(el=>el.innerText.includes(t)),text);await handle.asElement().click();await handle.dispose();};
  const response=action=>page.waitForResponse(r=>r.url().endsWith(endpoint)&&JSON.parse(r.request().postData()||'{}').action===action);
  await button('차수 전체 입고 조회');await page.waitForFunction(()=>document.body.innerText.includes('입고 3건 · 상품 3행 · AWB 2개'));
  const inputs=await page.$$('input[type=number]');assert.equal(inputs.length,8);
  for(const [i,value] of ['100','120','100','1400','100','120','200','1400'].entries())await inputs[i].type(value);
  await page.type('fieldset fieldset label > input:not([type])','TEST_ONLY-46-02');
  await page.select('select[aria-label="통관비 기준"]','TOTAL');await page.locator('input[type=number]').wait();
  await (await page.$$('input[type=number]')).at(-1).type('1000');
  for(const box of await page.$$('input[type=checkbox]'))await box.click();
  await button('확인한 통관 근거 추가');
  const preview=response('preview');await button('통합 계산 검증');const p=await (await preview).json();assert.equal(p.calculation?.status,'CALCULATED',JSON.stringify(p));assert.equal(p.calculation.totals.freightNative,300);
  const file=response('download');await button('단일 시트 엑셀 다운로드');const downloaded=await file;assert.equal(downloaded.status(),200);const [bytes]=await readDownload(1);
  const workbook=require('xlsx').read(Buffer.from(bytes),{type:'buffer'});assert.deepEqual(workbook.SheetNames,['2026 46-02']);
  await page.waitForFunction(()=>document.body.innerText.includes('보관 당시 원본 다시 다운로드'));
  const saved=fs.readdirSync(downloadPath).find(f=>f.endsWith('.xlsx'));
  fs.renameSync(path.join(downloadPath,saved),path.join(downloadPath,saved+'.first'));
  const original=response('openVersion');await button('보관 당시 원본 다시 다운로드');assert.equal((await original).status(),200);const [reopened]=await readDownload(1);assert.deepEqual(reopened,bytes);
  const status=await(await fetch(base+'/fixture-status')).json();assert.deepEqual(status,{prepare:1,preview:1,download:1,productionWrites:0,providerCalls:0});
  console.log(JSON.stringify({status,sha256:downloaded.headers()['x-workbook-sha256'],sheets:workbook.SheetNames}));
 }finally{await browser?.close();child.kill();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
