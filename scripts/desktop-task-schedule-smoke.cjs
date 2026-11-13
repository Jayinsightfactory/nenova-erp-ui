// Real production shell/notes + authenticated bridge validation + isolated owner files.
// No production network or ERP writes. --record adds the final Korean guide.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const {requestOptions}=require('../desktop/home-workspace.cjs');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const sources=['desktop/shell/index.html','desktop/shell/home-workspace.js','desktop/shell/shell.css','desktop/shell/notes.html','desktop/shell/notes.js','desktop/shell/notes.css','desktop/shell/task-settings.js','desktop/shell/task-controls.js','pages/desktop-guide.js'];
const root=path.resolve(__dirname,'..');
async function fixture(){
 const store=await import('../lib/personalHomeStore.js');
 const storage=await fsp.mkdtemp(path.join(os.tmpdir(),'nenova-schedule-ui-'));
 const date=store.kstHomeDate(),owner='schedule-fixture',calls=[],menus=[{group:'주문관리',items:[{href:'/orders/new',labelKey:'주문등록',popup:false}]},{group:'출고관리',items:[{href:'/shipment/distribute',labelKey:'출고분배',popup:false}]}];
 let revision=0,pin=true,reminder='',fail=false;
 for(const [i,title] of ['주문서 확인','출고 내역 확인','거래처 매출 확인','업무 메일 확인','입고 자료 확인','견적서 확인','업무 자료 정리','내일 업무 준비'].entries()){
  const r=await store.mutatePersonalHome(owner,{action:'create',expectedRevision:revision,requestId:'fixture-create-'+i,date,startDate:date,title,frequency:'daily',weekdays:[0,1,2,3,4,5,6],startTime:['08:30','09:00','10:00','11:00','13:00','14:00','16:00',''][i],endTime:'',shortcut:i<2?{kind:'desktop',target:menus[i].items[0].href,label:menus[i].items[0].labelKey}:i===2?{kind:'web',target:'https://example.com/',label:'매출 보기'}:null},{root:storage});revision=r.revision;
 }
 const initial=await store.readPersonalHome(owner,{root:storage});
 const server=http.createServer((req,res)=>{let name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(name==='demo.css'){res.setHeader('content-type','text/css');return res.end('body{width:320px;margin:76px auto;border:1px solid #dce3ee;border-radius:10px;box-shadow:0 12px 40px #1232}html{background:#f3f5f9}dialog{width:310px;max-height:650px}');}if(!/^[\w.-]+$/.test(name)){res.writeHead(404);return res.end();}const file=path.join(root,'desktop/shell',name);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');let data=fs.readFileSync(file);if(name==='notes.html'&&req.url.includes('demo=1'))data=data.toString().replace('</head>','<link rel="stylesheet" href="/demo.css"></head>');res.end(data);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function invoke(action,payload={}){
  calls.push({action,payload});if(action==='state')return {homeOwnerId:owner,ownerId:owner,menuOpen:true,online:true,pinned:pin,reminder,menus,windows:[],tabs:[],favorites:[],version:'1.3.20'};
  if(action==='workspace'||action==='homeWorkspace'){
   if(fail&&payload.method==='POST'){fail=false;return {success:false,status:503,error:'연습 자료 저장 실패 · 입력 유지'};}
   const request=requestOptions(payload,owner);let record;
   if(payload.method==='POST'){const {expectedOwnerId,...command}=JSON.parse(request.options.body);try{record=await store.mutatePersonalHome(owner,command,{root:storage});}catch(e){return {success:false,status:e.statusCode||500,error:e.message};}}
   else record=await store.readPersonalHome(owner,{root:storage});
   return {success:true,schemaVersion:1,ownerId:owner,date:payload.method==='POST'?payload.command.date:payload.date||date,revision:record.revision,...store.personalHomeTasks(record,payload.date||date,{limit:500}),guidance:[],feedback:[],syncedAt:new Date().toISOString()};
  }
  if(action==='pin'){pin=payload.pinned;return {pinned:pin};}if(action==='reminder'){reminder=payload.time;return {};}
  if(action==='shortcut'||action==='taskShortcut')return {opened:true};if(action==='copy')return {copied:8};return {};
 }
 return {base,date,calls,invoke,async changeOther(){const r=await store.readPersonalHome(owner,{root:storage});await store.mutatePersonalHome(owner,{action:'complete',expectedRevision:r.revision,requestId:'fixture-race-'+r.revision,date,taskId:r.rules[1].id,done:true},{root:storage});},async reset(){const file=(await fsp.readdir(storage)).find(n=>n.endsWith('.json'));await fsp.writeFile(path.join(storage,file),JSON.stringify(initial));},failNext(){fail=true;},async close(){await new Promise(r=>server.close(r));await fsp.rm(storage,{recursive:true,force:true});}};
}
async function run(){const app=await fixture();const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const page=await browser.newPage(),errors=[];await page.exposeFunction('fixtureInvoke',app.invoke);
 await page.evaluateOnNewDocument(()=>{window.desktop={invoke:(a,p)=>window.fixtureInvoke(a,p),onState(cb){window.fixtureEmit=cb;}};window.notes={invoke:(a,p)=>window.fixtureInvoke(a,p)};});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>{if(new URL(r.url()).hostname!=='127.0.0.1')r.abort();else r.continue();});
 await page.setViewport({width:1920,height:1080});await page.goto(app.base+'/index.html');await page.waitForSelector('.hw-task');assert.equal((await page.$$('.hw-task')).length,8);fs.mkdirSync(path.join(root,'.verify'),{recursive:true});await page.screenshot({path:path.join(root,'.verify/task-home.png')});
 await page.$$eval('.hw-viewbar button',b=>b[1].click());await page.waitForSelector('.hw-time-slot');await page.$$eval('.hw-time-slot',rows=>rows.find(r=>r.querySelector('time').textContent==='12:00').querySelector('.hw-slot-add').click());assert.equal(await page.$eval('.hw-add input[name=startTime]',e=>e.value),'12:00');
 await page.type('.hw-add>input','시간표 테스트');await page.select('.hw-repeat>select','daily');await page.click('.hw-add>button');await page.waitForFunction(()=>!document.querySelector('.hw-add>input').value);await page.$$eval('.hw-viewbar button',b=>b[0].click());await page.goto(app.base+'/notes.html');await page.setViewport({width:320,height:690});await page.waitForSelector('.task');assert.equal((await page.$$('.task')).length,9);
 const dimensions=await page.$$eval('.task',rows=>rows.slice(0,8).map(e=>{const r=e.getBoundingClientRect();return {bottom:r.bottom,height:r.height}}));assert.ok(dimensions.every(r=>r.bottom<=690&&r.height<=54));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(root,'.verify/task-notes-320.png')});
 const before=app.calls.filter(c=>c.payload?.method==='POST').length;await page.click('.task-go');assert.equal(app.calls.at(-1).action,'shortcut');assert.equal(app.calls.filter(c=>c.payload?.method==='POST').length,before);
 await page.click('#openAdd');await page.type('#title','입력 보존 확인');app.failNext();await page.click('#add button[type=submit]');await page.waitForFunction(()=>!document.querySelector('#editError').hidden);assert.equal(await page.$eval('#title',e=>e.value),'입력 보존 확인');await page.click('#add button[type=submit]');await page.waitForFunction(()=>!document.querySelector('#editor').open);
 await page.select('#filter','timeline');await page.$$eval('.slot',rows=>rows.find(r=>r.querySelector('time').textContent==='15:00').querySelector('.empty-slot').click());assert.equal(await page.$eval('#settings input[name=startTime]',e=>e.value),'15:00');await page.keyboard.press('Escape');assert.equal(await page.$eval('#editor',e=>e.open),false);
 await page.select('#filter','all');await page.click('.task-actions button');await page.waitForSelector('#editor[open]');await page.$eval('#settings input[name=startTime]',e=>{e.value='08:00';e.dispatchEvent(new Event('input',{bubbles:true}));});await app.changeOther();await page.click('#add button[type=submit]');await page.waitForFunction(()=>!document.querySelector('#editError').hidden);assert.equal(await page.$eval('#editor',e=>e.open),true);assert.equal(await page.$eval('#settings input[name=startTime]',e=>e.value),'08:00');await page.click('#add button[type=submit]');await page.waitForFunction(()=>!document.querySelector('#editor').open);await page.reload();await page.waitForFunction(()=>document.querySelector('.task-time').textContent==='08:00');
 for(const width of [280,390]){await page.setViewport({width,height:690});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);console.log('Task UI PASS: actual home8/notes320px8, timeline-prefill, disk-save/reload, launch independent of completion, failed input retained, edit, Escape, 280/390px, JS0');
 if(process.argv.includes('--record'))await record(page,app);
 }finally{await browser.close();await app.close();}}
