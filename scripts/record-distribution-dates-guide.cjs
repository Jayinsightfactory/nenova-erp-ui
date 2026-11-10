// Local UI regression + optional real Chrome guide, all APIs synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
async function main(){
 const core=await import('../lib/shipmentDistributionDates.js'),root=process.cwd(),base=process.env.GUIDE_BASE||'http://127.0.0.1:39325',record=process.argv.includes('--record');
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 let rec,stopped=false;try{
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});await page.setRequestInterception(true);
 const groups=[{key:'콜롬비아::수국',country:'콜롬비아',flower:'수국',label:'콜롬비아수국'},{key:'콜롬비아::카네이션',country:'콜롬비아',flower:'카네이션',label:'콜롬비아카네이션'},{key:'콜롬비아::장미',country:'콜롬비아',flower:'장미',label:'콜롬비아장미'},{key:'네덜란드::장미',country:'네덜란드',flower:'장미',label:'네덜란드장미'},{key:'네덜란드::튤립',country:'네덜란드',flower:'튤립',label:'네덜란드튤립'}];
 let account='guide-support',countrySetting=null;const favGroups=groups.slice(0,4).map((g,i)=>({FavoriteKey:i+1,FilterData:JSON.stringify({groupKey:g.key})}));
 const prod={ProdKey:3513,ProdName:'연습 카네이션 Honey',DisplayName:'연습 카네이션 Honey',CounName:'콜롬비아',FlowerName:'카네이션',OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:300,inQty:1,outQty:1,Cost:11500};
 let context={scope:{orderYear:'2026',orderWeek:'45-01',custKey:777,prodKey:3513},detail:{...prod,OutQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,DetailFix:true,MasterFix:true},calendar:Array.from({length:7},(_,i)=>{const d=new Date(Date.UTC(2026,10,4+i));return {WeekDay:d.getUTCDay()+1,Timestamp:d.toISOString().slice(0,10)+' 00:00:00.000'};}),dates:[{Timestamp:'2026-11-06 00:00:00.000',ShipmentQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,Descr:''}]};
 const customer=()=>({CustKey:777,CustName:'연습업체',주문코드:'연습',주문수량:1,출고수량:1,Cost:11500,단가:11500,OutUnit:'박스',SdetailKey:101,ShipmentDateLabel:context.dates[0].Timestamp.slice(0,10),ShipmentDateCount:context.dates.length});
 page.on('request',async req=>{const u=new URL(req.url());if(u.origin!==base)return req.abort();if(!u.pathname.startsWith('/api/'))return req.continue();
  const body=req.postData()?JSON.parse(req.postData()):{},type=u.searchParams.get('type');let d={success:true,items:[],rows:[],groups:[],products:[],customers:[],favorites:[],data:[]},status=200;
  if(req.method()!=='GET')posts.push({path:u.pathname,body});
  if(u.pathname==='/api/auth/me')d.user={userId:account,userName:'영업지원 연습',authority:2};
  if(u.pathname==='/api/favorites'){
    if(req.method()==='GET'){const p=u.searchParams.get('page');d.favorites=account==='second-account'?[]:p==='shipment-distribute-groups'?favGroups:p==='shipment-distribute-countries'&&countrySetting?[{FavoriteKey:99,FilterData:JSON.stringify(countrySetting)}]:[];}
    else if(body.page==='shipment-distribute-countries'||body.favoriteKey===99){countrySetting=JSON.parse(body.filterData);d.favoriteKey=99;}
  }
  if(type==='groups')d.groups=groups;if(type==='products'||type==='productCatalog')d.products=[prod];
  if(type==='customers'||type==='custList'||type==='custDist'){d.customers=[customer()];d.totalOrder=1;d.totalOut=1;d.inQty=1;}
  if(type==='custItems')d.items=[{...prod,...customer()}];
  if(type==='custWeekGrid')d.rows=[{...prod,SdetailKey:101,OutQuantity:1,...Object.fromEntries(context.calendar.flatMap(r=>[[`ymd${r.WeekDay}`,r.Timestamp.slice(0,10)],[`day${r.WeekDay}`,context.dates.find(x=>x.Timestamp===r.Timestamp)?.ShipmentQuantity||0]]))}];
  if(type==='fixedScopes')d.scopes=[{prodKey:3513,fixed:true,countryFlower:'콜롬비아카네이션'}];
  if(u.pathname==='/api/shipment/distribution-dates'){
    if(req.method()==='GET')d={success:true,context,snapshot:core.distributionDateSnapshot(context),blocked:''};
    else try{const plan=core.planDistributionDates(context,body.allocations);d={success:true,plan};if(body.confirm)context={...context,dates:plan.dates};}catch(e){status=409;d={success:false,error:e.message};}
  }
  await req.respond({status,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto(base+'/shipment/distribute?popup=1');await page.waitForSelector('[data-testid="distribution-group-buttons"]');
 const click=async selector=>{console.log('click',selector);await page.waitForSelector(selector,{visible:true});await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},selector);for(let i=0;i<3;i++){try{await page.click(selector);return;}catch(e){if(!/detached|No element found/.test(e.message)||i===2)throw e;await new Promise(r=>setTimeout(r,100));}}};
 const text=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(n=>n.textContent.includes(t)&&n.getBoundingClientRect().height>0),{},text);const buttons=await page.$$('button');for(const b of buttons){if((await b.evaluate(n=>n.textContent)).includes(text)){await b.click();return;}}throw Error('button missing '+text);};
 const hold=async(caption,ms=3500)=>{if(rec){await rec.caption(caption);await rec.pause(ms);}};
 if(record)rec=await createWorkflowGuideRecorder(page,{root,workflowId:'shipment-distribution-dates',guideId:'support',title:'출고분배 국가 즐겨찾기와 출고일 분배',sourceFiles:['pages/shipment/distribute.js','components/shipment/DistributionDateEditor.js'],fixtureOnly:true});
 rec?.chapter('favorites','국가와 품종 즐겨찾기를 한 곳에서 선택');
 await hold('국가 제목 아래 즐겨찾기 품종을 한 번만 표시합니다.\n전체 보기에서 국가와 품종의 별을 설정합니다.');
 assert.equal(await page.$$eval('[data-ai-verify^="fav-group-"]',n=>n.length),0);
 await click('[data-ai-verify="group-view-all"]');await click('[data-ai-verify="country-fav-네덜란드"]');await page.waitForFunction(()=>document.querySelector('[data-ai-verify="country-fav-네덜란드"]')?.getAttribute('aria-pressed')==='false');
 await click('[data-ai-verify="group-view-all"]');assert.equal(await page.$$eval('[data-testid="distribution-country-네덜란드"]',n=>n.length),0);
 assert.equal(await page.$$eval('[data-testid="distribution-country-콜롬비아"] [data-distribution-group-select]',n=>n.length),3);
 await hold('콜롬비아를 즐겨찾기하면 수국·카네이션·장미 등\n그 국가에서 즐겨찾기한 품종만 바로 나타납니다.');
 const week=await page.$('input[placeholder="YYYY-WW-SS"]')||await page.$('input[placeholder*="2026-"]');assert(week,'week input');await week.click();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await week.type('2026-45-01');await page.keyboard.press('Tab');await text('🔍 조회');
 await click('[data-ai-verify="group-콜롬비아카네이션"]');await page.waitForNetworkIdle({idleTime:200});await page.waitForSelector('[data-product-select]');await click('[data-product-select]');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');
 rec?.chapter('dates','날짜별 수량 입력과 총량 확인');
 await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"][aria-label="출고일 수량 분배"] input');
 await hold('거래처 행의 출고일 「분배·수정」을 누릅니다.\n현재 출고 총량과 저장된 날짜별 수량을 먼저 확인합니다.');
 const fill=async(date,val)=>{const s=`input[aria-label="${date} 분배수량"]`;await page.click(s);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(s,val);};
 await fill('2026-11-06','0');await fill('2026-11-05','0.4');
 assert.equal(await page.$eval('[role="dialog"] .btn-primary',n=>n.disabled),true);
 await hold('날짜별 합계가 현재 출고수량과 다르면 저장할 수 없습니다.\n수량을 다른 날짜로 나누어 합계를 맞춥니다.');
 await fill('2026-11-09','0.6');await text('변경 미리보기');await page.waitForSelector('[data-testid="date-save-preview"]');
 rec?.chapter('save','견적수량·매출 보존 확인 후 명시 저장');
 await hold('미리보기에서 총 출고 1박스, 견적 15단, 매출 172,500원 유지와\n변경할 날짜를 확인한 뒤 출고일을 저장합니다.',5000);
 await text('확인한 출고일 저장');await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label="출고일 수량 분배"]'));
 assert.equal(posts.filter(x=>x.path==='/api/shipment/distribution-dates'&&x.body.confirm).length,1);
 await hold('출고일 분배 저장 완료를 확인합니다.\n총 수량·단가·매출·확정 상태를 유지하고 날짜별 견적 출력일을 바꿉니다.');
 rec?.chapter('tab','출고일지정 탭에서 저장값 재확인');
 await text('출고일 지정');assert.equal(await page.$eval('button[aria-keyshortcuts="Control+S"]',n=>n.disabled),true,'tab2 cannot save a hidden product quantity');await text('연습업체');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');
 assert.equal(await page.$eval('input[aria-label="2026-11-05 분배수량"]',n=>Number(n.value)),.4);
 await hold('출고일지정 탭도 같은 편집창과 저장 절차를 사용합니다.\n기본 출고요일 설정은 실제 출고일 저장과 별도입니다.');await text('닫기');
 assert.deepEqual(errors,[]);
 if(rec){const result=await rec.stop();stopped=true;const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8'));const wf=registry.workflows.find(w=>w.id==='shipment-distribution-dates');wf.guides[0].status='ready';wf.guides[0].chapters=result.chapters;fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');}
 // Non-recorded keyboard + discard + mobile verification.
 await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label="출고일 수량 분배"]'));
 await page.setViewport({width:390,height:844});await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');assert(await page.$eval('[role="dialog"]',n=>n.getBoundingClientRect().width<=390));await page.screenshot({path:'outputs/date-mobile.png'});await page.keyboard.press('Escape');
 await page.setViewport({width:1920,height:1080});await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');
 await fill('2026-11-05','0.3');const beforePosts=posts.length;await page.keyboard.down('Control');await page.keyboard.press('KeyS');await page.keyboard.up('Control');assert.equal(posts.length,beforePosts,'Ctrl+S cannot submit behind date modal');
 page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert(await page.$('[role="dialog"]'),'dirty discard cancelled');page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label="출고일 수량 분배"]'));
 await click('[data-ai-verify="group-view-all"]');await click('[data-ai-verify="country-fav-콜롬비아"]');await page.waitForFunction(()=>document.querySelector('[data-ai-verify="country-fav-콜롬비아"]')?.getAttribute('aria-pressed')==='false');await click('[data-ai-verify="group-view-all"]');assert.equal(await page.$$eval('[data-testid^="distribution-country-"]',n=>n.length),0,'explicit empty stays empty');
 await page.reload();await page.waitForNetworkIdle({idleTime:200});assert.equal(await page.$$eval('[data-testid^="distribution-country-"]',n=>n.length),0,'empty country preference survives reload');assert.equal(await page.$eval('[data-ai-verify="group-all"]',n=>n.getAttribute('aria-pressed')),'true','explicit empty cannot preselect hidden group');
 await click('[data-ai-verify="group-view-all"]');await click('[data-ai-verify="country-fav-네덜란드"]');await page.waitForFunction(()=>document.querySelector('[data-ai-verify="country-fav-네덜란드"]')?.getAttribute('aria-pressed')==='true');await click('[data-ai-verify="group-view-all"]');assert.equal(await page.$$eval('[data-testid="distribution-country-네덜란드"] [data-distribution-group-select]',n=>n.length),1,'only Netherlands favorite rose, no unfavorited tulip');
 account='second-account';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelectorAll('[data-testid^="distribution-country-"]').length===0);
 console.log('PASS actual UI: duplicate favorites removed, country+variety intersection, quantity mismatch disabled, preview explicit save, actual date re-read in tab, Escape focus, 390 viewport. All APIs synthetic.');
 }finally{if(rec&&!stopped)await rec.stop().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

