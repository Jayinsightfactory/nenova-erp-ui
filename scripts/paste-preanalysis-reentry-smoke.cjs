const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer-core');
const swc=require('next/dist/build/swc');
(async()=>{
 const raw=fs.readFileSync(path.join(__dirname,'../components/orders/DistributionMessagePreanalysis.js'),'utf8')
  .replace(/import \{useEffect,useRef,useState\} from 'react';/, 'const {useEffect,useRef,useState}=React;')
  .replace(/import \{analysisKey,analysisGroups,usablePreparedAnalysis\} from '[^']+';/, 'const {analysisKey,analysisGroups,usablePreparedAnalysis}=window.preanalysis;')
  .replace('export default function DistributionMessagePreanalysis','function DistributionMessagePreanalysis');
 await swc.loadBindings(); const compiled=await swc.transform(raw,{filename:'preanalysis.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'classic'}}},module:{type:'commonjs'}});
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:1080,deviceScaleFactor:1}});
 try{
  const page=await browser.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
  const stored={success:true,orders:[{custName:'원문업체',custMatch:{CustKey:1,CustName:'저장업체'},items:[{inputName:'원문품목',prodName:'저장품목',prodKey:2,qty:3,unit:'단',action:'추가'}]}],analysisStorage:{savedAt:Date.now()-5000,cacheHit:true}};
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.exposeFunction('fixtureFetch',async(text,week,options)=>{
   calls.push({text,week,...options});
   if(options.lookupOnly)return text==='saved'?stored:{analysisStorage:{cacheMiss:true}};
   if(options.force)throw Error('재분석 실패 fixture');
   await gate;return {...stored,analysisStorage:{savedAt:Date.now(),cacheHit:false}};
  });
  page.setDefaultTimeout(10000);
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/,'umd/react.development.js')});
  await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.development.js')});
  await page.addScriptTag({content:`window.preanalysis=(()=>{const module={exports:{}};${fs.readFileSync(path.join(__dirname,'../lib/pasteInboxPreanalysis.js'),'utf8')}return module.exports})();${compiled.code}\nwindow.Card=DistributionMessagePreanalysis;`});
  await page.evaluate(()=>{
   window.opened=[];window.root=ReactDOM.createRoot(document.getElementById('app'));
   window.renderFixture=(disabled=false)=>{
    const cache=window.preanalysis.createPreanalysisCache({persistent:true,fetcher:window.fixtureFetch});
    const prepare=(text,week,options)=>cache.read(text,week,options);
    window.root.render(React.createElement('div',{className:'compact-match-list'},...['slow','queued','saved','offscreen'].map((text,index)=>React.createElement('div',{key:text,id:text,style:index===2?{marginTop:2000}:{minHeight:120}},React.createElement(window.Card,{text,week:'2026-41-01',disabled,prepare,onOpen:result=>window.opened.push(result)},'원장 적용 상태는 별도')))));
   };window.renderFixture();
  });
  await page.waitForFunction(()=>document.querySelector('#saved button')?.textContent==='등록분배하기',{timeout:10000});
  await page.waitForFunction(()=>document.querySelector('#slow button')?.textContent==='분석 중'&&document.querySelector('#queued button')?.textContent==='분석 대기');
  assert.equal(calls.filter(c=>!c.lookupOnly).length,1,'offscreen misses do not start model work');
  assert(calls.some(c=>c.text==='saved'&&c.lookupOnly),'offscreen saved work restores without viewport eligibility');
  await page.$eval('#saved',el=>el.scrollIntoView());
  await page.focus('#saved button');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.opened.length),1);
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement.textContent==='재분석'));
  await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  await page.keyboard.press(' ');assert.equal(await page.evaluate(()=>window.opened.length),2);
  await page.focus('#saved button:nth-child(2)');await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#saved button',el=>el.disabled),false,'saved result stays openable during queued reanalysis');
  release();
  await page.waitForFunction(()=>document.querySelector('#saved [role=status]').textContent.includes('재분석 실패'));
  assert.equal(await page.$eval('#saved button',el=>el.textContent),'등록분배하기','failed reanalysis preserves saved review');
  release();await page.waitForFunction(()=>document.querySelector('#slow button')?.textContent==='등록분배하기');
  const before=calls.filter(c=>c.text==='saved'&&!c.lookupOnly&&!c.force).length;
  await page.evaluate(()=>{window.root.unmount();window.root=ReactDOM.createRoot(document.getElementById('app'));window.renderFixture(true)});
  await page.waitForFunction(()=>document.querySelector('#saved button')?.textContent==='등록분배하기');
  assert(await page.$eval('#saved button',el=>el.disabled),'saving still blocks application opening');
  assert.equal(calls.filter(c=>c.text==='saved'&&!c.lookupOnly&&!c.force).length,before,'reentry never repeats saved model analysis');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:'1920x1080 / 100%',savedOffscreenRestore:true,queuedSeparate:true,offscreenModelCalls:0,keyboardOpen:true,failedReanalysisPreserves:true,reentryModelCalls:0,erpWrites:0}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});

