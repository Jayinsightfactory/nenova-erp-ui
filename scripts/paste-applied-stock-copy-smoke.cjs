const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),swc=require('next/dist/build/swc');
(async()=>{
 const {buildAppliedStockCopy,buildAppliedStockScope}=await import('../lib/pasteAppliedStockCopy.js');
 const raw=fs.readFileSync('pages/orders/paste.js','utf8');
 const component=raw.slice(raw.indexOf('function AppliedStockCopyPanel('),raw.indexOf('function StockDraftPanel('));
 await swc.loadBindings();const compiled=await swc.transform(component,{filename:'copy.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'classic'}}},module:{type:'commonjs'}});
 const products=[{ProdKey:71,ProdName:'Carnation Moon Light'},{ProdKey:12,ProdName:'Carnation Novia'},{ProdKey:95,ProdName:'Carnation Ikebana'}];
 const baseText='문라이트 1\n노비아 1\n이케바나 1',week='2026-41-01',pasteText='노비아 1 추가';
 const resolvedMatches=new Map([['문라이트',{prodKey:71}],['노비아',{prodKey:12}],['이케바나',{prodKey:95}]]);
 const currentScope=buildAppliedStockScope({week,baseText,pasteText});
 const result={verified:true,failCount:0,stockCopyScope:currentScope,details:[{ok:true,verified:true,type:'ADD',prodKey:12,qty:1,unit:'박스',orderYear:'2026',orderWeek:'41-01',outQtyBefore:0,outQtyAfter:1}]};
 const actual=buildAppliedStockCopy({baseText,pasteText,week,resolvedMatches,products,result,currentScope});assert.equal(actual.text,'이케바나 1\n문라이트 1');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/,'umd/react.development.js')});
  await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.development.js')});
  await page.evaluate(value=>{window.actual=value;window.copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});},actual);
  await page.addScriptTag({content:`const {useState,useEffect}=React;const buildAppliedStockCopy=()=>window.actual;${compiled.code};window.render=()=>ReactDOM.render(React.createElement(AppliedStockCopyPanel,{draft:{},result:{},currentScope:{}}),document.getElementById('app'));window.render();`});
  assert.equal(await page.getByLabel('적용재고 원문').inputValue(),'이케바나 1\n문라이트 1');
  await page.getByRole('button',{name:'적용재고 복사'}).press('Enter');
  assert.equal(await page.evaluate(()=>window.copied),actual.text);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1366,height:768});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const failed=buildAppliedStockCopy({baseText,pasteText,week,resolvedMatches,products,result:{...result,rolledBack:true},currentScope});
  await page.evaluate(value=>{window.actual=value;window.render();},failed);
  assert.equal(await page.getByRole('button',{name:'적용재고 복사'}).isEnabled(),false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:'1920x1080 / 1366x768',copiedOriginalNamesInDbOrder:true,zeroOmitted:true,keyboardCopy:true,rollbackBlocksCopy:true,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
