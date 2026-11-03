// Real component + XLSX parser, loopback-only mock API. No ERP connection.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const babel=require('next/dist/compiled/babel/core'),puppeteer=require(process.env.PUPPETEER_CORE_PATH||'puppeteer-core'),XLSX=require('xlsx');
const root=path.resolve(__dirname,'..');
function compile(file){return babel.transformSync(fs.readFileSync(path.join(root,file),'utf8'),{filename:file,presets:[[require('next/dist/compiled/babel/preset-react'),{runtime:'classic'}]],plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],configFile:false,babelrc:false}).code;}
const selected={WarehouseKey:90,OrderYear:'2026',OrderWeek:'44-01',FarmName:'Farm A',InvoiceNo:'I-1'};
const detail={ProdKey:1,ProdName:'Flower A',OrderCode:'C',BoxQuantity:1,BunchQuantity:10,SteamQuantity:100,OutQuantity:10,EstQuantity:100,UPrice:1,TPrice:100};
let commits=0,failCommit=false,blocked=false;
const bundle=`const parser={exports:{}};((module,exports,require)=>{${compile('lib/warehousePackingImport.js')}})(parser,parser.exports,()=>{});
const component={exports:{}};((module,exports,require)=>{${compile('components/WarehouseCorrection.js')}})(component,component.exports,id=>id==='react'?React:id==='xlsx'?XLSX:parser.exports);
function App(){const [open,setOpen]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement('button',{id:'open',onClick:()=>setOpen(true)},'수정 열기'),open&&React.createElement(component.exports.default,{selected:${JSON.stringify(selected)},onClose:()=>setOpen(false),onSaved:()=>{window.saved=(window.saved||0)+1;}}));}ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(App));`;
const server=http.createServer(async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url.startsWith('/api/warehouse/correction')){
    if(req.method==='GET')return json({success:true,draftOwner:'fixture',header:{...selected,OrderNo:'A-1',InputDate:'2026-11-01'},details:[detail],farms:[{FarmName:'Farm A'},{FarmName:'Farm B'}],history:[]});
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);console.log(`UI API ${input.action}`);
    if(input.action==='preview')return json({success:true,canCommit:!blocked,issues:blocked?[{message:'운송원가 연결 1건이 있습니다.'}]:[],baselineDigest:'a'.repeat(64),farmBefore:'Farm A',farmAfter:input.farmName,detailsChanged:input.mode==='REPLACE',changes:[{prodKey:1,prodName:'Flower A',unit:'단',before:10,after:input.mode==='REPLACE'?0:10,delta:input.mode==='REPLACE'?-10:0}],before:[detail],after:input.mode==='REPLACE'?[{...detail,ProdKey:2,ProdName:'Flower B'}]:[detail]});
    assert.equal(input.action,'commit');commits++;if(failCommit){failCommit=false;return json({success:false,error:'응답을 확인하지 못했습니다.'},503);}return json({success:true,warehouseKey:90,operationId:input.operationId});
  }
  const assets={'/react.js':'node_modules/react/umd/react.development.js','/react-dom.js':'node_modules/react-dom/umd/react-dom.development.js','/xlsx.js':'node_modules/xlsx/dist/xlsx.full.min.js'};
  if(assets[req.url]){res.setHeader('Content-Type','application/javascript');return fs.createReadStream(path.join(root,assets[req.url])).pipe(res);}
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript; charset=utf-8');return res.end(bundle);}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="app"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/xlsx.js"></script><script src="/bundle.js"></script>');
});
async function main(){
  const artifacts=path.join(root,'.verify');fs.mkdirSync(artifacts,{recursive:true});
  const grid=[["PACKING LIST"],['','','Farm A','','','','44-01','','','','I-1'],['','','A-1','','','','2026/11/01'],[],['COD','VARIETY NAME','','','SIZE','BOX','STEAM/BUNCH','STEAM/BOX','TOTAL\nBUNCH','TOTALSTEAM','U.PRICE','T.PRICE'],['C','Flower B','','','',1,10,100,10,100,1,100]];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(grid),'Packing');const file=path.join(artifacts,'correction-fixture.xlsx');XLSX.writeFile(wb,file);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  try{
    const page=await browser.newPage();await page.setViewport({width:1920,height:1080});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('UI error '+e.message);});page.on('dialog',d=>d.accept());
    await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());
    const click=async text=>{const handle=await page.evaluateHandle(t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t),text);await handle.asElement().click();await handle.dispose();};
    console.log('UI open/farm');await page.goto(origin);await page.click('#open');await page.waitForSelector('select[aria-label="수정 농장"]');
    await page.select('select[aria-label="수정 농장"]','Farm B');await page.type('input[aria-label="수정 사유"]','농장 오선택 수정');
    await click('변경 내역 미리보기');await page.waitForSelector('section[aria-label="수정 미리보기"]');console.log('UI preview buttons',await page.$$eval('button',bs=>bs.map(b=>b.textContent)));await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='확인한 내용 저장'));
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='확인한 내용 저장').disabled),true);
    await page.click('input[type="checkbox"]');await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
    console.log('UI confirm/retry');failCommit=true;await click('확인한 내용 저장');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='같은 저장 작업 다시 확인'&&!b.disabled));await click('같은 저장 작업 다시 확인');await page.waitForFunction(()=>window.saved===1&&[...document.querySelectorAll('button')].some(b=>b.textContent==='목록으로 돌아가기'&&!b.disabled));
    await click('목록으로 돌아가기');assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
    console.log('UI file');await page.click('#open');await page.waitForSelector('select[aria-label="수정 방식"]');await page.select('select[aria-label="수정 방식"]','REPLACE');
    await (await page.$('input[type="file"]')).uploadFile(file);await page.waitForFunction(()=>document.body.textContent.includes('correction-fixture.xlsx · 1행')||document.querySelector('[role="alert"]'));console.log('UI file status',await page.$$eval('[role="alert"]',items=>items.map(x=>x.textContent)));assert(await page.evaluate(()=>document.body.textContent.includes('correction-fixture.xlsx · 1행')));
    await page.type('input[aria-label="수정 사유"]','품목 변경');blocked=true;await click('변경 내역 미리보기');await page.waitForFunction(()=>document.body.textContent.includes('운송원가 연결 1건')&&[...document.querySelectorAll('button')].some(b=>b.textContent==='확인한 내용 저장'));
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='확인한 내용 저장').disabled),true);
    console.log('UI preview/layout');blocked=false;await click('변경 내역 미리보기');await page.waitForSelector('input[type="checkbox"]');await page.click('summary');
    await page.screenshot({path:path.join(artifacts,'correction-desktop.png')});
    await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(artifacts,'correction-mobile.png')});
    assert(await page.$eval('dialog',d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
    console.log('UI close/restore');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
    await page.click('#open');await page.waitForFunction(()=>document.body.textContent.includes('수정안 불러오기'));await click('수정안 불러오기');assert.equal(await page.$('section[aria-label="수정 미리보기"]'),null);
    assert.deepEqual(errors,[]);assert.equal(commits,2);console.log('UI PASS: real XLSX parsing, preview, confirm, lost-response retry, blockers, draft restore without approval, Escape/focus return, 1920/390px; all APIs mocked.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;server.close();});