async function record(page,app){
 await app.reset();
 await page.setViewport({width:1920,height:1080});await page.goto(app.base+'/index.html');await page.waitForSelector('.hw-task');const recorder=await createWorkflowGuideRecorder(page,{root,workflowId:'desktop-task-schedule',guideId:'staff',title:'오늘의 내 업무 · 시간과 바로가기',sourceFiles:sources,fixtureOnly:true});
 async function step(scenario,title,selector,act){recorder.chapter(scenario,title);await recorder.caption(title+' · 먼저 화면에서 위치를 확인하세요.');await recorder.pause(1800);await recorder.focus(selector,Number(title.split('.')[0]));await act();await recorder.pause(1800);await recorder.unfocus();}
 await step('overview','1. 홈에서 오늘 업무 확인','.hw-heading h2',async()=>{await recorder.caption('1. 홈에서 오늘 업무 확인 · 시간순 목록과 별도의 완료 체크를 확인합니다.');});
 await step('schedule','2. 시간표에서 매일 업무 입력','.hw-viewbar',async()=>{await page.$$eval('.hw-viewbar button',b=>b[1].click());await recorder.caption('2. 시간표에서 매일 업무 입력 · 빈 시간의 추가 버튼을 누르면 시작 시간이 채워집니다.');});
 await page.$$eval('.hw-time-slot',rows=>rows.find(r=>r.querySelector('time').textContent==='15:00').querySelector('.hw-slot-add').click());
 await step('save','3. 업무명과 반복을 입력하고 저장','.hw-add',async()=>{await page.type('.hw-add>input','매일 자료 확인',{delay:120});await page.select('.hw-repeat>select','daily');await recorder.caption('3. 업무명과 반복을 입력하고 저장 · 매일과 시작 15:00을 확인하고 추가합니다.');await page.click('.hw-add>button');await page.waitForFunction(()=>!document.querySelector('.hw-add>input').value);});
 await page.goto(app.base+'/notes.html?demo=1');await page.waitForSelector('.task');await recorder.restoreOverlay();
 await step('notes','4. 좁은 PC 메모장에서 업무 확인','header',async()=>{await recorder.caption('4. 좁은 PC 메모장에서 업무 확인 · 기본 폭 320px, 업무 8개가 보이며 설명과 설정은 수정에서 엽니다.');});
 await page.click('.task-actions button');await page.waitForSelector('#editor[open]');await recorder.restoreOverlay();
 recorder.chapter('shortcut','5. 메뉴를 검색해 바로가기 연결');
 await recorder.caption('5. 메뉴를 검색해 바로가기 연결 · 데스크톱 메뉴의 검색칸 위치를 확인합니다.');await recorder.pause(1800);
 await recorder.focus('#settings input[name=shortcutSearch]',5);
 await page.type('#settings input[name=shortcutSearch]','주 문',{delay:230});await recorder.pause(1600);await page.keyboard.press('Enter');
 await recorder.caption('5. 메뉴를 검색해 바로가기 연결 · 메뉴명·분류명으로 찾고 Enter로 주문등록을 선택합니다.');await recorder.pause(2200);await recorder.unfocus();
 await recorder.caption('5. 메뉴를 검색해 바로가기 연결 · 선택한 메뉴와 버튼 이름을 확인한 뒤 저장합니다.');await recorder.pause(1800);
 await page.$eval('#add button[type=submit]',e=>e.scrollIntoView({block:'center'}));await recorder.focus('#add button[type=submit]',5);
 await page.click('#add button[type=submit]');await page.waitForFunction(()=>!document.querySelector('#editor').open);await recorder.unfocus();await recorder.caption('5. 메뉴를 검색해 바로가기 연결 · 저장된 목록에서 주문등록 바로가기를 확인합니다.');await recorder.pause(2200);
 await step('launch','6. 바로가기와 완료를 따로 사용','.task-go',async()=>{await page.click('.task-go');await recorder.caption('6. 바로가기와 완료를 따로 사용 · 메뉴를 열어도 완료 체크는 바뀌지 않습니다. 연습 화면이라 실제 ERP 이동은 하지 않습니다.');await page.click('.task input');await page.waitForFunction(()=>document.querySelector('.task input').checked);});
 await recorder.pause(1800);const result=await recorder.stop();const file=path.join(root,'config/workflow-guides.json'),registry=JSON.parse(fs.readFileSync(file));const item={id:'desktop-task-schedule',title:'오늘의 내 업무 · 시간과 바로가기',entryPaths:['/desktop-guide'],sourceFiles:sources,requiredScenarios:['overview','schedule','save','notes','shortcut','launch'],guides:[{id:'staff',role:'직원',title:'시간표 입력부터 PC 메모장 바로가기까지',status:'ready',src:'/guides/desktop-task-schedule/staff.mp4',captions:'/guides/desktop-task-schedule/staff.ko.vtt',proof:'/guides/desktop-task-schedule/staff.proof.json',chapters:result.chapters}]};registry.workflows=registry.workflows.filter(w=>w.id!==item.id);registry.workflows.push(item);fs.writeFileSync(file,JSON.stringify(registry,null,2)+'\n');console.log('Recorded guide '+result.duration.toFixed(1)+'s');
}
module.exports={fixture,sources};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
