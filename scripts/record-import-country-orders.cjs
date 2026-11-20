// Actual local UI, all APIs intercepted with synthetic data. No ERP connection or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');

const root=process.cwd(),paced=process.argv.includes('--paced-dry-run'),dry=process.argv.includes('--dry-run')||paced;
async function main(){
 fs.mkdirSync('.verify',{recursive:true});
 const {classifyImportFeed}=await import('../lib/importKakaoOrderText.js');
 const sampleMessage=(id,text)=>({id,time:id==='white'?'2026년 11월 12일 오전 9:10':'2026년 11월 18일 오전 9:10',text,sender:'연습 담당자',items:[]});
 const sampleMessages=[...['주광','미우','일신'].map((customer,i)=>sampleMessage(String(i),'46-1 콜 카네이션 발주 추가\n'+customer+'\nMoon Light '+[1,2,1][i]+'박스')),sampleMessage('white','46-1 콜 수국 발주 추가\n화이트 2박스'),sampleMessage('duplicate','46-1 콜 카네이션 발주 추가\n주광\nMoon Light 1박스'),sampleMessage('noise','이번에 온 3박스가 포장 불량입니다'),sampleMessage('cancel','46-1 콜 카네이션 발주 취소\n별도품종 1박스')];
 sampleMessages.push(sampleMessage('missed','46-1 콜 수국 추가\n연습화이트 두 박스 부탁합니다.'));
 const sampleFeed=classifyImportFeed({orderDays:['2026-11-18','2026-11-12'],reviewThrough:'2026-11-18',from:'2026-11-17',to:'2026-11-18',latest:'2026년 11월 18일 오전 9:10',messages:sampleMessages});
 const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8')),workflow=registry.workflows.find(w=>w.id==='import-country-orders');
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://localhost:${port}`,secret=crypto.randomUUID(),log=fs.openSync('.verify/country-orders-guide-server.log','w');
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret,PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED:'1'},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 let browser,page,rec,stopped=false;
 try{
  for(let n=0;n<120;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===119)throw Error('Local server startup failed');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});page.setDefaultTimeout(20000);
  const user={userId:'guide',userName:'연습 담당자',authority:1,deptName:'수입부',accountActive:true};
  await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'1h'}),url:base});
  const addDays=days=>new Date(Date.parse('2026-11-12T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const cycles = Array.from({length:6}, (_, offset) => ({ key: '2026/' + (46+offset), year:2026, majorWeek:String(46+offset), startDate:addDays(offset*7), endDate:addDays(offset*7+6) }));
  const week = {key:'2026/46-01',orderWeek:'46-01'};
  const row = {OrderYear:2026, OrderWeek:week.orderWeek, CustKey:1, CustName:'연습 업체', CustOrderCode:'CL21', ProdKey:1, ProdName:'연습 튤립', FlowerName:'튤립', CounName:'네덜란드', OutUnit:'송이', OutQuantity:150, BoxQuantity:0, BunchQuantity:15, SteamQuantity:150, SourceRowCount:1};
  const downloadDir = path.resolve('.verify/country-orders',crypto.randomUUID());
  fs.mkdirSync(downloadDir,{recursive:true});
  const client=await page.createCDPSession(); await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
  const details=[];
  await page.setRequestInterception(true);
  page.on('request',async req=>{
    const url=new URL(req.url());
    if(url.protocol==='blob:') return req.continue();
    if(url.origin!==base)return req.abort();
    if(!url.pathname.startsWith('/api/'))return req.continue();
    let data={success:true,items:[],rows:[],products:[],data:[],value:null,revision:0,history:[],user};
    if(url.pathname.endsWith('/kakao-additions')) data=url.searchParams.get('audit')==='1'?{...sampleFeed,audit:classifyImportFeed({messages:sampleMessages},new Map(),{audit:true}).audit}:sampleFeed;
    if(url.pathname.endsWith('/country-orders')){
      const country=url.searchParams.get('country'),exact=url.searchParams.get('orderWeek');
      if(exact)details.push(exact);
      const counName=country==='China'?'중국':'네덜란드';
      const sourceRows=country==='China'?[{...row,CounName:counName,ProdName:'ROSE / 연습 화이트 50cm',FlowerName:'장미',OutUnit:'단',OutQuantity:15},{...row,CounName:counName,ProdKey:2,ProdName:'ROSE / 연습 핑크 50cm',FlowerName:'장미',OutUnit:'단',OutQuantity:10}]:[row];
      data={success:true,readOnly:true,cycles,scope:country?{country,counName,year:2026,majorWeek:'46',scopeKey:country+'/2026/46'}:null,subweeks:country?[week]:[],rows:exact?sourceRows:[],warnings:[],diagnostics:{hiddenOrderCount:0}};
    }
    await req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(base+'/import/tools',{waitUntil:'networkidle0',timeout:150000});
  await page.waitForSelector('[aria-controls="import-panel-orders"]');
  await page.click('[aria-controls="import-panel-orders"]');
  // Record the fullscreen fallback in the original tab. Dry runs separately exercise the actual popup.
  await page.evaluate(() => { window.__orderGuideOpen = window.open; window.open = () => null; window.showSaveFilePicker = undefined; });
  const country='.pedidos-auto [aria-label="국가"] button:nth-child(2)',cycle='.pedidos-cycles button',sub='.pedidos-subweeks[aria-label="실제 주문 세부차수"] button',down='.pedidos-auto-actions button:not([disabled])';
  const openPreview='.pedidos-primary button.pedidos-open-preview';
  async function selectThenOpen(number) {
    await page.waitForSelector(openPreview+':enabled',{visible:true});
    assert.equal(await page.$('#pedidos-preview-title'),null);
    await rec.pause(700);await rec.unfocus();
    await rec.focus(openPreview,number);
    await page.focus(openPreview);await page.keyboard.press('Enter');
  }
  await page.waitForSelector(country,{visible:true});
  const countryButton=await page.evaluate(()=>[...document.querySelectorAll('[aria-label="국가"] button')].findIndex(b=>b.textContent.includes('네덜란드'))+1);
  assert(countryButton);
  rec=dry?{chapter(){},focus:async()=>{},unfocus:async()=>{},caption:async()=>{},pause:async()=>{},stop:async()=>({})}:await createWorkflowGuideRecorder(page,{workflowId:workflow.id,guideId:'import',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true});
  const steps=[
   ['country','국가 선택','[aria-label="국가"] button:nth-child('+countryButton+')','네덜란드를 선택하면 차수 버튼이 나타납니다.'],
   ['cycle','차수 선택',cycle,'2026년 46차를 선택해 실제 주문이 있는 세부차수를 확인합니다.'],
   ['week','세부차수와 미리보기',sub,'46-01차로 주문을 조회한 뒤 매칭데이터 미리보기 열기를 눌러 품목과 수량을 확인합니다.'],
   ['review','송이 수 확인·수정','.pedidos-review-input','전산 원수량 150송이를 확인하고 이번 발주 수량을 140송이로 수정합니다.'],
   ['download','다운로드·ETA 창 열기',down,'파일명이 표시된 다운로드 버튼을 누르면 ETA 입력 창이 열립니다.'],
   ['eta','ETA 날짜 입력','[aria-labelledby="pedidos-eta-title"] input[type="text"]','달력으로 날짜를 선택하거나 아래에 직접 입력합니다. 2026-11-16과 영문 요일을 확인합니다.'],
   ['save','ETA 저장·엑셀 다운로드','[aria-labelledby="pedidos-eta-title"] button[type="submit"]','ETA를 기본값으로 저장하고 엑셀을 내려받습니다. 전산 주문 수량은 바뀌지 않습니다.']];
  for(const [i,[scenario,label,selector,description]] of steps.entries()){
    await page.waitForSelector(selector,{visible:true});
    if(i===3) {await page.waitForFunction(()=>document.querySelector('.pedidos-auto-actions button')?.textContent.includes('.xlsx')); assert.deepEqual(details,[week.orderWeek]);}
    if(i===2)assert.equal(details.length,0);
    const title=(i+1)+'. '+label;
    await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));
    rec.chapter(scenario,title);await rec.caption(title+' · '+description);await rec.pause(2300);await rec.focus(selector,i+1);
    await page.focus(selector);
    if(scenario==='review'||scenario==='eta'){await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(scenario==='eta'?'2026-11-16':'140',{delay:150});await page.keyboard.press('Tab');assert.equal(await page.$eval(selector,n=>n.value),scenario==='eta'?'2026-11-16':'140');if(scenario==='eta')assert((await page.$eval('[aria-labelledby="pedidos-eta-title"]',n=>n.textContent)).includes('ETA (2026-11-16 Monday)'));}else await page.keyboard.press('Enter');
    if(scenario==='week') await selectThenOpen(i+1);
    await rec.pause(2800);await rec.unfocus();
  }
  let filename;
  for(let n=0;n<50&&!filename;n++){filename=fs.readdirSync(downloadDir).find(f=>f.endsWith('.xlsx'));if(!filename)await new Promise(r=>setTimeout(r,100));}
  assert(filename,'browser saved XLSX');const XLSX=require('xlsx'),wb=XLSX.readFile(path.join(downloadDir,filename));assert(Object.values(wb.Sheets[wb.SheetNames[0]]).some(c=>c?.v===140));
  assert(wb.Sheets[wb.SheetNames[0]].A1.v.endsWith('Semana 46-01차 ETA (2026-11-16 Monday)'));
  await page.click(down);await page.waitForSelector('[aria-labelledby="pedidos-eta-title"]');
  assert.equal(await page.$eval('[aria-labelledby="pedidos-eta-title"] input[type="date"]',n=>n.value),'2026-11-16');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[aria-labelledby="pedidos-eta-title"]'));
  await page.click('.pedidos-preview-heading button');
  const chinaIndex=await page.evaluate(()=>[...document.querySelectorAll('[aria-label="국가"] button')].findIndex(button=>button.textContent.includes('중국'))+1);
  const farmSteps=[
   ['china','중국 발주 조회','[aria-label="국가"] button:nth-child('+chinaIndex+')','중국을 선택하고 차수와 세부차수를 다시 선택합니다.'],
   ['china-cycle','중국 차수 선택',cycle,'2026년 46차를 선택합니다.'],
   ['china-week','중국 세부차수와 미리보기',sub,'46-01차의 주문을 조회하고 매칭데이터 미리보기 열기를 누릅니다.'],
   ['farm','기본 수신명 수정','.pedidos-farms input[type="text"]','기본값 Melody는 유지됩니다. 이번에는 HUBFRESH로 바꿉니다. 농장명을 검색하거나 직접 입력할 수 있습니다.'],
   ['split','농장별 파일 나누기','.pedidos-split-toggle input','나누기를 켜면 농장 1에 체크한 품목과 미선택 품목의 파일이 나뉩니다. 기본 상태에서는 나누지 않습니다.'],
   ['assign','농장 1 품목 선택','.pedidos-matrix input[aria-label="ROSE / 연습 화이트 50cm 농장 1 HUBFRESH"]','화이트 품목을 농장 1로 선택합니다. 체크한 품목 전체 업체 수량은 HUBFRESH, 나머지는 CLOUD 파일에 들어갑니다.'],
   ['farm-download','농장별 파일 확인',down,'두 농장 파일이 따로 나타납니다. HUBFRESH 파일을 열어 ETA를 확인합니다.'],
   ['farm-save','농장 파일 다운로드','[aria-labelledby="pedidos-eta-title"] button[type="submit"]','확인한 ETA로 다운로드합니다. 첫 시트는 업체별 발주표이며 뒤쪽에 기존 국가 양식도 보존됩니다.']];
  for(const [offset,[scenario,label,selector,description]] of farmSteps.entries()){
    await page.waitForSelector(selector,{visible:true});
    await page.$eval(selector,node=>node.scrollIntoView({block:'center'}));
    const number=steps.length+offset+1;rec.chapter(scenario,number+'. '+label);await rec.caption(number+'. '+label+' · '+description);await rec.pause(2300);await rec.focus(selector,number);
    await page.focus(selector);
    if(scenario==='farm'){assert.deepEqual(await page.$$eval('.pedidos-farms input[type="text"]',nodes=>nodes.map(node=>node.value)),['Melody','CLOUD']);await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('HUBFRESH',{delay:150});await page.keyboard.press('Tab');}
    else await page.keyboard.press(['assign','split'].includes(scenario)?'Space':'Enter');
    if(scenario==='china-week') await selectThenOpen(number);
    if(scenario==='assign')await page.waitForFunction(()=>document.querySelectorAll('.pedidos-auto-actions button').length>=3&&document.querySelector('.pedidos-auto-actions').textContent.includes('HUBFRESH')&&document.querySelector('.pedidos-auto-actions').textContent.includes('CLOUD'));
    await rec.pause(2800);await rec.unfocus();
  }
  let farmFile;for(let n=0;n<50&&!farmFile;n++){farmFile=fs.readdirSync(downloadDir).find(name=>name.includes('HUBFRESH')&&name.endsWith('.xlsx'));if(!farmFile)await new Promise(resolve=>setTimeout(resolve,100));}
  assert(farmFile,'farm download saved');const farmWb=XLSX.readFile(path.join(downloadDir,farmFile));assert.equal(farmWb.SheetNames[0],'업체별 발주');assert.equal(farmWb.Sheets['업체별 발주'].C5.v,15);
  await page.click('.pedidos-preview-heading button');
  const source = id => '.kakao-order-message[data-source-id="'+id+'"]';
  const sourceFilter = index => '.kakao-source-controls button:nth-child('+index+')';
  const sourceSearch = 'input[aria-label="카톡 원문 검색"]';
  const parsed='.kakao-parsed';
  const editor=parsed+' fieldset';
  const detailClose=parsed+' .kakao-details-header button';
  const firstQuantity='.kakao-table [data-total-item] .kakao-quantity';
  assert(await page.$eval(source('0')+' pre',node=>node.textContent.includes('\nMoon Light 1박스')));
  assert.equal(await page.$('.kakao-originals fieldset'),null);
  for(const [n,id,label,selector,caption,key] of [
    [16,'chat','오른쪽 카톡 추가·취소 원문 확인',sourceFilter(3),'발주가 있는 최근 2일을 자동으로 찾습니다. 오른쪽에서 취소 원문을 보고 방·시각·내용으로 검색하세요. 취소 수량은 확인 전 합산하지 않습니다.','Enter'],
    [17,'sum','차수·품목군 버튼 선택','.kakao-choices[aria-label="품목군"] button:last-child','차수와 국가·품목군별로 모인 합계에서 Moon Light 4박스와 업체별 수량을 확인합니다.',null],
    [18,'match-total','합계에서 근거 원문 확인','.kakao-match-total','가운데 품종을 누르면 합계에 포함된 원문별 수량이 나타납니다. 오른쪽과 같은 원문 번호와 강조색을 확인하세요.','Enter'],
    [19,'match-source','카톡 원문과 품목·수량 대조','.kakao-match-source','오른쪽 품목·수량 보기를 누르면 같은 원문 번호의 품목별 수량과 반영 상태가 가운데에 나타납니다. 아래 전체 합계에는 다른 원문 수량도 포함됩니다.','Enter'],
    [20,'audit','제외 원문 대조','.kakao-audit > summary','분류 건수를 대조하고 제외 원문을 검색해 놓친 발주를 확인합니다. 카톡 자체 수집 누락과 사진은 별도 원본 대조가 필요합니다.','Enter'],
    [21,'recover','누락 의심 발주 보완','[data-audit-id="missed"] > button','원문에서 두 박스를 확인한 뒤 품종·차수·수량·단위를 보완하고 합산을 체크합니다.','Enter'],
    [22,'copy','농장 전달용 복사','.kakao-additions .kakao-table + button','합계와 비고를 복사해 농장에 전달합니다.','Enter']
  ]){
    if(id==='copy')await page.click('.kakao-choices[aria-label="품목군"] button:last-child');
    await page.waitForSelector(selector,{visible:true});
    await page.$eval(selector,b=>b.scrollIntoView({block:'center'}));
    rec.chapter(id,n+'. '+label);await rec.caption(n+'. '+label+' · '+caption);await rec.pause(2300);await rec.focus(selector,n);
    if(id==='sum') { await page.focus('.kakao-choices[aria-label="차수"] button:last-child');await page.keyboard.press('Enter');await page.focus(selector);await page.keyboard.press('Enter'); }
    if(key){await page.focus(selector);await page.keyboard.press(key);}
    if(id==='chat'){
      assert.equal(await page.$$eval('.kakao-order-message',nodes=>nodes.length),1);
      assert(await page.$eval(source('cancel')+' pre',node=>node.textContent.includes('\n별도품종 1박스')));
      await rec.unfocus();await rec.focus(sourceSearch,n);
      await page.focus(sourceSearch);await page.keyboard.type('별도품종',{delay:dry?0:100});
      assert.equal(await page.$$eval('.kakao-order-message',nodes=>nodes.length),1);
      await page.$eval(sourceSearch,el=>el.select());await page.keyboard.type('없는 주문');
      assert.equal(await page.$('.kakao-order-message'),null);
      await page.$eval(sourceSearch,el=>el.select());await page.keyboard.press('Backspace');
      await page.click(sourceFilter(2));
      assert(await page.$$eval('.kakao-order-message',nodes=>nodes.every(node=>node.dataset.sourceKind==='addition')));
      await page.click(sourceFilter(1));
    }
    if(id==='audit'){await page.waitForSelector('[data-audit-id="missed"]');await page.click('[data-audit-id="missed"] > summary');}
    if(id==='recover'){
      const recovered=editor;
      await page.waitForSelector(recovered);await page.$eval(recovered,n=>n.scrollIntoView({block:'center'}));await rec.unfocus();await rec.focus(recovered,n);
      const inputs=await page.$$(recovered+' > label input');
      for(const [i,value] of ['콜롬비아','수국','46-01','연습화이트','2','박스',''].entries()){await inputs[i].focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(value,{delay:dry?0:90});}
      assert.equal(await page.$eval(recovered+' input[type="checkbox"]',n=>n.checked),false);await page.focus(recovered+' input[type="checkbox"]');await page.keyboard.press('Space');
      assert((await page.$eval('.kakao-table',n=>n.textContent)).includes('연습화이트'));console.log('PASS manual recovered order edit and include');
    }
    await rec.pause(2800);await rec.unfocus();
    if(id==='match-source'||id==='recover')await page.click(detailClose);
  }
  assert((await page.$eval('.kakao-table',el=>el.textContent)).includes('주광 1, 미우 2, 일신 1'));
  await page.focus('.kakao-audit > summary');await page.keyboard.press('Enter');await page.waitForNetworkIdle();
  assert.equal(await page.$$eval('.kakao-order-message[data-source-kind="addition"]',nodes=>nodes.length),3);
  assert(!(await page.$eval('.kakao-additions',n=>n.textContent)).includes('이번에 온 3박스'));
  assert((await page.$eval('.kakao-counts',n=>n.textContent)).includes('중복 제외 1건'));
  assert.equal(await page.$('.kakao-additions input[type="date"]'),null);
  await page.click(source('0')+' .kakao-match-source');
  assert(await page.$eval(parsed+' h5',node=>node.textContent.includes('원문 0')));
  await page.click(parsed+' .kakao-edit-line');
  await page.click('.kakao-refresh');
  await page.waitForNetworkIdle();
  assert(await page.$eval(editor+' input[type="checkbox"]',node=>node.checked));
  assert((await page.$eval('.kakao-table',node=>node.textContent)).includes('주광 1, 미우 2, 일신 1'));

  assert.equal(await page.$eval(firstQuantity,n=>n.textContent),'4 박스');
  assert.equal(await page.$eval(parsed+' [data-parsed-item] .kakao-quantity',n=>n.textContent),'1 박스');
  await page.click(editor+' input[type="checkbox"]');
  assert.equal(await page.$(firstQuantity),null);
  await page.click('.kakao-refresh');await page.waitForNetworkIdle();
  assert.equal(await page.$eval(editor+' input[type="checkbox"]',n=>n.checked),false);
  await page.click(detailClose);
  assert.equal(await page.$eval(firstQuantity,n=>n.textContent),'3 박스');
  console.log('PASS initial automatic total4, customer remarks, manual exclusion3 preserved after refresh');
  const layout=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect();return {ratio:box('.pedidos-primary').width/box('.pedidos-split').width,left:box('.pedidos-primary').x,center:box('.kakao-totals').x,right:box('.kakao-originals').x};});
  assert(layout.ratio>.23&&layout.ratio<.26);assert(layout.left<layout.center&&layout.center<layout.right);
  await page.click('.kakao-match-total');assert.equal(await page.$$eval('.kakao-order-message',n=>n.length),2);
  assert.deepEqual(await page.$$eval('.kakao-contributions .kakao-quantity',nodes=>nodes.map(n=>n.textContent).sort()),['1 박스','2 박스']);
  assert.deepEqual(await page.$$eval('.kakao-contributions li button',nodes=>nodes.map(n=>n.textContent).sort()),await page.$$eval('.kakao-order-message.kakao-linked .kakao-source-meta strong',nodes=>nodes.map(n=>n.textContent).sort()));
  assert.equal(await page.$$eval('.kakao-order-message pre',n=>n.filter(node=>node.getBoundingClientRect().height>0).length),2);
  await page.click('.kakao-match-source');assert.equal(await page.$$eval('.kakao-table [data-total-item]',n=>n.length),1);
  assert(await page.evaluate(()=>document.querySelector('.kakao-parsed').classList.contains('kakao-linked')&&document.querySelector('.kakao-order-message.kakao-linked')&&document.querySelector('.kakao-parsed h5').textContent.startsWith(document.querySelector('.kakao-order-message.kakao-linked strong').textContent)));
  await page.click(detailClose);
  await page.click('.kakao-audit > summary');await page.waitForNetworkIdle();
  assert((await page.$eval('.kakao-audit',n=>n.textContent)).includes('분류 건수 일치'));
  assert((await page.$eval('.kakao-audit',n=>n.textContent)).includes('카톡방 전체의 수집 누락 여부는 확인되지 않았습니다'));
  await page.click('.kakao-audit > summary');await page.waitForNetworkIdle();
  console.log('PASS 25percent layout, week/category buttons, bidirectional contributors and opt-in omission audit');
  rec.chapter('download-history','23. 이전 다운로드와 수량 비교');
  await rec.caption('23. 이전 다운로드와 수량 비교 · 저장된 이전본을 선택하거나 기존 파일을 열어 현재 발주 수량을 대조합니다.');
  await rec.pause(1400);await rec.focus(openPreview,23);await page.click(openPreview);await rec.unfocus();
  const comparison='.pedidos-result:first-of-type .pedidos-download-comparison';
  await page.waitForSelector(comparison,{visible:true});
  assert((await page.$eval(comparison,node=>node.textContent)).includes('보관된 다운로드가 없습니다'));
  await page.$eval(comparison+' button',el=>el.scrollIntoView({block:'center'}));
  await rec.focus(comparison+' button',23);await page.click(comparison+' button');await rec.unfocus();
  const previousFile=await page.$(comparison+' input[type="file"]');
  await previousFile.uploadFile(path.join(downloadDir,farmFile));
  await page.click(comparison+' .pedidos-fields button');
  await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('파일 불러옴'),{},comparison);
  const compareEdit='.pedidos-review-input[aria-label*="화이트"]';
  await page.$eval(compareEdit,el=>el.scrollIntoView({block:'center'}));
  await rec.focus(compareEdit,23);await page.focus(compareEdit);
  await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');
  await page.keyboard.type('35',{delay:150});await rec.unfocus();
  await page.waitForSelector(comparison+' table[aria-label="이전과 현재 수량 차이"]',{visible:true});
  assert((await page.$eval(comparison,el=>el.textContent)).includes('35'));
  await page.$eval(comparison,el=>el.scrollIntoView({block:'center'}));
  await rec.focus(comparison,23,{anchorLeft:true});await rec.pause(2100);await rec.unfocus();
  await page.click('.pedidos-preview-heading button');
  const result=await rec.stop();stopped=true;
  await page.click('.kakao-choices[aria-label="품목군"] button');
  await page.click(sourceFilter(3));
  await page.click(source('cancel')+' .kakao-match-source');
  assert.equal(await page.$(editor+' input[type="checkbox"]'),null);
  assert(await page.$eval(parsed,n=>n.textContent.includes('취소 · 합계 제외')));
  assert((await page.$eval(source('cancel')+' pre',n=>n.textContent)).includes('취소'));
  await page.click(sourceFilter(1));
  console.log('PASS raw classification, group filter, noise/duplicate exclusion and cancellation review UI');
  await page.click(source('missed')+' .kakao-match-source');await page.click(parsed+' .kakao-edit-line');
  const manualCheck=editor+' input[type="checkbox"]';
  assert.equal(await page.$eval(manualCheck,n=>n.checked),true);await page.click(manualCheck);
  console.log('PASS recovered review survives closing audit and refresh');
  // A previously explicit inclusion must not survive a newly collected cancellation.
  await page.click(source('0')+' .kakao-match-source');await page.click(parsed+' .kakao-edit-line');await page.click(editor+' input[type="checkbox"]');
  Object.assign(sampleFeed,classifyImportFeed({from:'2026-11-17',to:'2026-11-18',messages:[...sampleMessages,sampleMessage('new-cancel','46-1 콜 카네이션 발주 취소\nMoon Light 1박스')]}));
  await page.click('.kakao-refresh');await page.waitForNetworkIdle();
  assert(!(await page.$eval('.kakao-table',n=>n.textContent)).includes('Moon Light'));
  await page.click(source('0')+' .kakao-match-source');await page.click(parsed+' .kakao-edit-line');
  assert.equal(await page.$eval(editor+' input[type="checkbox"]',node=>node.checked),false);
  await page.click(detailClose);
  console.log('PASS live refresh invalidates prior inclusion when a related cancellation arrives');
  if(!dry){workflow.guides[0].chapters=result.chapters;workflow.guides[0].status='ready';fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');}
  if(dry){
    const multi=sampleMessage('multi', '47-2 네덜란드 튤립 발주 추가\n'+Array.from({length:20},(_,i)=>`연습 품종 ${String.fromCharCode(65+i)} ${i+1}송이`).join('\n'));
    Object.assign(sampleFeed,classifyImportFeed({messages:[multi,sampleMessage('same','47-2 네덜란드 튤립 발주 추가\n연습 품종 A 9송이'),sampleMessage('another','46-1 콜 수국 발주 추가\n연습 품종 A 300박스')]}));
    await page.click('.kakao-refresh');await page.waitForNetworkIdle();
    await page.click(source('multi')+' .kakao-match-source');
    assert.equal(await page.$$eval(parsed+' [data-parsed-item]',nodes=>nodes.length),20);
    assert.equal(await page.$eval(parsed+' [data-parsed-item] .kakao-quantity',n=>n.textContent),'1 송이');
    assert.equal(await page.$eval(firstQuantity,n=>n.textContent),'10 송이');
    await page.click('.kakao-choices[aria-label="차수"] button:last-child');
    assert.equal(await page.$$eval(parsed+' [data-parsed-item]',nodes=>nodes.length),20);
    assert(await page.$eval(source('multi'),n=>n.classList.contains('kakao-linked')));
    await page.click(detailClose);
    await page.click('.kakao-choices[aria-label="차수"] button:first-of-type');
    console.log('PASS 20 exact extracted rows remain linked across scope filters; 1 from original vs 10 overall');
    await page.setViewport({width:1572,height:900});
    assert(await page.evaluate(()=>document.querySelector('.kakao-totals').getBoundingClientRect().x<document.querySelector('.kakao-originals').getBoundingClientRect().x));
    await page.evaluate(() => { window.open = window.__orderGuideOpen; delete window.__orderGuideOpen; });
    const openPopup = async() => {
      const created = new Promise(resolve=>page.once('popup',resolve));
      await page.click(openPreview);
      return created;
    };
    const popup = await openPopup();
    await popup.waitForSelector('.pedidos-work-preview .pedidos-matrix',{visible:true});
    assert(await popup.$eval('.pedidos-matrix',matrix=>matrix.getBoundingClientRect().width>innerWidth*.85));
    await popup.focus('.pedidos-review-input');
    await popup.keyboard.down('Control');await popup.keyboard.press('a');await popup.keyboard.up('Control');await popup.keyboard.type('35');
    await popup.click('.pedidos-preview-heading button');
    const reopened = await openPopup();
    await reopened.evaluate(()=>{ window.showSaveFilePicker=undefined; });
    await reopened.waitForSelector('.pedidos-review-input',{visible:true});
    assert.equal(await reopened.$eval('.pedidos-review-input',input=>input.value),'35');
    const popupDownload = path.join(downloadDir,'popup');
    fs.mkdirSync(popupDownload);
    const childSession=await reopened.createCDPSession();
    await childSession.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:popupDownload});
    await reopened.click(down);
    await reopened.waitForSelector('[aria-labelledby="pedidos-eta-title"] button[type="submit"]');
    await reopened.$eval('[aria-labelledby="pedidos-eta-title"] input[type="text"]',input=>input.select());
    await reopened.keyboard.type('2026-11-22');
    await reopened.click('[aria-labelledby="pedidos-eta-title"] button[type="submit"]');
    await reopened.waitForFunction(()=>!document.querySelector('[aria-labelledby="pedidos-eta-title"]'));
    let newFile;
    for(let n=0;n<50&&!newFile;n++){
      newFile=fs.readdirSync(popupDownload).find(file=>file.endsWith('.xlsx'));
      if(!newFile) await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(newFile,'popup saved XLSX');
    const fromPopup=XLSX.readFile(path.join(popupDownload,newFile));
    assert(fromPopup.Sheets[fromPopup.SheetNames[0]].A1.v.includes('2026-11-22 Sunday'));
    await reopened.click('.pedidos-preview-heading button');
    await page.waitForSelector('.pedidos-primary button[aria-pressed="true"]');
    console.log('PASS native popup editing/reopen/download, 1572px three panels and close');
    const extraGroups=['수선화','튤립','히야신스','안시리움','장미','카라','거베라','루스커스'];
    Object.assign(sampleFeed, classifyImportFeed({from:'2026-11-17',to:'2026-11-18',
      messages:extraGroups.map((name,index)=>sampleMessage('extra-'+index,'46-1 네덜란드 '+name+' 발주 추가\n연습품종 12송이'))}));
    await page.click('.kakao-refresh');await page.waitForNetworkIdle();
    const group='.kakao-choices[aria-label="품목군"]';
    assert.equal(await page.$$eval(group+' button[aria-pressed]',nodes=>nodes.length),6);
    await page.click(group+' .kakao-more');
    assert(await page.$$eval(group+' button[aria-pressed]',nodes=>nodes.length)>=extraGroups.length+1);
    await page.click(group+' button[aria-pressed]:nth-last-child(2)');
    const picked=await page.$eval(group+' button[aria-pressed="true"]',node=>node.textContent);
    await page.click(group+' .kakao-more');
    assert.equal(await page.$eval(group+' button[aria-pressed="true"]',node=>node.textContent),picked);
    await page.click(group+' button[aria-pressed]:first-of-type');
    assert.equal(await page.$eval('.kakao-quantity',node=>getComputedStyle(node).whiteSpace),'nowrap');
    console.log('PASS compact filters retain hidden selection and quantities never wrap');
    await page.evaluate(title=>{const heading=[...document.querySelectorAll('h3')].find(node=>node.textContent===title);if(!heading)throw Error('Guide heading missing');heading.closest('details').id='country-order-guide-test';},workflow.title);
    await page.focus('#country-order-guide-test > summary');await page.keyboard.press('Enter');
    await page.$eval('#country-order-guide-test video',video=>{video.muted=true;return video.play();});
    await page.waitForFunction(()=>document.querySelector('#country-order-guide-test video').currentTime>.3);
    const chapters=await page.$$('#country-order-guide-test nav button');assert.equal(chapters.length,workflow.guides[0].chapters.length);
    await chapters[5].focus();await page.keyboard.press('Enter');
    assert(await page.$eval('#country-order-guide-test video',video=>video.currentTime>50));
    await page.$eval('#country-order-guide-test video',video=>{video.textTracks[0].mode='showing';});
    await page.waitForFunction(()=>document.querySelector('#country-order-guide-test video track').readyState===2);
    assert(await page.$eval('#country-order-guide-test video',video=>video.textTracks[0].language==='ko'));
    await page.setViewport({width:390,height:844});
    assert(await page.$eval('.kakao-additions',node=>{const r=node.getBoundingClientRect();return r.width<=innerWidth&&r.left>=0&&r.right<=innerWidth+1;}));
    assert(await page.$eval('#country-order-guide-test video',video=>{const rect=video.getBoundingClientRect();return rect.width<=innerWidth;}));
    console.log('PASS actual guide player MP4 playback, registered chapters, Korean captions, keyboard and 390px');
    await page.setViewport({width:1572,height:900});
    await page.reload({waitUntil:'networkidle0'});
    await page.evaluate(()=>{window.open=()=>null;window.showSaveFilePicker=undefined;});
    await page.click('[aria-controls="import-panel-orders"]');
    const china='[aria-label="국가"] button:nth-child('+chinaIndex+')';
    await page.waitForSelector(china,{visible:true});await page.click(china);
    await page.waitForSelector(cycle,{visible:true});await page.click(cycle);
    await page.waitForSelector(sub,{visible:true});await page.click(sub);
    await page.waitForSelector(openPreview+':enabled',{visible:true});await page.click(openPreview);
    await page.waitForSelector('.pedidos-farms input[type="text"]',{visible:true});
    await page.focus('.pedidos-farms input[type="text"]');
    await page.$eval('.pedidos-farms input[type="text"]',input=>input.select());
    await page.keyboard.type('HUBFRESH');
    await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('파일 불러옴'),{},comparison);
    console.log('PASS prior workbook comparison retained through page reload');
    await page.evaluate(()=>{window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})});});
    await page.click(down);await page.waitForSelector('[aria-labelledby="pedidos-eta-title"] button[type="submit"]');
    await page.click('[aria-labelledby="pedidos-eta-title"] button[type="submit"]');
    await page.waitForFunction(selector=>document.querySelector(selector+' select')?.options.length===2,{},comparison);
    await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('cancelled','AbortError');};});
    await page.click(down);await page.waitForSelector('[aria-labelledby="pedidos-eta-title"] button[type="submit"]');
    await page.click('[aria-labelledby="pedidos-eta-title"] button[type="submit"]');
    await page.waitForSelector('[aria-labelledby="pedidos-eta-title"] button[type="submit"]:enabled');
    assert.equal(await page.$eval(comparison+' select',select=>select.options.length),2);
    await page.keyboard.press('Escape');await page.click('.pedidos-preview-heading button');
    console.log('PASS confirmed save appends and cancelled save preserves earlier history');
  }
  console.log('PASS keyboard country/cycle/subweek, ETA manual/date sync, stored default, Escape, browser download, XLSX quantity140/title');
 }finally{await browser?.close();if(server.pid && server.exitCode===null) require('node:child_process').spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
