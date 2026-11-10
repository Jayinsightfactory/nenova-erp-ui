// Actual local player/media check. Every API is synthetic; no SQL or ERP writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
async function main(){
  const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json')),workflow=registry.workflows.find(w=>w.id==='customs-settlement-zip'),guide=workflow.guides[0];assert.equal(guide.status,'ready');
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const secret=crypto.randomUUID(),base=`http://localhost:${port}`,log=fs.openSync('.verify/customs-player-server.log','w');
  const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret,PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED:'1'},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);let browser,page;
  try{
    for(let n=0;n<120;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===119)throw Error('Player server startup failed');await new Promise(r=>setTimeout(r,1000));}
    browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});page.setDefaultTimeout(45000);
    const errors=[],assets=[],writes=[],user={userId:'guide-player',userName:'연습 재생 검증',authority:1,deptName:'경영지원',accountActive:true};page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/guides/customs-settlement-zip/'))assets.push({path:url.pathname,status:r.status()});});
    await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'10m'}),url:base});await page.setRequestInterception(true);page.on('request',request=>{
      const url=new URL(request.url());if(url.origin!==base)return request.abort();if(!url.pathname.startsWith('/api/'))return request.continue();if(request.method()!=='GET')writes.push(url.pathname);
      return request.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,user,countries:[],colombia:[],rates:{},autoGw:{},activeCategories:[],major:'35',orderYear:'2026',items:[],rows:[],data:[]})});
    });
    await page.goto(base+'/sales/customs-clearance?year=2026&week=35',{waitUntil:'networkidle0',timeout:120000});
    const summary=await page.$('[aria-label="선율 정산 ZIP 연결"] summary');assert(summary);await summary.focus();await page.keyboard.press('Enter');await page.waitForSelector('video');assert(await page.$eval('video',v=>v.paused));
    const role=await page.evaluateHandle(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='경영지원용'));assert(await role.asElement());await role.asElement().focus();await page.keyboard.press('Space');assert(await page.$eval('video',v=>v.getAttribute('aria-label').startsWith('경영지원')));
    await page.$eval('video',v=>{v.muted=true;return v.play();});await page.waitForFunction(()=>document.querySelector('video').currentTime>.3,{timeout:15000});await page.$eval('video',v=>{v.pause();v.textTracks[0].mode='showing';});
    const chapters=await page.$$('nav[aria-label="경영지원 영상 목차"] button');assert.equal(chapters.length,4);for(let i=0;i<chapters.length;i++)assert((await chapters[i].evaluate(n=>n.textContent)).includes(`${i+1}. `),'Player chapter business-step numbering');await chapters[1].focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.readyState>=2&&v.currentTime>1;});assert(await page.$eval('video',v=>v.paused&&document.activeElement===v));
    await page.waitForFunction(()=>document.querySelector('video track').readyState===2,{timeout:15000});assert(await page.$eval('video',v=>v.textTracks.length===1&&v.textTracks[0].language==='ko'&&v.textTracks[0].cues.length>0));
    // The recording has readable burned-in Korean explanations; verify optional CC,
    // then return to the normal default so screenshots do not show two caption layers.
    await page.$eval('video',v=>{v.textTracks[0].mode='disabled';});
    assert(await page.$('a[download][href$=".mp4"]'));assert(await page.$('a[download][href$=".vtt"]'));
    for(const asset of [guide.src,guide.captions]){const response=await fetch(base+asset,{method:'HEAD'});assert.equal(response.status,200);}
    await page.$eval('video',v=>v.scrollIntoView({block:'center'}));await page.screenshot({path:'.verify/customs-player-desktop.png'});
    await page.setViewport({width:390,height:844,deviceScaleFactor:1});await page.$eval('video',v=>v.scrollIntoView({block:'center'}));assert(await page.$eval('video',v=>{const r=v.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));await page.screenshot({path:'.verify/customs-player-mobile.png'});
    await page.$eval('video',v=>v.play());await summary.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('video').paused);
    await summary.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert(await role.asElement().evaluate(n=>n===document.activeElement));await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert(await summary.evaluate(n=>n===document.activeElement));
    assert.deepEqual(errors,[]);assert(assets.some(a=>a.path.endsWith('.mp4')));assert(assets.some(a=>a.path.endsWith('.vtt')));assert(assets.every(a=>[200,206,304].includes(a.status)));assert.deepEqual(writes,[]);
    const result={result:'PASS',workflow:workflow.id,keyboard:'Enter/Space/Tab/Shift+Tab, chapter seek focuses video',actualPlayback:true,koreanCaptions:true,chapterCount:4,downloadLinks:true,collapsePauses:true,viewports:[1920,390],mediaAssets:assets,allApisSynthetic:true,productionWrites:0};fs.writeFileSync('.verify/customs-player-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
