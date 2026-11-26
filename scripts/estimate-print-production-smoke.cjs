// Authenticated deployed code; synthetic estimate data; no forwarded ERP writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const puppeteer=require('puppeteer-core');
async function main(){
 const expected=process.argv[2];assert(/^[a-f0-9]{40}$/.test(expected||''),'Expected deployed commit SHA');
 const variant=process.env.ESTIMATE_PRINT_FIXTURE||'normal';assert(['normal','china','long'].includes(variant),'Known synthetic fixture');
 const base='https://nenovaweb.com',harness=fs.readFileSync('scripts/layout-shell-smoke.js','utf8'),defaults=new Map();
 for(const m of harness.matchAll(/process\.env\.(SMOKE_(?:USER|PASS))\s*\|\|\s*(['"])(.*?)\2/g))defaults.set(m[1],m[3]);
 const user=process.env.SMOKE_USER||defaults.get('SMOKE_USER'),pass=process.env.SMOKE_PASS||defaults.get('SMOKE_PASS');assert(user&&pass,'Smoke account unavailable');
 const folder=path.resolve('.verify/production-print-'+variant+'-'+Date.now());fs.mkdirSync(folder,{recursive:true});
 const count=variant==='china'?2:variant==='long'?55:12;
 const items=Array.from({length:count},(_,i)=>{
  const row={_exePrint:true,SdateKey:i+1,SdetailKey:100+i,ShipmentKey:101,WeekDay:2,outDate:'2026-11-25',ProdKey:i+1,ProdName:'연습 품목 T'+String(i+1).padStart(3,'0'),Unit:'단',Quantity:120,UnitQuantity:'120단',Cost:1100,Amount:120000,Vat:12000,BunchesPerBox:60,EstimateType:'정상출고',OrderYear:2026,OrderWeek:'47-01',GroupNo:1,GroupName:'연습',Descr:'연습 적요'};
  if(variant==='china')Object.assign(row,{ProdName:row.ProdName+(i===0?' 중국 TOTAL':' 항공수수료'),Unit:'박스',Quantity:1,UnitQuantity:'1박스',Cost:i===0?5511000:-220000,Amount:i===0?5010000:-200000,Vat:i===0?501000:-20000,BunchesPerBox:0});
  if(variant==='long'&&i%7===0)Object.assign(row,{ProdName:row.ProdName+' 긴 품목명과 규격을 끝까지 확인합니다',Descr:'긴 적요 줄바꿈을 확인합니다.\n품목과 수량을 빠뜨리지 않습니다.',_printNoteOverride:true});
  return row;
 });
 const total=items.reduce((n,r)=>n+r.Amount+r.Vat,0);
 const shipments=Array.from({length:variant==='long'?2:1},(_,i)=>({ShipmentKey:101+i,ShipmentKeys:String(101+i),CustKey:i+1,CustName:'연습 업체 '+(i+1),ParentWeek:'47',OrderWeek:'47-01',totalAmount:total,Manager:'연습'}));
 const logo=await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100"><rect width="360" height="100" fill="white"/><text x="15" y="65" font-family="Arial" font-size="36">TEST SUPPLIER</text></svg>')).png().toBuffer();
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--no-proxy-server']});
 let loginPhase=true,blockedWrites=0,forwardedWrites=0;
 try{
  const page=await browser.newPage();await page.setViewport({width:1920,height:1080});page.setDefaultTimeout(60000);
  await page.evaluateOnNewDocument(()=>{
   const descriptor=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'srcdoc');
   Object.defineProperty(HTMLIFrameElement.prototype,'srcdoc',{...descriptor,set(value){
    const safe=String(value).replace(/(<td class="info-key">(?:사업자등록번호|회사명[/]대표|주소|업태[/]종목|계좌번호|TEL[/]FAX)<\/td><td class="info-val">)[\s\S]*?(<\/td>)/g,'$1연습용 회사정보$2');
    if(this.getAttribute('data-estimate-print')==='1')window.__productionPrintHtml=safe;
    descriptor.set.call(this,safe);
   }});
  });
  await page.setRequestInterception(true);
  page.on('request',async request=>{try{
   const url=new URL(request.url()),method=request.method();
   if(!['GET','HEAD','OPTIONS'].includes(method)){
    if(loginPhase&&url.origin===base&&url.pathname==='/api/auth/login'&&method==='POST')return request.continue();
    blockedWrites++;return request.abort();
   }
   if(url.origin===base&&url.pathname==='/api/estimate'){
    let data={success:true,shipments,items:[]};
    if(url.searchParams.get('itemsOnly')==='1')data={success:true,items};
    if(url.searchParams.get('view')==='types')data={success:true,types:[]};
    if(url.searchParams.get('view')==='mismatch')data={success:true,mismatches:[]};
    return request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.origin===base&&/^\/nenova-logo.*\.png$/.test(url.pathname))return request.respond({status:200,contentType:'image/png',body:logo});
   if(!['GET','HEAD','OPTIONS'].includes(method))forwardedWrites++;
   return request.continue();
  }catch{if(!request.isInterceptResolutionHandled())await request.abort();}});
  await page.goto(base+'/login',{waitUntil:'networkidle0'});
  const username=await page.$('input[type="text"],input:not([type])'),password=await page.$('input[type="password"]');assert(username&&password,'Login form');await username.type(user);await password.type(pass);await(await page.$('button[type="submit"]')).click();
  await page.waitForSelector('.sidebar-logo');loginPhase=false;
  assert((await page.$eval('.sidebar-logo',el=>el.title)).includes(expected.slice(0,7)),'Deployed version');assert.equal((await fetch(base+'/api/ping')).status,200);
  await page.goto(base+'/estimate?year=2026&week=47',{waitUntil:'networkidle0'});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('조회 / Buscar')).click());
  await page.waitForFunction(count=>document.querySelectorAll('.estimate-item-table tbody tr').length===count,{},count);
  if(shipments.length>1){await page.evaluate(()=>{const table=[...document.querySelectorAll('table')].find(t=>t.innerText.includes('총 합계금액')&&t.innerText.includes('연습 업체'));if(!table)throw Error('Synthetic customer table');const boxes=[...table.querySelectorAll('tbody input[type="checkbox"]')];if(boxes.length!==2)throw Error('Two customer checkboxes');boxes.forEach(box=>{if(!box.checked)box.click();});});}
  const session=await page.createCDPSession();await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:folder});
  const openPrint=async()=>{await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('견적서 출력')).click());await page.waitForSelector('[aria-labelledby="estimate-print-title"]');};
  await openPrint();await page.evaluate(()=>[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent.includes('엑셀 다운로드')).click());
  let file;for(let i=0;i<90;i++){file=fs.readdirSync(folder).find(n=>n.endsWith('.xlsx'));if(file)break;await new Promise(r=>setTimeout(r,500));}assert(file,'Actual production XLSX download');
  const ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(folder,file));
  assert.equal(wb.worksheets.length,variant==='long'?4:1,'One sheet per print page');
  const values=[];for(const sheet of wb.worksheets){sheet.eachRow(row=>row.eachCell(cell=>{if(cell.type!==ExcelJS.ValueType.Merge)values.push(String(cell.value??''));}));assert.equal(sheet.pageSetup.paperSize,9);assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.pageSetup.fitToHeight,1);}
  assert(values.includes(String(total))&&values.includes('연습용 회사정보'),'Total and supplier fields');if(variant!=='china')assert(values.includes('120단(2)'),'Box quantity');assert.equal(wb.worksheets.reduce((n,s)=>n+s.getImages().length,0),shipments.length,'Supplier logo only on first page');
  const excelPdf=path.join(folder,'excel.pdf');execFileSync('powershell',['-NoProfile','-File','scripts/render-estimate-print-xlsx.ps1','-WorkbookPath',path.join(folder,file),'-PdfPath',excelPdf],{windowsHide:true});
  await openPrint();await page.evaluate(()=>{window.__productionPrintHtml='';[...document.querySelectorAll('.modal-footer button')].find(b=>b.textContent.includes('출력 실행')).click();});await page.waitForFunction(()=>window.__productionPrintHtml);
  const html=await page.evaluate(()=>window.__productionPrintHtml),htmlPdf=path.join(folder,'html.pdf');
  const printPage=await browser.newPage();await printPage.setContent(html);await printPage.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});await printPage.pdf({path:htmlPdf,format:'A4',preferCSSPageSize:true,printBackground:true});await printPage.close();
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const read=async file=>{const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),useSystemFonts:true}).promise;const ids=[],amounts=[];for(let n=1;n<=pdf.numPages;n++){const items=(await(await pdf.getPage(n)).getTextContent()).items;ids.push(items.flatMap(item=>[...item.str.matchAll(/연습\s*품목\s*T(\d{3})/g)].map(m=>({id:+m[1],y:item.transform[5]}))).sort((a,b)=>b.y-a.y).map(x=>x.id));const text=items.map(i=>i.str).join(' ');amounts.push(...[...text.matchAll(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g)].map(m=>m[0]));}await pdf.destroy();return{ids,amounts};};
  const a=await read(htmlPdf),b=await read(excelPdf);assert.deepEqual(b.ids,a.ids,'Actual print and XLSX page item IDs');assert.equal(a.ids.flat().length,count*shipments.length);for(const amount of new Set(a.amounts))assert.equal(b.amounts.filter(x=>x===amount).length,a.amounts.filter(x=>x===amount).length,'Actual print/XLSX amount multiplicity');
  await page.waitForFunction(()=>!document.querySelector('[aria-labelledby="estimate-print-title"]'));await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='판매등록 이후 변경').click());await page.waitForSelector('dialog[open]');assert(await page.$eval('dialog[open]',el=>el.textContent.includes('기준 미기록')&&el.textContent.includes('변경 여부: 미확인')),'Unrecorded EXE baseline is unknown');await page.keyboard.press('Escape');
  // The owner explicitly excluded guides from this 2026-11-25 release.
  await page.goto(base+'/estimate?year=2026&week=47&popup=1',{waitUntil:'networkidle0'});assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),0);assert.equal(await page.$$eval('[data-ui-popupbar]',n=>n.length),1);assert.equal(forwardedWrites,0);
  console.log(JSON.stringify({fixture:variant,ping:200,versionMatch:true,xlsx:true,htmlPages:a.ids.length,excelPages:b.ids.length,pageRows:b.ids.map(x=>x.length),itemIds:true,amountMultiplicity:true,logo:true,postExportBaseline:'unrecorded/unknown',guidePlayback:false,guideExcludedByOwner:true,popupShell:true,blockedWrites,forwardedErpWrites:forwardedWrites}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error('Production print smoke failed:',error.name,error instanceof assert.AssertionError?error.message:'runtime error');process.exitCode=1;});
