const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run');
(async()=>{
 const out=path.resolve('.verify/receipt-compare');fs.mkdirSync(out,{recursive:true});
 const doc=await PDFDocument.create(),sheet=doc.addPage([612,792]);
 sheet.drawText('PRACTICE INVOICE / USD 120',{x:35,y:740,size:18});
 sheet.drawText('Rose Demo       2 boxes       10 bunches       200 stems',{x:35,y:660,size:15});
 sheet.drawText('Lily Demo       1 box           5 bunches         50 stems',{x:35,y:620,size:15});
 fs.writeFileSync(path.join(out,'source.pdf'),await doc.save());
 const root=process.cwd().replaceAll('\\','/');
 const input={orderYear:'2026',orderWeek:'46-01',rawMetadata:{metadataEvidence:{invoice_total:{page:1,quote:'PRACTICE INVOICE / USD 120'}}},lines:[
  {lineId:'2026-46-01-demo',lineNo:1,originalName:'Rose Demo',prodKey:1,boxQuantity:2,bunchQuantity:10,stemQuantity:200,sourceEvidence:{descriptionEvidence:{page:1,quote:'Rose Demo'},quantityEvidence:{stemQuantity:{page:1,quote:'200 stems'}}}},
  {lineId:'2026-46-01-demo2',lineNo:2,originalName:'Lily Demo',prodKey:2,boxQuantity:1,bunchQuantity:5,stemQuantity:50,sourceEvidence:{descriptionEvidence:{page:1,quote:'Lily Demo'}}} ]};
 fs.writeFileSync(path.join(out,'entry.js'),`import React from 'react';import{createRoot}from'react-dom/client';import View from '${root}/components/import-tools/InvoiceReceiptComparison.js';const file=new File([await(await fetch('/source.pdf')).blob()],'practice.pdf',{type:'application/pdf'});createRoot(document.getElementById('root')).render(React.createElement(View,{file,document:${JSON.stringify(input)},productByKey:new Map([[1,{ProdName:'ERP Rose Demo'}],[2,{ProdName:'ERP Lily Demo'}]]),onReady:v=>{window.sourceReady=v}}));`);
 const webpack=require('next/dist/compiled/webpack/webpack').webpack;
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(out,'entry.js'),output:{path:out,filename:'bundle.js',publicPath:'/'},resolve:{modules:[path.resolve('node_modules'),'node_modules']},module:{rules:[{test:/\.js$/,exclude:/node_modules/,use:path.resolve('scripts/lib/receipt-comparison-guide-loader.cjs')},{test:/\.css$/,use:path.resolve('scripts/lib/receipt-comparison-guide-loader.cjs')}]},experiments:{topLevelAwait:true}},(e,s)=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));
 const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]).slice(1);const file=path.join(out,name);if(name&&path.dirname(file)===out&&fs.existsSync(file)){res.setHeader('Content-Type',name.endsWith('.pdf')?'application/pdf':'text/javascript');res.end(fs.readFileSync(file));}else if(!name){res.setHeader('Content-Type','text/html');res.end('<html lang="ko"><meta charset="utf-8"><title>입고 원본 대조 연습</title><body style="font:16px Arial;padding:80px 24px 360px"><h1>입고 전 원본·수량 대조 · 연습용 자료</h1><div id="root"></div><script src="/bundle.js"></script></body></html>');}else{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.sourceReady===true,{timeout:60000});
 const files=['components/import-tools/InvoiceReceiptComparison.js','components/import-tools/InvoiceTotalEvidence.js','styles/InvoiceReceipt.module.css'];
 const rec=dry?null:await createWorkflowGuideRecorder(page,{workflowId:'receipt-source-comparison',guideId:'import',title:'입고 전 원본·수량 대조',sourceFiles:files,fixtureOnly:true});
 const step=async(id,text,selector,n)=>{if(!rec)return;rec.chapter(id,`${n}. ${text}`);await rec.caption(`${n}. ${text}`);await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));await rec.pause(1600);await rec.focus(selector,n);await rec.pause(2500);await rec.unfocus();};
 await step('total','왼쪽 원본과 오른쪽 입고 예정 품목·박스·단·송이를 비교합니다.','[aria-label="품목별 입고 예정값"] h3',1);
 const selector='button[aria-label="1행 송이 200 원본 대조"]';await step('quantity','확인할 수량을 누르면 원본 위치로 이동하고 확대합니다.',selector,2);await page.click(selector);await page.waitForFunction(()=>document.body.innerText.includes('수량 근거 강조')&&document.body.innerText.includes('150%'));assert.equal(await page.$eval(selector,e=>e.getAttribute('aria-pressed')),'true');
 await step('source','주황색 원본 수량과 선택한 입고 수량을 대조합니다. 위치 근거가 없으면 직접 확인 안내가 표시됩니다.','[data-receipt-source-highlight]',3);
 await page.screenshot({path:path.join(out,'comparison.png')});assert.deepEqual(errors,[]);
 if(dry){await page.focus('button[aria-label="2행 단 5 원본 대조"]');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.body.innerText.includes('품목행 기준 강조'));await page.setViewport({width:1280,height:1080,deviceScaleFactor:1});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=1280),'comparison overflows desktop width');await page.focus('button[aria-label="2행 단 5 원본 대조"]');await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement.tagName==='BUTTON'));}
 if(rec){const result=await rec.stop();const p='config/workflow-guides.json',registry=JSON.parse(fs.readFileSync(p));Object.assign(registry.workflows.find(w=>w.id==='receipt-source-comparison').guides[0],{status:'ready',chapters:result.chapters});fs.writeFileSync(p,JSON.stringify(registry,null,2)+'\n');}
 console.log(JSON.stringify({passed:true,dry,productionWrites:0}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
