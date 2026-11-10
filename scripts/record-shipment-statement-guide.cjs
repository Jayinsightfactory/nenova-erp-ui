// Actual local page; all API calls intercepted with synthetic data, no ERP connection.
const fs=require('node:fs'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const core=require('../lib/shipmentStatement.cjs'),{exportWorkbook}=require('../lib/shipmentStatementWorkbook.cjs');
const {createNumberedStatementGuide}=require('./lib/shipment-statement-numbered-guide.cjs');
async function main(){
 const base=process.env.GUIDE_BASE||'http://127.0.0.1:39461',record=process.argv.includes('--record');
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 let rec,page;try{
  page=await browser.newPage();page.setDefaultTimeout(30000);await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s={year:'2026',week:45,custKey:777};const raw=[{ProdKey:1,ProdName:'문라이트',FlowerName:'장미',OutQuantity:3},{ProdKey:2,ProdName:'화이트 수국',FlowerName:'수국',OutQuantity:2},{ProdKey:3,ProdName:'핑크 장미',FlowerName:'장미',OutQuantity:4}].map((r,i)=>({...r,OrderYear:'2026',OrderWeek:i===2?'45-03':'45-01',CustKey:777,SdetailKey:100+i,Cost:12000+i*1000,OutUnit:'단',CounName:'콜롬비아'}));
  const source={scope:s,customer:{custKey:777,name:'연습업체',manager:'연습지원',baseDay:'일'},rows:core.sourceRows(raw,s),calendar:core.calendar(Array.from({length:7},(_,i)=>({WeekDay:new Date(Date.UTC(2026,10,4+i)).getUTCDay()+1,Date:new Date(Date.UTC(2026,10,4+i)).toISOString().slice(0,10)})))};
  let saved=null,saveCalls=0,downloads=0,sourceChanged=false,favoriteOwner='support',favoriteWrites=0,favoriteFailure=false;const favoritesByActor=new Map();const customers=[{CustKey:777,CustName:'연습업체',Manager:'연습지원',DetailCount:3},{CustKey:778,CustName:'가나다상사',Manager:'연습지원',DetailCount:1},{CustKey:779,CustName:'다른담당업체',Manager:'다른담당',DetailCount:1}];await page.setRequestInterception(true);
  page.on('request',async req=>{const u=new URL(req.url());if(u.origin!==base)return req.abort();if(!u.pathname.startsWith('/api/'))return req.continue();
   let d={success:true,data:[],items:[],favorites:[]};
   if(u.pathname==='/api/auth/me')d.user={userId:favoriteOwner,userName:'연습지원',authority:2,deptName:'영업지원'};
   if(u.pathname==='/api/favorites'&&u.searchParams.get('page')==='shipment-statement-customers'){
    const current=favoritesByActor.get(favoriteOwner)??[];
    if(req.method()==='GET')d.favorites=current;
    else{favoriteWrites++;if(favoriteFailure)return req.respond({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'연습용 즐겨찾기 저장 실패'})});
     const body=JSON.parse(req.postData());if(req.method()==='POST'){assert.equal(body.page,'shipment-statement-customers');const row={FavoriteKey:1000+favoriteWrites,FilterData:body.filterData,FavName:body.name};favoritesByActor.set(favoriteOwner,[...current,row]);d.favoriteKey=row.FavoriteKey;}
     else if(req.method()==='DELETE')favoritesByActor.set(favoriteOwner,current.filter(r=>r.FavoriteKey!==body.favoriteKey));
    }
   }
   if(u.pathname==='/api/shipment/statement'){
    assert.equal(u.searchParams.get('year'),'2026');assert([45,46].includes(Number(u.searchParams.get('week'))));
    if(req.method()==='POST'){saveCalls++;const b=JSON.parse(req.postData());core.validatePlan(source.rows,b.draft);saved={source,draft:b.draft,version:(saved?.version??0)+1,sourceHash:'fixture',updatedAt:new Date().toISOString()};d={success:true,saved};}
    else if(u.searchParams.get('action')==='download'){downloads++;return req.respond({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:exportWorkbook(saved)});}
    else if(u.searchParams.get('custKey'))d={success:true,source,sourceHash:'fixture',version:saved?.version??0,saved,stale:sourceChanged,draft:saved?.draft??{defaultDay:'일',groups:[],entries:{}}};
    else d.customers=u.searchParams.get('week')==='45'?customers:[];
   }
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
  });
  await page.goto(base+'/shipment/statement',{waitUntil:'networkidle0',timeout:120000});
  assert.equal(await page.$$eval('[data-ui-shell]',n=>n.length),1);assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),1);
  const actClick=async selector=>{if(rec)await rec.focus(selector);const target=await page.$(selector);assert(target,'missing '+selector);await target.click();if(rec)await rec.out();};
  const click=async text=>actClick(`button::-p-text(${text})`);
  const input=async(label,value)=>{const selector=`[aria-label="${label}"]`;if(rec)await rec.focus(selector);const el=await page.$(selector);await el.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await el.press('Backspace');await el.type(String(value));if(rec)await rec.out();};
  const selectValue=async(selector,value)=>{if(rec)await rec.focus(selector);await page.select(selector,value);if(rec)await rec.out();};
  await input('연도','2026');await input('메인차수','45');
  rec=record?await createNumberedStatementGuide(page,{workflowId:'shipment-statement',guideId:'support',title:'출고내역서 작성',sourceFiles:['pages/shipment/statement.js','styles/ShipmentStatement.module.css','lib/shipmentStatement.cjs','components/ShipmentStatementSelectors.js','lib/shipmentStatementSelection.cjs','components/ShipmentStatementGroups.js','lib/shipmentStatementGroups.cjs'],fixtureOnly:true}):null;
  const say=async(text,ms=4200)=>{if(rec){await rec.caption(text);await rec.pause(ms);}};
  await rec?.chapter('load','차수·담당자·업체 버튼과 개인 즐겨찾기');await say('메인차수는 앞뒤 2차까지 버튼으로 표시됩니다.\n차수 버튼을 누르면 해당 차수 전체 분배값을 바로 불러옵니다.');
  assert.deepEqual(await page.$$eval('[aria-label="메인차수 선택"] button',n=>n.map(x=>x.textContent)),['43차','44차','45차','46차','47차']);
  await actClick('[aria-label="45차 선택"]');await page.waitForSelector('[aria-label="연습지원 담당자 선택"]');await actClick('[aria-label="연습지원 담당자 선택"]');assert.equal(await page.$$eval('[data-customer-key]',n=>n.length),2);
  await page.waitForFunction(()=>!document.querySelector('[aria-label="연습업체 즐겨찾기 추가"]').disabled);await actClick('[aria-label="연습업체 즐겨찾기 추가"]');await page.waitForSelector('[aria-label="연습업체 즐겨찾기 해제"]');assert.equal(await page.$eval('[data-customer-key]',n=>n.getAttribute('data-customer-key')),'777');assert.equal(saveCalls,0);
  await say('담당자 버튼을 누르면 해당 담당자의 업체만 보입니다.\n업체의 별표를 누르면 즐겨찾기로 저장되어 먼저 표시됩니다.');
  await actClick('[aria-label="연습업체 업체 선택"]');await page.waitForSelector('tbody tr');
  await rec?.chapter('allocate','요일 수량과 기본 출고요일');await input('문라이트 수요일 수량',1);await input('문라이트 토요일 수량',1);assert.equal(await page.$eval('[aria-label="문라이트 일요일 수량"]',n=>n.value),'1');await say('문라이트 3개 중 수요일 1개, 토요일 1개를 입력하면\n남은 1개는 기본 출고요일인 일요일에 자동 배정됩니다.');
  await selectValue('[aria-label="기본 출고요일"]','월');await page.waitForSelector('dialog[open]');await say('기본 출고요일은 변경할 수 있습니다.\n직접 입력한 수·토 수량은 유지하고 잔량만 월요일로 옮깁니다.');await click('변경 적용');assert.equal(await page.$eval('[aria-label="문라이트 월요일 수량"]',n=>n.value),'1');
  await rec?.chapter('drag','드래그 선택과 일괄 출고일 지정');if(rec)await rec.focus('tbody tr:first-child td:nth-child(3)');const products=await page.$$('tbody tr td:nth-child(3)'),a=await products[0].boundingBox(),b=await products[1].boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:14});await page.mouse.up();assert.equal(await page.$$eval('tbody tr[aria-selected="true"]',n=>n.length),2);if(rec)await rec.out();
  await selectValue('[aria-label="일괄 출고요일"]','금');await click('선택 품목 출고일 일괄 지정');await page.waitForSelector('dialog[open]');await say('품목명을 드래그하면 여러 품목을 선택할 수 있습니다.\n일괄 지정은 선택 품목의 전체수량을 지정 요일로 옮깁니다. 적용 전 변경표를 확인하세요.');await click('변경 적용');
  for(const r of source.rows.slice(0,2))assert.equal(await page.$eval(`[aria-label="${r.name} 금요일 수량"]`,n=>n.value),String(r.qty));
  // Keyboard equivalent, escape and return focus.
  await click('선택 품목 출고일 일괄 지정');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.match(await page.evaluate(()=>document.activeElement.textContent),/일괄 지정/);
  const checks=await page.$$('tbody input[type=checkbox]');await checks[0].focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),source.rows[1].name+' 선택');await page.keyboard.press('Space');
  await rec?.chapter('group','품목군 출력 묶음');await page.$eval('details:nth-of-type(1)',()=>{}).catch(()=>{});const summaries=await page.$$('summary');for(const h of summaries){if((await h.evaluate(n=>n.textContent)).includes('품목 묶음'))await h.click();}
  await actClick('[aria-label="콜롬비아 수국 묶음 선택"]');await actClick('[aria-label="콜롬비아 장미 묶음 선택"]');await input('새 묶음 이름','콜수국·콜장미');await click('선택한 품목군 묶기');assert.equal(saved,null);await say('함께 출력할 품목군을 체크하고 묶기 버튼을 누릅니다.\n이름은 자동으로 만들거나 직접 지정할 수 있습니다. 같은 묶음은 한 표에 출력됩니다.');
  await click('엑셀 미리보기');assert((await page.evaluate(()=>document.body.innerText)).includes('2026-11-06'));
  await rec?.chapter('save','작성본 저장과 엑셀 다운로드');await click('저장 및 엑셀 다운로드');await page.waitForFunction(()=>document.body.innerText.includes('엑셀 다운로드 완료'));assert.equal(saveCalls,1);assert.equal(downloads,1);assert.equal(saved.draft.groups.length,1);assert.equal(saved.draft.groups[0].categories.length,2);await say('저장 및 엑셀 다운로드를 누르면 작성내용이 서버에 보관됩니다.\n업체별 파일의 요일 탭에 품목·수량·단가와 자동 합계가 생성됩니다.',5500);
  await click('다시 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('v1'));await say('다시 불러오면 저장했던 배분과 품목 묶음이 복원됩니다.\nERP 실제 출고일과 재고·매출은 변경되지 않습니다.');
  fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/shipment-statement-desktop.png',fullPage:true});
  if(rec){const result=await rec.stop();rec=null;const f='config/workflow-guides.json',r=JSON.parse(fs.readFileSync(f));const g=r.workflows.find(w=>w.id==='shipment-statement').guides[0];g.status='ready';g.chapters=result.chapters;fs.writeFileSync(f,JSON.stringify(r,null,2)+'\n');}
  // Favorite failures never invent success or replay a write on retry.
  favoriteFailure=true;await actClick('[aria-label="연습업체 즐겨찾기 해제"]');await page.waitForSelector('button::-p-text(즐겨찾기 상태 다시 확인)');const priorWrites=favoriteWrites;favoriteFailure=false;await click('즐겨찾기 상태 다시 확인');await page.waitForFunction(()=>!document.querySelector('[aria-label="연습업체 즐겨찾기 해제"]').disabled);assert.equal(favoriteWrites,priorWrites);
  // A manager switch with dirty allocations must be explicitly confirmed.
  await input('문라이트 금요일 수량','2');page.once('dialog',d=>d.dismiss());await actClick('[aria-label="다른담당 담당자 선택"]');assert.equal(await page.$eval('[aria-label="연습지원 담당자 선택"]',n=>n.getAttribute('aria-pressed')),'true');assert.equal(await page.$eval('[aria-label="문라이트 금요일 수량"]',n=>n.value),'2');page.once('dialog',d=>d.accept());await click('다시 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('저장본 v1'));
  // Selection-only grouping: keyboard checkbox, move to existing, ungroup and automatic names.
  await actClick('[aria-label="콜롬비아 수국 묶음 선택"]');await click('선택한 품목군 묶음 해제');
  const groupCheckbox=await page.$('[aria-label="콜롬비아 수국 묶음 선택"]');await groupCheckbox.focus();await page.keyboard.press('Space');
  await selectValue('[aria-label="출력 묶음 선택"]','콜수국·콜장미');await click('선택한 품목군 묶기');
  await actClick('[aria-label="콜롬비아 수국 묶음 선택"]');await actClick('[aria-label="콜롬비아 장미 묶음 선택"]');await click('선택한 품목군 묶음 해제');
  await actClick('[aria-label="콜롬비아 수국 묶음 선택"]');await actClick('[aria-label="콜롬비아 장미 묶음 선택"]');await click('선택한 품목군 묶기');
  assert.equal(await page.$$eval('[aria-label="출력 묶음 선택"] option',n=>n.length),2);
  page.once('dialog',d=>d.accept());await click('다시 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('저장본 v1'));
  // Stale source cannot be saved; saved version remains downloadable.
  sourceChanged=true;await click('다시 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('저장 후 차수피벗 원본이 변경'));assert.equal(await page.$eval('button::-p-text(작성내용 저장)',n=>n.disabled),true);sourceChanged=false;
  await page.setViewport({width:390,height:844,deviceScaleFactor:1});await page.goto(base+'/shipment/statement?popup=1',{waitUntil:'networkidle0'});assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),0);assert.equal(await page.$$eval('[data-ui-popupbar]',n=>n.length),1);await actClick('[aria-label="45차 선택"]');await page.waitForSelector('[aria-label="연습지원 담당자 선택"]');await actClick('[aria-label="연습지원 담당자 선택"]');await page.waitForSelector('[aria-label="연습업체 즐겨찾기 해제"]');await actClick('[aria-label="연습업체 업체 선택"]');await page.waitForSelector('tbody tr');await page.click('summary::-p-text(품목 묶음 설정)');await page.waitForSelector('[aria-label="콜롬비아 수국 묶음 선택"]');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.screenshot({path:'.verify/shipment-statement-mobile.png',fullPage:true});
  await actClick('[aria-label="46차 선택"]');await page.waitForFunction(()=>document.querySelector('[aria-label="메인차수"]').value==='46'&&document.body.innerText.includes('해당 담당자의 분배 업체가 없어'));assert.equal(await page.$$eval('[data-customer-key]',n=>n.length),0);
  favoriteOwner='other';await page.reload({waitUntil:'networkidle0'});await actClick('[aria-label="45차 선택"]');await page.waitForSelector('[aria-label="연습업체 즐겨찾기 추가"]');assert.equal(await page.$$eval('[aria-label="업체 선택"] button[aria-pressed="true"]',n=>n.length),0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,record,dragRows:2,saveCalls,downloads,favoriteWrites,productionWrites:0,keyboard:true,desktop:true,mobile:true,accountIsolation:true,failedFavoriteGetRetry:true,dirtyManagerGuard:true,weekButtonAutoLoad:true,selectionGroups:true}));
 }catch(e){console.error('Original recording error:',e.stack);console.log('UI state:',await page?.evaluate(()=>document.body.innerText.slice(-3500)));await page?.screenshot({path:'.verify/statement-error.png',fullPage:true});throw e;}finally{if(rec)await rec.stop();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
