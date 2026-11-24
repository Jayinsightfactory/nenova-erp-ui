// Authenticated production code, synthetic estimate responses, and zero ERP writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const puppeteer=require('puppeteer-core');

async function main(){
  const expected=process.argv[2];assert(/^[a-f0-9]{40}$/.test(expected||''),'Expected merge commit SHA');
  const base='https://nenovaweb.com';
  // Reuse the established smoke account in memory; never print or persist credentials.
  const harness=fs.readFileSync('scripts/layout-shell-smoke.js','utf8'),defaults=new Map();
  for(const m of harness.matchAll(/process\.env\.(SMOKE_(?:USER|PASS))\s*\|\|\s*(['"])(.*?)\2/g))defaults.set(m[1],m[3]);
  const user=process.env.SMOKE_USER||defaults.get('SMOKE_USER'),pass=process.env.SMOKE_PASS||defaults.get('SMOKE_PASS');
  assert(user&&pass,'Smoke account unavailable');
  const folder=path.resolve('.verify/production-print-'+Date.now());fs.mkdirSync(folder,{recursive:true});
  const items=Array.from({length:12},(_,i)=>({_exePrint:true,ProdKey:i+1,ProdName:'연습 품목 '+(i+1),Unit:'단',Quantity:120,UnitQuantity:'120단',Cost:1100,Amount:120000,Vat:12000,BunchesPerBox:60,EstimateType:'정상출고',OrderYear:2026,OrderWeek:'47-01',GroupNo:1,GroupName:'연습',Descr:'연습 적요'}));
  const shipment={ShipmentKey:101,ShipmentKeys:'101',CustKey:1,CustName:'연습 업체',ParentWeek:'47',OrderWeek:'47-01',totalAmount:1584000,Manager:'연습'};
  const logo=await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100"><rect width="360" height="100" fill="white"/><text x="15" y="65" font-family="Arial" font-size="36">TEST SUPPLIER</text></svg>')).png().toBuffer();
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--no-proxy-server']});
  let loginPhase=true,blockedWrites=0,forwardedWrites=0;
  try{
    const page=await browser.newPage();await page.setViewport({width:1920,height:1080});page.setDefaultTimeout(60000);
    await page.evaluateOnNewDocument(()=>{
      const descriptor=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
      Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...descriptor,set(value){
        const safe=String(value).replace(/(<td class="info-key">(?:사업자등록번호|회사명[/]대표|주소|업태[/]종목|계좌번호|TEL[/]FAX)<\/td><td class="info-val">)[\s\S]*?(<\/td>)/g,'$1연습용 회사정보$2');
        descriptor.set.call(this,safe);
      }});
    });
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      try{
        const url=new URL(request.url()),method=request.method();
        if(!['GET','HEAD','OPTIONS'].includes(method)){
          if(loginPhase&&url.origin===base&&url.pathname==='/api/auth/login'&&method==='POST')return request.continue();
          blockedWrites++;return request.abort();
        }
        if(url.origin===base&&url.pathname==='/api/estimate'){
          let data={success:true,shipments:[shipment],items:[]};
          if(url.searchParams.get('itemsOnly')==='1')data={success:true,items};
          if(url.searchParams.get('view')==='types')data={success:true,types:[]};
          if(url.searchParams.get('view')==='mismatch')data={success:true,mismatches:[]};
          return request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
        }
        if(url.origin===base&&/^\/nenova-logo.*\.png$/.test(url.pathname))return request.respond({status:200,contentType:'image/png',body:logo});
        if(!['GET','HEAD','OPTIONS'].includes(method))forwardedWrites++;
        return request.continue();
      }catch{if(!request.isInterceptResolutionHandled())await request.abort();}
    });
    await page.goto(base+'/login',{waitUntil:'networkidle0'});
    const userInput=await page.$('input[type="text"],input:not([type])'),passwordInput=await page.$('input[type="password"]');
    assert(userInput&&passwordInput,'Login form available');await userInput.type(user);await passwordInput.type(pass);
    const submit=await page.$('button[type="submit"]');assert(submit,'Login submit available');await submit.click();
    await page.waitForSelector('.sidebar-logo');loginPhase=false;
    const version=await page.$eval('.sidebar-logo',el=>el.title);assert(version.includes(expected.slice(0,7)),'Deployed version badge');
    assert.equal((await fetch(base+'/api/ping')).status,200);
    await page.goto(base+'/estimate?year=2026&week=47',{waitUntil:'networkidle0'});
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('조회 / Buscar')).click());
    await page.waitForFunction(()=>document.querySelectorAll('.estimate-item-table tbody tr').length===12);
    const session=await page.createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:folder});
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('견적서 출력')).click());
    await page.waitForSelector('[aria-labelledby="estimate-print-title"]');
    await page.evaluate(()=>[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent.includes('엑셀 다운로드')).click());
    let file;for(let i=0;i<90;i++){file=fs.readdirSync(folder).find(n=>n.endsWith('.xlsx'));if(file)break;await new Promise(r=>setTimeout(r,500));}
    assert(file,'Production bundle generated actual XLSX');
    const ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(folder,file));
    assert.equal(wb.worksheets.length,1);const sheet=wb.worksheets[0],values=[];sheet.eachRow(row=>row.eachCell(cell=>{if(cell.type!==ExcelJS.ValueType.Merge)values.push(String(cell.value??''));}));
    assert(values.includes('120단(2)'));assert(values.includes('1584000'));assert(values.includes('연습용 회사정보'));
    assert.equal(sheet.pageSetup.paperSize,9);assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,0);assert.equal(sheet.getImages().length,1);
    const pdf=path.join(folder,'production-synthetic.pdf');execFileSync('powershell',['-NoProfile','-File','scripts/render-estimate-print-xlsx.ps1','-WorkbookPath',path.join(folder,file),'-PdfPath',pdf],{windowsHide:true});
    const pageCount=Number(execFileSync('pdfinfo',[pdf],{encoding:'utf8',windowsHide:true}).match(/Pages:\s+(\d+)/)[1]);assert.equal(pageCount,1);
    await page.evaluate(()=>{const source=document.querySelector('source[src*="/guides/estimate-management/"]');source.closest('details').open=true;});
    const guide=await page.$('video:has(source[src*="/guides/estimate-management/"])');assert(guide,'Guide player');
    await guide.evaluate(async video=>{video.muted=true;await video.play();});await page.waitForFunction(()=>document.querySelector('video source[src*="/guides/estimate-management/"]').parentElement.currentTime>.2);
    const chapters=await page.$$eval('video source[src*="/guides/estimate-management/"]',nodes=>nodes[0].closest('details').querySelectorAll('nav button').length);assert.equal(chapters,4);
    await guide.evaluate(video=>video.pause());
    await page.goto(base+'/estimate?year=2026&week=47&popup=1',{waitUntil:'networkidle0'});
    assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),0);assert.equal(await page.$$eval('[data-ui-popupbar]',n=>n.length),1);
    assert.equal(forwardedWrites,0);
    console.log(JSON.stringify({ping:200,versionMatch:true,xlsx:true,excelPdfPages:pageCount,logo:true,boxQuantity:true,total:true,guidePlayback:true,chapters,popupShell:true,blockedWrites,forwardedErpWrites:forwardedWrites}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error('Production print smoke failed:',error.name);process.exitCode=1;});
