// Local UI regression + optional real Chrome guide, all APIs synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
async function main(){
 const core=await import('../lib/shipmentDistributionDates.js'),root=process.cwd(),base=process.env.GUIDE_BASE||'http://127.0.0.1:39325',record=process.argv.includes('--record');
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 let rec,capturedGuide=null,stopped=false;try{
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});await page.setRequestInterception(true);
 const groups=[{key:'콜롬비아::수국',country:'콜롬비아',flower:'수국',label:'콜롬비아수국'},{key:'콜롬비아::카네이션',country:'콜롬비아',flower:'카네이션',label:'콜롬비아카네이션'},{key:'콜롬비아::장미',country:'콜롬비아',flower:'장미',label:'콜롬비아장미'},{key:'네덜란드::장미',country:'네덜란드',flower:'장미',label:'네덜란드장미'},{key:'네덜란드::튤립',country:'네덜란드',flower:'튤립',label:'네덜란드튤립'}];
 let staleRead=false,stalePack=false;let account='guide-support',countrySetting=null;const favGroups=groups.slice(0,4).map((g,i)=>({FavoriteKey:i+1,FilterData:JSON.stringify({groupKey:g.key})}));
 const prod={ProdKey:3513,ProdName:'연습 카네이션 Honey',DisplayName:'연습 카네이션 Honey',CounName:'콜롬비아',FlowerName:'카네이션',OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:300,inQty:1,outQty:1,Cost:11500};
 let context={scope:{orderYear:'2026',orderWeek:'45-01',custKey:777,prodKey:3513},detail:{...prod,OutQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,DetailFix:true,MasterFix:true},calendar:Array.from({length:7},(_,i)=>{const d=new Date(Date.UTC(2026,10,4+i));return {WeekDay:d.getUTCDay()+1,Timestamp:d.toISOString().slice(0,10)+' 00:00:00.000'};}),dates:[{Timestamp:'2026-11-06 00:00:00.000',ShipmentQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,Descr:''}]};
 const customer=()=>({CustKey:777,CustName:'연습업체',주문코드:'연습',주문수량:1,출고수량:1,Cost:11500,단가:11500,OutUnit:'박스',SdetailKey:101,ShipmentDateLabel:context.dates[0].Timestamp.slice(0,10),ShipmentDateCount:context.dates.length});
 page.on('request',async req=>{const u=new URL(req.url());if(u.origin!==base)return req.abort();if(!u.pathname.startsWith('/api/'))return req.continue();
  const body=req.postData()?JSON.parse(req.postData()):{},type=u.searchParams.get('type');let d={success:true,items:[],rows:[],groups:[],products:[],customers:[],favorites:[],data:[]},status=200;
  if(req.method()!=='GET')posts.push({path:u.pathname,body});
  if(u.pathname==='/api/auth/me')d.user={userId:account,userName:'영업지원 연습',authority:2};
  if(u.pathname==='/api/favorites'){
    if(req.method()==='GET'){const p=u.searchParams.get('page');d.favorites=account==='second-account'?[]:p==='shipment-distribute-products'?[{FavoriteKey:55,ProdKey:3515,FilterData:JSON.stringify({prodKey:3515})}]:p==='shipment-distribute-groups'?favGroups:p==='shipment-distribute-countries'&&countrySetting?[{FavoriteKey:99,FilterData:JSON.stringify(countrySetting)}]:[];}
    else if(body.page==='shipment-distribute-countries'||body.favoriteKey===99){countrySetting=JSON.parse(body.filterData);d.favoriteKey=99;}
  }
  if(type==='workspaceDateIndex'){d.rows=context.dates.map(r=>({CustKey:777,ProdKey:3513,ShipmentDate:r.Timestamp.slice(0,10)}));d.calendar=context.calendar;d.dateFacts=context.dates.map((r,i)=>({...prod,...r,CustKey:777,ProdKey:3513,SdetailKey:101,SdateKey:200+i,OutQuantity:1}));}
  if(type==='groups')d.groups=groups;if(type==='products'||type==='productCatalog')d.products=[prod,{...prod,ProdKey:3514,ProdName:'A Unfavorite',FlowerName:'알스트로'},{...prod,ProdKey:3515,ProdName:'Z Favorite',FlowerName:'카네이션'}];
  if(type==='workspaceCustomers'||type==='customers'||type==='custList'||type==='custDist'){d.customers=[customer()];d.totalOrder=1;d.totalOut=1;d.inQty=1;}
  if(type==='custItems')d.items=[{...prod,...customer()},{...prod,...customer(),ProdKey:3516,ProdName:'US Douglas',CounName:'미국',FlowerName:'더글라스'}];
  if(type==='custWeekGrid')d.rows=[{...prod,SdetailKey:101,OutQuantity:1,...Object.fromEntries(context.calendar.flatMap(r=>[[`ymd${r.WeekDay}`,r.Timestamp.slice(0,10)],[`day${r.WeekDay}`,context.dates.find(x=>x.Timestamp===r.Timestamp)?.ShipmentQuantity||0]]))}];
  if(['custItems','products'].includes(type) && u.searchParams.get('week')?.endsWith('45-03')){if(type==='custItems')d.items=[];else d.products=[];}
  if(type==='workspaceCustomers' && u.searchParams.get('week')?.endsWith('45-03'))d.customers=[{...customer(),noOrder:true}];
  if(type==='fixedScopes')d.scopes=[{prodKey:3513,fixed:true,countryFlower:'콜롬비아카네이션'}];
  if(u.pathname==='/api/shipment/distribution-dates'){
    if(req.method()==='GET'){let ctx=staleRead?{...context,dates:context.dates.map((r,i)=>i? r:{...r,ShipmentQuantity:r.ShipmentQuantity+0.1})}:context;if(stalePack)ctx={...ctx,detail:{...ctx.detail,BunchOf1Box:16}};d={success:true,context:ctx,snapshot:core.distributionDateSnapshot(ctx),blocked:''};}
    else try{const plan=core.planDistributionDates(context,body.allocations);d={success:true,plan};if(body.confirm)context={...context,dates:plan.dates};}catch(e){status=409;d={success:false,error:e.message};}
  }
  await req.respond({status,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto(base+'/shipment/distribute?popup=1');await page.waitForSelector('[data-testid="distribution-group-buttons"]');
 const click=async selector=>{console.log('click',selector);await page.waitForSelector(selector,{visible:true});await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},selector);for(let i=0;i<3;i++){try{await page.click(selector);return;}catch(e){if(!/detached|No element found/.test(e.message)||i===2)throw e;await new Promise(r=>setTimeout(r,100));}}};
 const text=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(n=>n.textContent.includes(t)&&n.getBoundingClientRect().height>0),{},text);const buttons=await page.$$('button');for(const b of buttons){if((await b.evaluate(n=>n.textContent)).includes(text)){await b.click();return;}}throw Error('button missing '+text);};
 const hold=async(caption,ms=3500)=>{if(rec){await rec.caption(caption);await rec.pause(ms);}};
 if(record)rec=await createWorkflowGuideRecorder(page,{root,workflowId:'shipment-distribution-dates',guideId:'support',title:'농장·업체별 출고분배와 출고일',sourceFiles:['pages/shipment/distribute.js','components/shipment/DistributionDateEditor.js','components/shipment/DistributionProductTree.js','components/shipment/DistributionDateFilter.js','lib/shipmentDistributionNavigation.js','components/shipment/DistributionInlineDates.js','lib/shipmentInlineDates.js','lib/shipmentDateDisplayUnits.js'],fixtureOnly:true});
 rec?.chapter('country','국가 선택과 독립 탐색');
 if(rec)await rec.pause(100);
 rec?.chapter('favorites','품종별 즐겨찾기 우선과 펼치기·접기');
 const w=await page.$('input[placeholder="YYYY-WW-SS"]')||await page.$('input[placeholder*="2026-"]');
 const week=async value=>{await page.waitForNetworkIdle({idleTime:200});const w=await page.$('input[placeholder="YYYY-WW-SS"]')||await page.$('input[placeholder*="2026-"]');await w.click();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await w.type(value);await page.keyboard.press('Tab');await page.waitForNetworkIdle({idleTime:200});};
 await week('2026-45-01');await text('🔍 조회');await page.waitForNetworkIdle({idleTime:200});
 await click('[data-ai-verify="country-select-콜롬비아"]');await page.waitForSelector('[data-ai-verify="family-toggle-콜롬비아::카네이션"]');
 assert.equal(await page.$eval('[data-ai-verify="family-toggle-콜롬비아::알스트로"]',n=>n.getAttribute('aria-expanded')),'false');
 assert.deepEqual(await page.$$eval('[data-testid="product-family-콜롬비아::카네이션"] [data-product-select]',n=>n.map(x=>x.getAttribute('data-ai-verify'))),['product-3515','product-3513']);
 const families=await page.$$eval('[data-testid^="product-family-"]',n=>n.map(x=>x.getAttribute('data-testid')));assert.equal(families.at(-1),'product-family-콜롬비아::알스트로');
 await hold('농장정보는 국가 → 품종 → 품목 순서로 찾습니다.\n즐겨찾기는 위에, 나머지 품종은 아래 접힌 목록에 표시합니다.');
 await click('[data-ai-verify="family-toggle-콜롬비아::카네이션"]');assert.equal(await page.$$eval('[data-ai-verify="product-3513"]',n=>n.length),0);
 await page.keyboard.press('Enter');await page.waitForSelector('[data-ai-verify="product-3513"]');
 await hold('수국·카네이션 등 품종 제목을 누르면 펼치거나 접습니다.\n접어도 기존 출고수량은 바뀌지 않습니다.');
 await page.select('select[aria-label="품종·품목 출고일 분류"]','2026-11-06');await page.waitForSelector('[data-ai-verify="product-3513"]');
 assert.equal(await page.$$eval('[data-ai-verify="product-3515"]',n=>n.length),0);await page.select('select[aria-label="품종·품목 출고일 분류"]','');
 await click('[data-ai-verify="product-3513"]');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');
 rec?.chapter('dates','날짜별 수량 입력과 총량 확인');
 const inline='[data-testid="inline-dates-777-3513"]';
 await page.waitForSelector(inline+' input');assert.deepEqual(await page.$$eval(inline+' [data-date-inline]',n=>n.map(x=>x.getAttribute('data-date-inline'))),['2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10']);
 await hold('거래처 행 옆에 선택 차수의 실제 날짜가 빠른 순서로 보입니다.\n입수 기준으로 단·송이 정수를 입력하며 박스 소수로 표시하지 않습니다.');
 const fill=async(date,val)=>{const sel=inline+' input[data-date-inline="'+date+'"]';await page.click(sel);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(sel,val);};
 assert.equal(await page.$eval(inline+' select',n=>n.value),'단');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-06"]',n=>n.value),'15');await page.select(inline+' select','송이');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-06"]',n=>n.value),'300');await hold('송이로 전환하면 1박스가 300송이로 보입니다.\n표시 단위만 바뀌고 저장된 총량은 그대로입니다.',3000);await page.select(inline+' select','단');await fill('2026-11-06','0');await fill('2026-11-05','6');assert.equal(await page.$eval(inline+' [data-inline-preview]',n=>n.disabled),true);
 await hold('날짜별 합계가 출고 총량과 다르면 확인·저장이 비활성됩니다.\n수량·단가 저장과 날짜 초안은 동시에 저장하지 않습니다.');
 await fill('2026-11-09','9');assert.equal(await page.$eval('button[aria-keyshortcuts="Control+S"]',n=>n.disabled),true);
 await page.screenshot({path:'outputs/inline-before.png',fullPage:true});const rect=await page.$eval(inline,n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});await page.screenshot({path:'outputs/inline-row.png',clip:rect});await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');
 assert.equal(await page.$eval('input[aria-label="2026-11-05 분배수량"]',n=>Number(n.value)),6);
 await text('변경 미리보기');await page.waitForSelector('[data-testid="date-save-preview"]');
 rec?.chapter('save','견적수량·매출 보존 확인 후 명시 저장');
 await hold('미리보기에서 총 출고 15단, 견적 15단, 매출 172,500원 유지와\n변경할 날짜를 확인한 뒤 출고일을 저장합니다.',5000);
 await text('확인한 출고일 저장');await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label="출고일 수량 분배"]'));
 assert.equal(posts.filter(x=>x.path==='/api/shipment/distribution-dates'&&x.body.confirm).length,1);const saved=posts.find(x=>x.path==='/api/shipment/distribution-dates'&&x.body.confirm).body;assert.equal(saved.allocations.find(r=>r.timestamp.startsWith('2026-11-05')).quantity,.4);assert.equal(saved.allocations.find(r=>r.timestamp.startsWith('2026-11-09')).quantity,.6);
 await hold('출고일 분배 저장 완료를 확인합니다.\n총 수량·단가·매출·확정 상태를 유지하고 날짜별 견적 출력일을 바꿉니다.');
 rec?.chapter('tab','출고일지정 탭에서 저장값 재확인');
 await text('출고일 지정');assert.equal(await page.$eval('button[aria-keyshortcuts="Control+S"]',n=>n.disabled),true,'tab2 cannot save a hidden product quantity');await text('연습업체');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');
 assert.equal(await page.$eval('input[aria-label="2026-11-05 분배수량"]',n=>Number(n.value)),6);
 await hold('출고일지정 탭도 같은 편집창과 저장 절차를 사용합니다.\n기본 출고요일 설정은 실제 출고일 저장과 별도입니다.');await text('닫기');
 rec?.chapter('customers','업체부터 선택하는 독립 작업공간');
 await text('출고분배 및 업체정보');await page.waitForSelector('[data-ai-verify="customer-777"]');
 assert.equal(await page.$$eval('[data-testid="distribution-group-buttons"]',n=>n.length),0,'farm country controls absent in customer workspace');
 await click('[data-ai-verify="customer-777"]');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');
 assert((await page.content()).includes('US Douglas'),'customer items not restricted by farm country');
 await hold('업체정보는 업체를 먼저 고르고 그 업체의 품목을 봅니다.\n농장정보에서 고른 국가·품종에 제한되지 않습니다.');
 await page.select('select[aria-label="업체 출고일 분류"]','2026-11-05');await page.waitForSelector('[data-ai-verify="customer-777"]');
 await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');await text('닫기');
 await hold('두 작업공간 모두 저장된 출고일로 분류합니다.\n행 옆 날짜순 단·송이 입력칸에서 총량을 유지하며 날짜별 수량을 바꿉니다.');
 assert.deepEqual(errors,[]);assert.equal(posts.filter(x=>x.path==='/api/orders'||x.path==='/api/shipment/distribute').length,0);
 if(rec){capturedGuide=await rec.stop();stopped=true;const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8'));const wf=registry.workflows.find(w=>w.id==='shipment-distribution-dates');wf.sourceFiles=['pages/shipment/distribute.js','components/shipment/DistributionDateEditor.js','components/shipment/DistributionProductTree.js','components/shipment/DistributionDateFilter.js','lib/shipmentDistributionNavigation.js','components/shipment/DistributionInlineDates.js','lib/shipmentInlineDates.js','lib/shipmentDateDisplayUnits.js'];wf.guides[0].status='ready';wf.guides[0].chapters=capturedGuide.chapters;fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');return;}
 // Empty-scope and near-miss regressions are dry-only, after the narrated workflow.
 for(const year of [2025,2026]){await week(year+'-45-03');await page.waitForSelector('[data-testid="distribution-no-order-candidates"]');await click('[data-ai-verify="customer-777"]');await page.waitForNetworkIdle({idleTime:200});await click('[data-ai-verify="add-panel-open"]');await page.waitForSelector('[data-testid="distribution-add-panel"]');await page.type('[data-ai-verify="add-prod-search"]','Honey');await click('[data-ai-verify="add-prod-3513"]');await click('[data-ai-verify="add-panel-close"]');}
 assert.equal(posts.filter(x=>x.path==='/api/orders'||x.path==='/api/shipment/distribute').length,0);
 assert.deepEqual(errors,[]);

 await week('2026-45-01');await click('[data-ai-verify="customer-777"]');await page.waitForSelector('[data-testid="inline-dates-777-3513"] input');
 await page.select(inline+' select','송이');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-05"]',n=>n.value),'120');
 await fill('2026-11-05','1');assert.equal(await page.$eval(inline+' [data-inline-preview]',n=>n.disabled),true);assert((await page.$eval(inline,n=>n.textContent)).includes('정확히 저장할 수 없는'));await text('날짜 취소');
 await fill('2026-11-05','1.5');assert.equal(await page.$eval(inline+' [data-inline-preview]',n=>n.disabled),true);assert((await page.$eval(inline,n=>n.textContent)).includes('정수로 입력'));await text('날짜 취소');await page.select(inline+' select','단');
 await fill('2026-11-05','3');await fill('2026-11-09','12');const beforeDatePosts=posts.length;
 await page.keyboard.down('Control');await page.keyboard.press('KeyS');await page.keyboard.up('Control');assert.equal(posts.length,beforeDatePosts);
 await text('출고분배 및 농장정보');assert(await page.$('select[aria-label="업체 출고일 분류"]'),'date draft blocks tab switch');
 staleRead=true;await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('날짜 또는 출고수량이 변경되었습니다.'));assert.equal(await page.$$eval('[role="dialog"] .btn-primary',n=>n.length),0,'stale baseline cannot preview or save');await text('닫기');staleRead=false;stalePack=true;await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('품목의 단위·입수가 변경되었습니다.'));await text('닫기');stalePack=false;
 await text('날짜 취소');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-05"]',n=>Number(n.value)),6);
 await week('2026-45-01');await click('[data-ai-verify="customer-777"]');await page.waitForSelector('[data-distribute-qty="true"]');const qty=await page.$('[data-distribute-qty="true"]');await qty.click({clickCount:3});await qty.type('2');await text('출고분배 및 농장정보');assert.equal(await page.$$eval('[data-ai-verify="customer-777"]',n=>n.length),1,'dirty tab switch blocked');page.once('dialog',d=>d.accept());await click('[data-ai-verify="discard-drafts"]');await text('출고분배 및 농장정보');await page.waitForSelector('[data-testid="distribution-product-list"]');
 await page.setViewport({width:390,height:844});await page.waitForSelector('[data-testid="distribution-product-list"]');await page.screenshot({path:'outputs/dual-mobile.png'});
 console.log('PASS dual workflow: favorite hierarchy/disclosure, independent customer, actual date filters/editor/tab2, cross-year empty catalog; synthetic APIs only.');
 }finally{if(rec&&!stopped)await rec.stop().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
