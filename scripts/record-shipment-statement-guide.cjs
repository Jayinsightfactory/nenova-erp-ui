// Actual local page; all API calls intercepted with synthetic data, no ERP connection.
const fs=require('node:fs'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const core=require('../lib/shipmentStatement.cjs'),{exportWorkbook}=require('../lib/shipmentStatementWorkbook.cjs');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
async function main(){
 const base=process.env.GUIDE_BASE||'http://127.0.0.1:39461',record=process.argv.includes('--record');
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 let rec,page;try{
  page=await browser.newPage();page.setDefaultTimeout(30000);await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s={year:'2026',week:45,custKey:777};const raw=[{ProdKey:1,ProdName:'문라이트',FlowerName:'장미',OutQuantity:3},{ProdKey:2,ProdName:'화이트 수국',FlowerName:'수국',OutQuantity:2},{ProdKey:3,ProdName:'핑크 장미',FlowerName:'장미',OutQuantity:4}].map((r,i)=>({...r,OrderYear:'2026',OrderWeek:i===2?'45-03':'45-01',CustKey:777,SdetailKey:100+i,Cost:12000+i*1000,OutUnit:'단',CounName:'콜롬비아'}));
  const source={scope:s,customer:{custKey:777,name:'연습업체',manager:'연습지원',baseDay:'일'},rows:core.sourceRows(raw,s),calendar:core.calendar(Array.from({length:7},(_,i)=>({WeekDay:new Date(Date.UTC(2026,10,4+i)).getUTCDay()+1,Date:new Date(Date.UTC(2026,10,4+i)).toISOString().slice(0,10)})))};
  let saved=null,saveCalls=0,downloads=0,sourceChanged=false;await page.setRequestInterception(true);
  page.on('request',async req=>{const u=new URL(req.url());if(u.origin!==base)return req.abort();if(!u.pathname.startsWith('/api/'))return req.continue();
   let d={success:true,data:[],items:[],favorites:[]};
   if(u.pathname==='/api/auth/me')d.user={userId:'guide-support',userName:'연습지원',authority:2,deptName:'영업지원'};
   if(u.pathname==='/api/shipment/statement'){
    assert.equal(u.searchParams.get('year'),'2026');assert.equal(u.searchParams.get('week'),'45');
    if(req.method()==='POST'){saveCalls++;const b=JSON.parse(req.postData());core.validatePlan(source.rows,b.draft);saved={source,draft:b.draft,version:(saved?.version??0)+1,sourceHash:'fixture',updatedAt:new Date().toISOString()};d={success:true,saved};}
    else if(u.searchParams.get('action')==='download'){downloads++;return req.respond({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:exportWorkbook(saved)});}
    else if(u.searchParams.get('custKey'))d={success:true,source,sourceHash:'fixture',version:saved?.version??0,saved,stale:sourceChanged,draft:saved?.draft??{defaultDay:'일',groups:[],entries:{}}};
    else d.customers=[{CustKey:777,CustName:'연습업체',Manager:'연습지원',DetailCount:3}];
   }
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
  });
  await page.goto(base+'/shipment/statement',{waitUntil:'networkidle0',timeout:120000});
  assert.equal(await page.$$eval('[data-ui-shell]',n=>n.length),1);assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),1);
  const click=async text=>{const target=await page.$(`button::-p-text(${text})`);assert(target,'missing '+text);await target.click();};
  const input=async(label,value)=>{const el=await page.$(`[aria-label="${label}"]`);await el.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await el.press('Backspace');await el.type(String(value));};
  await input('年도'.replace('年','연'),'2026');await input('메인차수','45');await click('차수 불러오기');await page.waitForFunction(()=>document.querySelector('[aria-label="업체"]').options.length>1);await page.select('[aria-label="담당자"]','연습지원');await page.select('[aria-label="업체"]','777');await page.waitForSelector('tbody tr');
  rec=record?await createWorkflowGuideRecorder(page,{workflowId:'shipment-statement',guideId:'support',title:'출고내역서 작성',sourceFiles:['pages/shipment/statement.js','styles/ShipmentStatement.module.css','lib/shipmentStatement.cjs'],fixtureOnly:true}):null;
  const say=async(text,ms=4200)=>{if(rec){await rec.caption(text);await rec.pause(ms);}};
  rec?.chapter('load','메인차수와 담당자·업체 선택');await say('연도와 메인차수를 불러온 뒤 담당자와 업체를 선택합니다.\n45-01부터 45-03까지 세부차수의 분배값이 함께 표시됩니다.');
  rec?.chapter('allocate','요일 수량과 기본 출고요일');await input('문라이트 수요일 수량',1);await input('문라이트 토요일 수량',1);assert.equal(await page.$eval('[aria-label="문라이트 일요일 수량"]',n=>n.value),'1');await say('문라이트 3개 중 수요일 1개, 토요일 1개를 입력하면\n남은 1개는 기본 출고요일인 일요일에 자동 배정됩니다.');
  await page.select('[aria-label="기본 출고요일"]','월');await page.waitForSelector('dialog[open]');await say('기본 출고요일은 변경할 수 있습니다.\n직접 입력한 수·토 수량은 유지하고 잔량만 월요일로 옮깁니다.');await click('변경 적용');assert.equal(await page.$eval('[aria-label="문라이트 월요일 수량"]',n=>n.value),'1');
  rec?.chapter('drag','드래그 선택과 일괄 출고일 지정');const products=await page.$$('tbody tr td:nth-child(3)'),a=await products[0].boundingBox(),b=await products[1].boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:14});await page.mouse.up();assert.equal(await page.$$eval('tbody tr[aria-selected="true"]',n=>n.length),2);
  await page.select('[aria-label="일괄 출고요일"]','금');await click('선택 품목 출고일 일괄 지정');await page.waitForSelector('dialog[open]');await say('품목명을 드래그하면 여러 품목을 선택할 수 있습니다.\n일괄 지정은 선택 품목의 전체수량을 지정 요일로 옮깁니다. 적용 전 변경표를 확인하세요.');await click('변경 적용');
  for(const r of source.rows.slice(0,2))assert.equal(await page.$eval(`[aria-label="${r.name} 금요일 수량"]`,n=>n.value),String(r.qty));
  // Keyboard equivalent, escape and return focus.
  await click('선택 품목 출고일 일괄 지정');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.match(await page.evaluate(()=>document.activeElement.textContent),/일괄 지정/);
  const checks=await page.$$('tbody input[type=checkbox]');await checks[0].focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),source.rows[1].name+' 선택');await page.keyboard.press('Space');
  rec?.chapter('group','품목군 출력 묶음');await page.$eval('details:nth-of-type(1)',()=>{}).catch(()=>{});const summaries=await page.$$('summary');for(const h of summaries){if((await h.evaluate(n=>n.textContent)).includes('품목 묶음'))await h.click();}
  await input('콜롬비아 수국 출력묶음','콜수국·콜장미');await input('콜롬비아 장미 출력묶음','콜수국·콜장미');await say('함께 출력할 품목군에 같은 묶음 이름을 입력합니다.\n같은 요일 탭에 수국과 장미가 함께 나오고 단위별 합계는 구분됩니다.');
  await click('엑셀 미리보기');assert((await page.evaluate(()=>document.body.innerText)).includes('2026-11-06'));
  rec?.chapter('save','작성본 저장과 엑셀 다운로드');await click('저장 및 엑셀 다운로드');await page.waitForFunction(()=>document.body.innerText.includes('엑셀 다운로드 완료'));assert.equal(saveCalls,1);assert.equal(downloads,1);await say('저장 및 엑셀 다운로드를 누르면 작성내용이 서버에 보관됩니다.\n업체별 파일의 요일 탭에 품목·수량·단가와 자동 합계가 생성됩니다.',5500);
  await click('다시 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('v1'));await say('다시 불러오면 저장했던 배분과 품목 묶음이 복원됩니다.\nERP 실제 출고일과 재고·매출은 변경되지 않습니다.');
  fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/shipment-statement-desktop.png',fullPage:true});
  if(rec){const result=await rec.stop();rec=null;const f='config/workflow-guides.json',r=JSON.parse(fs.readFileSync(f));const g=r.workflows.find(w=>w.id==='shipment-statement').guides[0];g.status='ready';g.chapters=result.chapters;fs.writeFileSync(f,JSON.stringify(r,null,2)+'\n');}
  // Stale source cannot be saved; saved version remains downloadable.
  sourceChanged=true;await click('다시 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('저장 후 차수피벗 원본이 변경'));assert.equal(await page.$eval('button::-p-text(작성내용 저장)',n=>n.disabled),true);sourceChanged=false;
  await page.setViewport({width:390,height:844,deviceScaleFactor:1});await page.goto(base+'/shipment/statement?popup=1',{waitUntil:'networkidle0'});assert.equal(await page.$$eval('[data-ui-sidebar]',n=>n.length),0);assert.equal(await page.$$eval('[data-ui-popupbar]',n=>n.length),1);await page.screenshot({path:'.verify/shipment-statement-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,record,dragRows:2,saveCalls,downloads,productionWrites:0,keyboard:true,desktop:true,mobile:true}));
 }catch(e){console.log('UI state:',await page?.evaluate(()=>document.body.innerText.slice(-3500)));await page?.screenshot({path:'.verify/statement-error.png',fullPage:true});throw e;}finally{if(rec)await rec.stop();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
