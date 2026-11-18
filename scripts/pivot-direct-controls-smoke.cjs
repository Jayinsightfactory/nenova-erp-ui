const fs=require('node:fs'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const base=process.env.PIVOT_TEST_URL||'http://127.0.0.1:3027';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local fixture only');
const record=process.argv.includes('--record');
const rows=[
{OrderYear:'2026',OrderWeek:'46-02',CounName:'중국',FlowerName:'장미',ProdName:'연습 장미 핑크',CustName:'연습 업체 A',CountryFlower:'중국 장미',ListType:'02. 주문',Quantity:20,DistCost:1000},
{OrderYear:'2026',OrderWeek:'46-02',CounName:'중국',FlowerName:'카네이션',ProdName:'연습 카네이션 화이트',CustName:'연습 업체 B',CountryFlower:'중국 카네이션',ListType:'02. 주문',Quantity:30,DistCost:800},
{OrderYear:'2026',OrderWeek:'46-02',CounName:'콜롬비아',FlowerName:'수국',ProdName:'연습 수국 블루',CustName:'연습 업체 A',CountryFlower:'콜롬비아 수국',ListType:'02. 주문',Quantity:10,DistCost:1200},
{OrderYear:'2025',OrderWeek:'46-02',CounName:'중국',FlowerName:'장미',ProdName:'전년도 연습 장미',CustName:'연습 업체 A',CountryFlower:'중국 장미',ListType:'02. 주문',Quantity:7,DistCost:900}];
(async()=>{const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.evaluateOnNewDocument(()=>{localStorage.setItem('nenovaUser',JSON.stringify({userId:'pivot-guide',role:'admin'}));localStorage.setItem('statsPivotMode','exe');localStorage.setItem('pivotExeWebToolsOpen','0');});
await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['data:','blob:'].includes(u.protocol))return r.continue();if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();let payload={success:true,rows:[],data:[]};if(u.pathname==='/api/auth/me')payload={success:true,user:{userId:'pivot-guide',role:'admin'}};if(u.pathname==='/api/favorites')payload={success:true,favorites:[]};if(u.pathname==='/api/stats/pivot-exe')payload=u.searchParams.get('mode')==='weeks'?{success:true,weeks:[{OrderYear:'2026',OrderWeek:'46-02',OrderYearWeek:'20264602'}]}:{success:true,rows:rows.filter(row=>row.OrderYear>=u.searchParams.get('fromYear')&&row.OrderYear<=u.searchParams.get('toYear')),columns:Object.keys(rows[0]),scope:{orderYear:'2026',weekStart:'46-02',weekEnd:'46-02'}};return r.respond({status:200,contentType:'application/json',body:JSON.stringify(payload)});});
await page.goto(base+'/stats/pivot?popup=1',{waitUntil:'networkidle0',timeout:120000});
await page.waitForSelector('[data-testid="pivot-exe-grid"]',{timeout:60000});
const rangeSelects=await page.$$('[data-testid="pivot-exe-toolbar"] select');
for(const select of rangeSelects)await select.select('46-02');
await page.click('[data-testid="pivot-exe-refresh"]');
await page.waitForFunction(()=>document.querySelector('[data-testid="pivot-exe-load-status"]')?.textContent.includes('2026 46-02 ~ 2026 46-02'));
const field=id=>`[data-testid="pivot-exe-field-${id}"]`,dialog='[data-testid="pivot-exe-value-filter"]';
async function button(text,scope=dialog){const h=await page.evaluateHandle((sel,text)=>[...document.querySelector(sel).querySelectorAll('button')].find(e=>e.textContent.trim()===text),scope,text);assert(h.asElement(),text);await h.asElement().click();await h.dispose();}
async function ready(){await page.waitForFunction(()=>!document.querySelector('[data-testid="pivot-exe-value-filter"]'));await new Promise(r=>setTimeout(r,650));}
await page.waitForFunction(()=>{const e=document.querySelector('[data-testid="pivot-exe-field-CounName"]');return e&&e.getBoundingClientRect().height>=32;});
await new Promise(r=>setTimeout(r,1800));
const shape=await page.$eval(field('CounName'),e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});assert(shape.w>=64&&shape.h>=32);await page.hover(field('CounName'));assert.deepEqual(await page.$eval(field('CounName'),e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}),shape);
assert.equal(await page.$$eval('[data-testid="pivot-exe-filter-CounName"],[data-testid="pivot-exe-menu-CounName"]',es=>es.length),0);
const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json'));const workflow=registry.workflows.find(w=>w.id==='pivot-direct-filters');let rec;
if(record)rec=await createWorkflowGuideRecorder(page,{workflowId:workflow.id,guideId:'user',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true,includeHeader:true,encodingPreset:'fast'});
async function step(n,id,text,selector){if(rec){rec.chapter(id,`${n}. ${text}`);await rec.caption(`${n}. ${text}`);await rec.focus(selector,n);await rec.unfocus();}}
async function done(){if(rec){await rec.pause(1800);}}
await step(1,'country','국가 버튼을 눌러 중국만 선택하고 적용합니다.',field('CounName'));
await page.click(field('CounName'));await page.waitForSelector(dialog,{visible:true});if(rec)await rec.pause(1500);await button('전체 해제');await page.$$eval(`${dialog} label`,ls=>{const l=ls.find(l=>l.textContent.trim()==='중국');l.querySelector('input').click();});if(rec)await rec.pause(2200);await button('선택·순서 적용');await ready();assert((await page.$eval('[data-testid="pivot-exe-grid"]',e=>e.innerText)).includes('연습 장미 핑크'));assert(!(await page.$eval('[data-testid="pivot-exe-grid"]',e=>e.innerText)).includes('연습 수국 블루'));await done();
await step(2,'empty','꽃 전체 해제는 0행입니다. 전체 선택으로 복구한 뒤 적용합니다.',field('FlowerName'));
await page.click(field('FlowerName'));await page.waitForSelector(dialog,{visible:true});await button('전체 해제');assert((await page.$eval(dialog,e=>e.innerText)).includes('적용하면 표가 비게 됩니다'));if(rec)await rec.pause(2500);await button('전체 선택');await button('선택·순서 적용');await ready();await done();
await step(3,'settings','필터 창의 정렬·배치 설정에서 필요한 옵션만 선택합니다.',field('CounName'));
await page.click(field('CounName'));await page.waitForSelector(dialog,{visible:true});await button('정렬·배치 설정');await page.waitForSelector('[aria-label="필드 정렬"]',{visible:true});if(rec)await rec.pause(3500);await page.select('[aria-label="필드 정렬"]','desc');await ready();await done();
if(rec){const result=await rec.stop();workflow.guides[0].status='ready';workflow.guides[0].chapters=result.chapters;fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');console.log('Recorded',result.duration);return;}
// Keyboard filter activation, Escape focus return; native select moves retain data.
await page.focus(field('FlowerName'));await page.keyboard.press('Enter');await page.waitForSelector(dialog,{visible:true});await page.focus(dialog+' input[type="checkbox"]');await page.keyboard.press('ArrowDown');assert.equal(await page.$eval(dialog,e=>[...e.querySelectorAll('input[type="checkbox"]')].indexOf(document.activeElement)),1);await page.keyboard.press('Enter');await page.keyboard.press('Space');
await page.keyboard.press('Escape');await ready();assert.equal(await page.evaluate(()=>document.activeElement.dataset.testid),'pivot-exe-field-FlowerName');
await page.focus(field('CounName'));
await page.keyboard.down('Shift');await page.keyboard.press('F10');await page.keyboard.up('Shift');await page.waitForSelector('[aria-label="필드 배치 위치"]',{visible:true});await page.select('[aria-label="필드 배치 위치"]','filters');await ready();assert.equal(await page.$eval(field('CounName'),e=>e.dataset.zone),'filters');
fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/pivot-controls-1920.png'});
for(const width of [1280,390]){await page.setViewport({width,height:1080,deviceScaleFactor:1});await page.click(field('CounName'));await page.waitForSelector(dialog,{visible:true});await page.waitForFunction((sel,w)=>{const e=document.querySelector(sel),r=e?.getBoundingClientRect();return r&&r.left>=0&&r.right<=w;},{timeout:3000},dialog,width);const rect=await page.$eval(dialog,e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}});assert(rect.left>=0&&rect.right<=width);await page.keyboard.press('Escape');await ready();}
if(!record){
await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
await page.click('[data-testid="pivot-exe-web-tools"] > summary');
const guide=await page.evaluateHandle(()=>[...document.querySelectorAll('summary')].find(e=>e.textContent.startsWith('사용 가이드 영상')));await guide.asElement().focus();await page.keyboard.press('Enter');
await page.$eval('video',async v=>{await v.play();v.textTracks[0].mode='showing';});await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
const chapters=await page.$$('[aria-label="공통 영상 목차"] button');await chapters[1].focus();await page.keyboard.press('Enter');
assert(await page.$eval('video',v=>v.currentTime>5&&v.textTracks[0].mode==='showing'));
assert.equal(await page.$$eval('a[download][href*="pivot-direct-filters"]',es=>es.length),2);
await page.$eval('video',v=>v.pause());console.log('PASS guide playback, captions, keyboard chapter seek, download links');
}
assert.deepEqual(errors,[]);console.log('PASS direct 32px targets, stable hover, China result, empty warning/recovery, sorting, keyboard, movement, 1920/1280/390');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
