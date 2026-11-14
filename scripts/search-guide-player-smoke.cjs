// Verify recaptured search-related guides against the actual bundled UI; all APIs are synthetic.
const fs=require('fs'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const base=process.env.GUIDE_BASE_URL||'http://localhost:3237';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixture required');
const ids=['arrival-upload-review','estimate-management','estimate-shipment-date-sales','order-import-workspace','shipment-field-volume','product-new-registration'];
(async()=>{
 const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8'));
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 const results=[];
 try{
  for(const id of ids){
   const workflow=registry.workflows.find(w=>w.id===id),page=await browser.newPage(),errors=[],assets=[],consoleErrors=[];
   await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
   page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/guides/'))assets.push(r.status());});
   await page.setRequestInterception(true);page.on('request',r=>{
    const u=new URL(r.url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();
    const user={userId:'guide',userName:'연습 사용자',authority:1,accountActive:true};
    return r.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,user,rows:[],items:[],data:[],varieties:[],imports:[],candidates:[],results:[],types:[],mismatches:[],products:[],customers:[],weeks:[],shipments:[],groups:[],countries:[],flowers:[],favorites:[],history:[],operations:[],requests:[],permissions:{request:true,review:true},config:{enabled:false,year:'2026',countries:[]},lookup:{farms:[],products:[]}})});
   });
   await page.goto(base+workflow.entryPaths[0],{waitUntil:'networkidle0'});
   await page.waitForFunction(title=>[...document.querySelectorAll('h3')].some(n=>n.textContent===title),{},workflow.title).catch(async e=>{fs.mkdirSync('.verify/search-guide-player',{recursive:true});await page.screenshot({path:'.verify/search-guide-player/failure.png',fullPage:true});fs.writeFileSync('.verify/search-guide-player/failure.txt',await page.evaluate(()=>document.body.innerText));console.error(id,'pageErrors',errors,'consoleErrors',consoleErrors);throw e;});
   await page.evaluate(title=>{const h=[...document.querySelectorAll('h3')].find(n=>n.textContent===title);h.closest('details').id='guide-qa';},workflow.title);
   const summary=await page.$('#guide-qa > summary');await summary.focus();await page.keyboard.press('Enter');
   const guide=workflow.guides[0];
   const role=await page.evaluateHandle(role=>[...document.querySelector('#guide-qa').querySelectorAll('button')].find(n=>n.textContent===`${role}용`),guide.role);
   await role.asElement().focus();await page.keyboard.press('Space');
   await page.$eval('#guide-qa video',v=>{v.muted=true;v.load();});
   await page.waitForFunction(()=>document.querySelector('#guide-qa video').readyState>=1);
   assert(await page.$eval('#guide-qa video',v=>v.videoWidth===1920&&v.videoHeight===1080));
   await page.$eval('#guide-qa video',v=>v.play());await page.waitForFunction(()=>document.querySelector('#guide-qa video').currentTime>.2);
   await page.$eval('#guide-qa video',v=>{v.pause();v.textTracks[0].mode='showing';});
   await page.waitForFunction(()=>document.querySelector('#guide-qa video track').readyState===2);
   const chapters=await page.$$('#guide-qa nav button');assert.equal(chapters.length,guide.chapters.length);
   const index=chapters.length-1;await chapters[index].focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!document.querySelector('#guide-qa video').seeking);
   assert(await page.$eval('#guide-qa video',(v,seconds)=>Math.abs(v.currentTime-seconds)<.3,guide.chapters[index].seconds));
   assert.equal(await page.$$eval('#guide-qa a[download]',nodes=>nodes.length),2);
   await page.$eval('#guide-qa video',v=>v.scrollIntoView({block:'center'}));
   fs.mkdirSync('.verify/search-guide-player',{recursive:true});await page.screenshot({path:`.verify/search-guide-player/${id}-1920.png`});
   await page.setViewport({width:390,height:844});await page.$eval('#guide-qa video',v=>v.scrollIntoView({block:'center'}));
   assert(await page.$eval('#guide-qa video',v=>{const r=v.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
   await page.screenshot({path:`.verify/search-guide-player/${id}-390.png`});
   await page.$eval('#guide-qa video',v=>v.play());await summary.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#guide-qa video').paused);
   assert.deepEqual(errors,[]);assert(assets.length>=2&&assets.every(s=>[200,206,304].includes(s)));
   results.push({id,passed:true,chapters:chapters.length,checks:['keyboard-open-role','actual-mp4-playback','1920x1080','korean-vtt','chapter-seek','downloads','390px','collapse-pause']});
   console.log('PASS',id);await page.close();
  }
  fs.writeFileSync('.verify/search-guide-player/results.json',JSON.stringify(results,null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
