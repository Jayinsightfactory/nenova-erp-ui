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
 const source={baseText,pasteText,week,resolvedMatches,products,currentScope};
 const result={verified:true,failCount:0,stockCopyScope:currentScope,details:[{ok:true,verified:true,type:'ADD',prodKey:12,qty:1,unit:'박스',orderYear:'2026',orderWeek:'41-01',outQtyBefore:0,outQtyAfter:1}]};
 const actual=buildAppliedStockCopy({...source,result});assert.equal(actual.text,'이케바나 1\n문라이트 1');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>*{box-sizing:border-box;padding:0;margin:0}</style><div id="app"></div>');
  await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/,'umd/react.development.js')});
  await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.development.js')});
  await page.evaluate(value=>{window.actual=value;window.copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});},actual);
  await page.addScriptTag({content:`const {useState,useEffect,useRef}=React;const buildAppliedStockCopy=()=>window.actual;${compiled.code};window.render=(props={})=>ReactDOM.render(React.createElement(AppliedStockCopyPanel,{draft:{},result:Object.hasOwn(props,'result')?props.result:{},currentScope:props.currentScope??{},bulkRunning:props.bulkRunning??false}),document.getElementById('app'));window.render();`});
  const trigger=page.getByRole('button',{name:'적용재고 확인'}),dialog=page.getByRole('dialog',{name:'기초재고 기준 적용재고'});
  assert.equal(await dialog.isVisible(),false,'detail starts hidden');
  await trigger.focus();await trigger.press('Enter');assert.equal(await dialog.isVisible(),true);
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')?.open),true,'focus moves into modal');
  for(let index=0;index<6;index++){
   await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')?.open),true,'Tab stays within modal');
  }
  for(let index=0;index<6;index++){
   await page.keyboard.press('Shift+Tab');
   assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')?.open),true,'Shift+Tab stays within modal');
  }
  assert.equal(await page.getByLabel('적용재고 원문').inputValue(),actual.text);
  const changeTable=dialog.getByRole('table',{name:'기초재고 기준 적용 변경내역'});
  assert.equal(await changeTable.getByRole('row').count(),4,'unchanged and zero remainder stock stays in the table');
  assert.equal(await changeTable.getByRole('columnheader',{name:'기초재고'}).count(),1);
  const zeroRow=page.getByTestId('applied-stock-change:12');
  assert.deepEqual(await zeroRow.getByRole('cell').allTextContents(),['1박스','1박스','0박스','0박스']);
  assert.equal(await zeroRow.getByRole('rowheader').textContent(),'노비아');
  const output='outputs/applied-stock-review';fs.mkdirSync('outputs',{recursive:true});
  for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
   await page.setViewportSize({width,height});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`page does not overflow at ${width}`);
   assert.equal(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true,`dialog fits ${width}x${height}`);
   assert.equal(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs(r.left-(innerWidth-r.width)/2)<=1&&Math.abs(r.top-(innerHeight-r.height)/2)<=1;}),true,`dialog stays centered despite global margin reset at ${width}`);
   assert.equal(await dialog.getByRole('button',{name:'닫기'}).isVisible(),true);
   await page.screenshot({path:`${output}-${width}x${height}.png`});
  }
  await page.setViewportSize({width:1920,height:1080});
  const many={...actual,changeRows:Array.from({length:100},(_,index)=>({...actual.changeRows[0],prodKey:index+1000,name:`반복 품목 ${index+1}`}))};
  await page.evaluate(value=>{window.actual=value;window.render();},many);
  assert.equal(await dialog.evaluate(el=>{const body=el.querySelector('[data-testid="applied-stock-scroll-body"]');return body.scrollHeight>body.clientHeight;}),true,'many rows scroll inside modal');
  assert.equal(await dialog.getByRole('button',{name:'닫기'}).isVisible(),true,'close remains reachable with many rows');
  assert.equal(await dialog.getByRole('button',{name:'적용재고 복사'}).isVisible(),true,'copy remains reachable with many rows');
  await page.screenshot({path:`${output}-many-rows-1920x1080.png`});
  await page.evaluate(value=>{window.actual=value;window.render();},actual);
  await dialog.getByRole('button',{name:'적용재고 복사'}).press('Enter');
  assert.equal(await page.evaluate(()=>window.copied),actual.text);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('clipboard blocked');};});
  await dialog.getByRole('button',{name:'복사됨',exact:true}).press('Enter');
  assert.match(await dialog.getByRole('alert').textContent(),/아래 원문을 선택해 복사/,'clipboard failure keeps readable fallback');
  assert.equal(await page.getByLabel('적용재고 원문').inputValue(),actual.text);
  await dialog.getByRole('button',{name:'닫기'}).click();assert.equal(await dialog.isVisible(),false);
  assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'close restores trigger focus');
  await trigger.press('Space');assert.equal(await dialog.isVisible(),true);
  await dialog.press('Escape');assert.equal(await dialog.isVisible(),false);
  assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'Escape restores trigger focus');
  const failed=buildAppliedStockCopy({...source,result:{...result,rolledBack:true}});
  await page.evaluate(value=>{window.actual=value;window.render();},failed);
  await trigger.click();assert.equal(await dialog.getByRole('button',{name:'적용재고 복사'}).isEnabled(),false);
  assert.equal(await dialog.getByRole('table').count(),0,'rollback cannot display an applied table');
  assert.match(await dialog.getByRole('status').textContent(),/저장이 완료된 뒤/);
  await dialog.getByRole('button',{name:'닫기'}).click();
  const stale=buildAppliedStockCopy({...source,result,currentScope:{...currentScope,pasteText:'changed'}});
  await page.evaluate(value=>{window.actual=value;window.render();},stale);
  await trigger.click();assert.equal(await dialog.getByRole('table').count(),0,'stale scope cannot show stock rows');
  assert.equal(await dialog.getByRole('button',{name:'적용재고 복사'}).isEnabled(),false);
  await dialog.getByRole('button',{name:'닫기'}).click();
  const noResult=buildAppliedStockCopy({...source,result:null});
  await page.evaluate(value=>{window.actual=value;window.render({result:null});},noResult);
  await trigger.click();assert.match(await dialog.getByRole('status').textContent(),/등록·분배를 실행하고 저장 결과를 검증/);
  assert.equal(await dialog.getByRole('table').count(),0);
  await dialog.getByRole('button',{name:'닫기'}).click();
  await page.evaluate(value=>{window.actual=value;window.render({bulkRunning:true});},actual);
  assert.equal(await trigger.isEnabled(),false,'running disables opening');
  await page.evaluate(()=>window.render());await trigger.click();
  await page.evaluate(value=>{window.actual=value;window.render();},stale);
  assert.equal(await dialog.isVisible(),true,'scope change retains warning dialog');
  assert.equal(await dialog.getByRole('table').count(),0,'open dialog immediately hides stale stock');
  assert.equal(await dialog.getByRole('button',{name:'적용재고 복사'}).isEnabled(),false,'open dialog cannot copy stale stock');
  await page.evaluate(value=>{window.actual=value;window.render();},actual);
  await page.evaluate(()=>window.render({bulkRunning:true}));assert.equal(await dialog.isVisible(),false,'running closes stale open dialog');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:'1920x1080 / 1366x768 / 390x844',output,keyboardOpenClose:true,focusReturn:true,clipboardFallback:true,rollbackBlocksCopy:true,staleBlocksCopy:true,noResultHint:true,runningCloses:true,manyRowsScroll:true,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
