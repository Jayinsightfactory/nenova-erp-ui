// Local UI regression + optional real Chrome guide, all APIs synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
async function main(){
 const core=await import('../lib/shipmentDistributionDates.js'),root=process.cwd(),base=process.env.GUIDE_BASE||'http://127.0.0.1:39325',record=process.argv.includes('--record');
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 let rec,capturedGuide=null,stopped=false,step=0;try{
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});await page.setRequestInterception(true);
 const groups=[{key:'콜롬비아::수국',country:'콜롬비아',flower:'수국',label:'콜롬비아수국'},{key:'콜롬비아::카네이션',country:'콜롬비아',flower:'카네이션',label:'콜롬비아카네이션'},{key:'콜롬비아::장미',country:'콜롬비아',flower:'장미',label:'콜롬비아장미'},{key:'네덜란드::장미',country:'네덜란드',flower:'장미',label:'네덜란드장미'},{key:'네덜란드::튤립',country:'네덜란드',flower:'튤립',label:'네덜란드튤립'}];
 let staleRead=false,stalePack=false,axisFixture=false,customerGets=0;const customerRace=process.argv.includes('--customer-race');let account='guide-support',countrySetting=null;const favGroups=groups.slice(0,4).map((g,i)=>({FavoriteKey:i+1,FilterData:JSON.stringify({groupKey:g.key})}));
 const prod={ProdKey:3513,ProdName:'연습 카네이션 Honey',DisplayName:'연습 카네이션 Honey',CounName:'콜롬비아',FlowerName:'카네이션',OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:300,inQty:1,outQty:1,Cost:11500};
 let context={scope:{orderYear:'2026',orderWeek:'45-01',custKey:777,prodKey:3513},detail:{...prod,OutQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,DetailFix:true,MasterFix:true},calendar:Array.from({length:7},(_,i)=>{const d=new Date(Date.UTC(2026,10,4+i));return {WeekDay:d.getUTCDay()+1,Timestamp:d.toISOString().slice(0,10)+' 00:00:00.000'};}),dates:[{Timestamp:'2026-11-06 00:00:00.000',ShipmentQuantity:1,EstQuantity:15,Cost:11500,Amount:156818,Vat:15682,Descr:''}]};
 const customer=()=>({CustKey:777,CustName:'연습업체',주문코드:'연습',주문수량:1,출고수량:1,Cost:11500,단가:11500,OutUnit:'박스',SdetailKey:101,ShipmentDateLabel:context.dates[0].Timestamp.slice(0,10),ShipmentDateCount:context.dates.length});
 page.on('request',async req=>{const u=new URL(req.url());if(u.origin!==base)return req.abort();if(!u.pathname.startsWith('/api/'))return req.continue();
  const body=req.postData()?JSON.parse(req.postData()):{},type=u.searchParams.get('type');let d={success:true,items:[],rows:[],groups:[],products:[],customers:[],favorites:[],data:[]},status=200;
  if(req.method()!=='GET')posts.push({path:u.pathname,body});
  if(u.pathname==='/api/auth/me')d.user={userId:account,userName:'영업지원 연습',authority:2};
  if(u.pathname==='/api/kakao/sales-feed')d={ok:true,hasMore:false,nextAfterKey:'guide-cancel',messages:[{source:'nenovakakao',chat_id:'fixture',external_message_id:'guide-add',chatroom:'영업방',sender:'연습 담당',created_at:'2026-11-13T10:00:00+09:00',message:'연습업체 카네이션 1박스 추가'},{source:'nenovakakao',chat_id:'fixture',external_message_id:'guide-cancel',chatroom:'영업방',sender:'연습 담당',created_at:'2026-11-13T10:05:00+09:00',message:'연습업체 카네이션 1박스 취소'},...Array.from({length:20},(_,i)=>({source:'nenovakakao',chat_id:'fixture',external_message_id:'guide-scroll-'+i,chatroom:'영업방',sender:'연습 담당',created_at:'2026-11-13T10:'+String(i+6).padStart(2,'0')+':00+09:00',message:'연습업체 '+(i+1)+' 카네이션 1박스 추가\n업체와 품목을 확인하는 연습 요청입니다.'}))]};
  if(u.pathname==='/api/favorites'){
    if(req.method()==='GET'){const p=u.searchParams.get('page');d.favorites=account==='second-account'?[]:p==='shipment-distribute-products'?[{FavoriteKey:55,ProdKey:3515,FilterData:JSON.stringify({prodKey:3515})}]:p==='shipment-distribute-groups'?favGroups:p==='shipment-distribute-countries'&&countrySetting?[{FavoriteKey:99,FilterData:JSON.stringify(countrySetting)}]:[];}
    else if(body.page==='shipment-distribute-countries'||body.favoriteKey===99){countrySetting=JSON.parse(body.filterData);d.favoriteKey=99;}
  }
  if(type==='workspaceDateIndex'){d.rows=context.dates.map(r=>({CustKey:777,ProdKey:3513,ShipmentDate:r.Timestamp.slice(0,10)}));d.calendar=context.calendar;d.dateFacts=context.dates.map((r,i)=>({...prod,...r,CustKey:777,ProdKey:3513,SdetailKey:101,SdateKey:200+i,OutQuantity:1}));d.majorDateFacts=[...d.dateFacts.map(r=>({...r,OrderYear:'2026',OrderWeek:'45-01'})),{...prod,CustKey:777,ProdKey:3513,OrderYear:'2026',OrderWeek:'45-02',SdetailKey:102,SdateKey:202,OutQuantity:2,Timestamp:'2026-11-07 00:00:00.000',ShipmentQuantity:2},{...prod,CustKey:778,ProdKey:3513,OrderYear:'2026',OrderWeek:'45-03',SdetailKey:103,SdateKey:203,OutQuantity:1,Timestamp:'2026-11-08 00:00:00.000',ShipmentQuantity:1}];}
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
  if(axisFixture){
   const selected=u.searchParams.get('week')?.slice(-5);
   const rows=[{...prod,CustKey:777,ProdKey:3513,OrderYear:'2026',OrderWeek:'45-01',SdetailKey:101,OutQuantity:1,Timestamp:context.calendar[0].Timestamp,ShipmentQuantity:1},{...prod,CustKey:778,ProdKey:3513,OrderYear:'2026',OrderWeek:'45-02',SdetailKey:102,OutQuantity:2,Timestamp:context.calendar[1].Timestamp,ShipmentQuantity:2},{...prod,CustKey:779,ProdKey:3513,OrderYear:'2026',OrderWeek:'45-02',SdetailKey:103,OutQuantity:0,Timestamp:null,ShipmentQuantity:null},{...prod,CustKey:800,ProdKey:999,OrderYear:'2026',OrderWeek:'45-03',SdetailKey:104,OutQuantity:1,Timestamp:context.calendar[2].Timestamp,ShipmentQuantity:1}];
   if(type==='workspaceDateIndex'){d.majorDateFacts=rows;d.dateFacts=rows.filter(r=>r.OrderWeek===selected);d.rows=[];}
   if(type==='custDist')d.customers=[777,778,779].map(key=>({...customer(),CustKey:key,CustName:'연습'+key,출고수량:rows.find(r=>r.CustKey===key&&r.OrderWeek===selected)?.OutQuantity??0}));
  }
  if(type==='workspaceCustomers'){customerGets++;if(customerRace)await new Promise(r=>setTimeout(r,1500));}
  await req.respond({status,contentType:'application/json',body:JSON.stringify(d)});
 });
 await page.goto(base+'/shipment/distribute?popup=1');await page.waitForSelector('[data-testid="distribution-group-buttons"]');
 const click=async selector=>{console.log('click',selector);await page.waitForSelector(selector,{visible:true});await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},selector);for(let i=0;i<3;i++){try{if(rec){await page.$eval(selector,n=>n.scrollIntoView({block:'center',inline:'center'}));await rec.focus(selector,step);}
 await page.click(selector);if(rec)await rec.unfocus();return;}catch(e){if(!/detached|No element found/.test(e.message)||i===2)throw e;await new Promise(r=>setTimeout(r,100));}}};
 const text=async text=>{await page.waitForFunction(t=>[...(document.querySelector('[role="dialog"]')??document).querySelectorAll('button')].some(n=>n.textContent.includes(t)&&n.getBoundingClientRect().height>0),{},text);const dialog=await page.$('[role="dialog"]');const buttons=dialog?await dialog.$$('button'):await page.$$('button');for(const b of buttons){if(await b.boundingBox()&&(await b.evaluate(n=>n.textContent)).includes(text)){if(rec){const sel='[data-guide-target]';await b.evaluate(n=>{document.querySelector('[data-guide-target]')?.removeAttribute('data-guide-target');n.setAttribute('data-guide-target','true');n.scrollIntoView({block:'center',inline:'center'});});await rec.focus(sel,step);}
 await b.click();if(rec)await rec.unfocus();return;}}throw Error('button missing '+text);};
 const select=async(selector,value)=>{if(rec){await page.$eval(selector,n=>n.scrollIntoView({block:'center',inline:'center'}));await rec.focus(selector,step);}await page.select(selector,value);if(rec)await rec.unfocus();};
 const hold=async(caption,ms=3500)=>{if(rec){await rec.caption(`${step}. ${caption}`);await rec.pause(ms);}};
 if(customerRace){
  for(const year of ['2025','2026']){
   const input=await page.$('input[placeholder="YYYY-WW-SS"]')||await page.$('input[placeholder*="2026-"]');const before=customerGets;
   await input.click({clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await input.type(year+'-45-02');await page.keyboard.press('Tab');
   await page.waitForFunction(n=>document.querySelector('input')?.value.endsWith('45-02'),{},before);
   await text('🔍 조회');await page.waitForNetworkIdle({idleTime:200});await text('출고분배 및 업체정보');
   await page.waitForSelector('[data-ai-verify="customer-777"]',{visible:true,timeout:3000});
   assert(!(await page.$eval('[data-testid="distribution-workspace"]',n=>n.textContent)).includes('업체 조회 중…'));
   await text('출고분배 및 농장정보');
  }
  assert(customerGets>=4);assert(!posts.some(p=>p.path.startsWith('/api/orders')||p.path.startsWith('/api/shipment')));assert.deepEqual(errors,[]);
  console.log('PASS delayed customer-load race: week effect plus manual search, 2025/2026 same45, customer list visible/loading cleared, no ERP writes');return;
 }
 if(record)rec=await createWorkflowGuideRecorder(page,{root,workflowId:'shipment-distribution-dates',guideId:'support',title:'농장·업체별 출고분배와 출고일',sourceFiles:['lib/distributionKakaoRequests.js','lib/distributionSalesInboxRefresh.js','pages/shipment/distribute.js','components/shipment/DistributionKakaoFeed.js','components/shipment/DistributionDateEditor.js','components/shipment/DistributionProductTree.js','components/shipment/DistributionDateFilter.js','lib/shipmentDistributionNavigation.js','components/shipment/DistributionInlineDates.js','lib/shipmentInlineDates.js','lib/shipmentDateDisplayUnits.js','lib/shipmentMajorInlineDates.js'],fixtureOnly:true});
 if(process.argv.includes('--camera-probe'))rec={chapter:()=>{},caption:async()=>{},pause:async()=>{},unfocus:async()=>{},stop:async()=>{},focus:async(selector,number)=>{const box=await page.$eval(selector,n=>{const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};});if(box.x<0||box.x>1920||box.y<70||box.y>900)throw Error('CAMERA '+number+' '+selector+' '+JSON.stringify(box));}};
 if(rec){const chapter=rec.chapter;rec.chapter=async(scenario,title)=>{step++;chapter(scenario,`${step}. ${title}`);await rec.caption(`${step}. ${title} · 전체 화면에서 조작 위치를 확인하세요.`);await rec.pause(1200);};}
 if(rec)await rec.chapter('country','국가 선택과 독립 탐색');
 if(rec)await rec.pause(100);

 const w=await page.$('input[placeholder="YYYY-WW-SS"]')||await page.$('input[placeholder*="2026-"]');
 const week=async value=>{await page.waitForNetworkIdle({idleTime:200});const w=await page.$('input[placeholder="YYYY-WW-SS"]')||await page.$('input[placeholder*="2026-"]');if(rec){await w.evaluate(n=>{n.setAttribute('data-guide-week','true');n.scrollIntoView({block:'center'});});await rec.focus('[data-guide-week]',step);}
 await w.click();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await w.type(value);await page.keyboard.press('Tab');if(rec)await rec.unfocus();await page.waitForNetworkIdle({idleTime:200});};
 await week('2026-45-01');await text('🔍 조회');await page.waitForNetworkIdle({idleTime:200});
 await click('[data-ai-verify="country-select-콜롬비아"]');await page.waitForSelector('[data-ai-verify="family-toggle-콜롬비아::카네이션"]');
 assert.equal(await page.$eval('[data-ai-verify="family-toggle-콜롬비아::알스트로"]',n=>n.getAttribute('aria-expanded')),'false');
 assert.deepEqual(await page.$$eval('[data-testid="product-family-콜롬비아::카네이션"] [data-product-select]',n=>n.map(x=>x.getAttribute('data-ai-verify'))),['product-3515','product-3513']);
 const families=await page.$$eval('[data-testid^="product-family-"]',n=>n.map(x=>x.getAttribute('data-testid')));assert.equal(families.at(-1),'product-family-콜롬비아::알스트로');
 await hold('농장정보는 국가 → 품종 → 품목 순서로 찾습니다.\n즐겨찾기는 위에, 나머지 품종은 아래 접힌 목록에 표시합니다.');
 if(rec)await rec.chapter('favorites','품종별 즐겨찾기와 펼치기·접기');
 await click('[data-ai-verify="family-toggle-콜롬비아::카네이션"]');assert.equal(await page.$$eval('[data-ai-verify="product-3513"]',n=>n.length),0);
 await page.keyboard.press('Enter');await page.waitForSelector('[data-ai-verify="product-3513"]');
 await hold('수국·카네이션 등 품종 제목을 누르면 펼치거나 접습니다.\n접어도 기존 출고수량은 바뀌지 않습니다.');
 await select('select[aria-label="품종·품목 출고일 분류"]','2026-11-06');await page.waitForSelector('[data-ai-verify="product-3513"]');
 assert.equal(await page.$$eval('[data-ai-verify="product-3515"]',n=>n.length),0);await select('select[aria-label="품종·품목 출고일 분류"]','');
 await click('[data-ai-verify="product-3513"]');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');
 if(rec)await rec.chapter('dates','업체 검색과 날짜별 수량 입력');
 const farmSearch='[data-ai-verify="farm-distribution-customer-search"]';
 await hold('최근 3일 영업방의 추가·취소 요청을 자동으로 불러옵니다.\n15초마다 새 요청을 확인합니다. 잔량·출고일 변경은 제외합니다.');
 await page.hover('[aria-label="카톡 요청 목록"]');await page.mouse.wheel({deltaY:350});
 await hold('카톡 목록 안에서 스크롤하므로 분배표를 보면서 요청을 확인할 수 있습니다.');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='추가·취소 불러오기')?.click());
 await page.waitForFunction(()=>document.querySelector('[aria-label="카톡 추가·취소 요청"]')?.textContent.includes('연습업체 카네이션 1박스 취소'));
 if(rec){await page.$eval(farmSearch,n=>n.scrollIntoView({block:'center'}));await rec.focus(farmSearch,step);}
 await page.click(farmSearch);await page.keyboard.type('연습업체');if(rec)await rec.unfocus();
 await page.waitForFunction(()=>document.querySelector('[data-testid="distribution-workspace"]')?.textContent.includes('1/1곳'));
 assert.equal(await page.$$eval('.distribution-customer-table tbody tr',n=>n.filter(r=>r.querySelector('td[colspan="11"]')).length),0,'farm customer search matches synthetic customer');
 await hold('선택한 품목의 업체가 많으면 이 검색창에서 업체명을 입력합니다.\n현재 품목의 분배 업체행만 좁히며 합계와 저장값은 바뀌지 않습니다.');
 await page.click(farmSearch);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 const inline='[data-testid="inline-dates-777-3513"]';
 assert.deepEqual(await page.$$eval(inline+' [data-subweek-row]',n=>n.map(e=>e.getAttribute('data-subweek-row'))),['45-01','45-02','45-03']);assert.equal(await page.$eval(inline+' [data-major-total]',n=>n.textContent),'45');assert.equal(await page.$$eval(inline+' [data-subweek-row="45-02"] input',n=>n.length),0);
  assert.equal(await page.$$eval(inline+' thead',n=>n.length),0);assert.equal(await page.$eval(inline+' [data-subweek-total="45-03"]',n=>n.textContent),'0');assert.equal(await page.$$eval(inline+' [data-subweek-row="45-03"] input',n=>n.length),0);assert.equal(await page.$$eval('[data-testid="distribution-date-header"]',n=>n.filter(e=>e.getBoundingClientRect().height).length),1);
 await page.waitForSelector(inline+' input');assert.deepEqual(await page.$$eval(inline+' [data-date-inline]',n=>n.map(x=>x.getAttribute('data-date-inline'))),['2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-09','2026-11-10']);
 if(!record){
  await page.focus(inline+' select');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-date-inline')),'2026-11-04');
  for(let i=0;i<7;i++)await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-inline-preview')),true);assert.equal(posts.filter(p=>p.path==='/api/shipment/distribution-dates'&&p.body.confirm).length,0);
  await page.keyboard.press('Tab');await page.setViewport({width:390,height:844});
  const reachable=await page.$eval(inline,n=>{let p=n.parentElement;while(p&&!/auto|scroll/.test(getComputedStyle(p).overflowX))p=p.parentElement;if(!p)return false;p.scrollLeft=p.scrollWidth;const r=n.querySelector('[data-major-total]').getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=0;});assert(reachable,'main total reachable through horizontal table scroll on390');
  await page.screenshot({path:'outputs/major-mobile.png'});await page.setViewport({width:1920,height:1080});await page.$eval(inline,n=>{let p=n.parentElement;while(p){if(/auto|scroll/.test(getComputedStyle(p).overflowX))p.scrollLeft=0;p=p.parentElement;}});
 }
 await hold('공통 날짜 아래 45-01·02·03을 같은 순서로 표시합니다. 없는 분배는 0입니다.\n오른쪽 45차 총수량은 45단입니다. 실제 선택 차수만 수정합니다.');
 const fill=async(date,val)=>{const sel=inline+' input[data-date-inline="'+date+'"]';if(rec){await page.$eval(sel,n=>n.scrollIntoView({block:'center',inline:'center'}));await rec.focus(sel,step);}
 await page.click(sel);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(sel,val);if(rec)await rec.unfocus();};
 assert.equal(await page.$eval(inline+' select',n=>n.value),'단');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-06"]',n=>n.value),'15');await select(inline+' select','송이');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-06"]',n=>n.value),'300');await hold('송이로 전환하면 1박스가 300송이로 보입니다.\n표시 단위만 바뀌고 저장된 총량은 그대로입니다.',3000);await select(inline+' select','단');await fill('2026-11-06','0');await fill('2026-11-05','6');assert.equal(await page.$eval(inline+' [data-inline-preview]',n=>n.disabled),true);
 await hold('날짜별 합계가 출고 총량과 다르면 확인·저장이 비활성됩니다.\n수량·단가 저장과 날짜 초안은 동시에 저장하지 않습니다.');
 await fill('2026-11-09','9');assert.equal(await page.$eval('button[aria-keyshortcuts="Control+S"]',n=>n.disabled),true);
 await page.screenshot({path:'outputs/inline-before.png',fullPage:true});const rect=await page.$eval(inline,n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});await page.screenshot({path:'outputs/inline-row.png',clip:rect});await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');
 assert.equal(await page.$eval('input[aria-label="2026-11-05 분배수량"]',n=>Number(n.value)),6);
 await text('변경 미리보기');await page.waitForSelector('[data-testid="date-save-preview"]');
 if(rec)await rec.chapter('save','견적수량·매출 보존 확인 후 명시 저장');
 await hold('미리보기에서 총 출고 15단, 견적 15단, 매출 172,500원 유지와\n변경할 날짜를 확인한 뒤 출고일을 저장합니다.',5000);
 await text('확인한 출고일 저장');await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label="출고일 수량 분배"]'));
 assert.equal(posts.filter(x=>x.path==='/api/shipment/distribution-dates'&&x.body.confirm).length,1);const saved=posts.find(x=>x.path==='/api/shipment/distribution-dates'&&x.body.confirm).body;assert.equal(saved.orderWeek,'45-01');assert.equal(await page.$eval(inline+' [data-subweek-total="45-02"]',n=>n.textContent),'30');assert.equal(saved.allocations.find(r=>r.timestamp.startsWith('2026-11-05')).quantity,.4);assert.equal(saved.allocations.find(r=>r.timestamp.startsWith('2026-11-09')).quantity,.6);
 await hold('출고일 분배 저장 완료를 확인합니다.\n총 수량·단가·매출·확정 상태를 유지하고 날짜별 견적 출력일을 바꿉니다.');
 if(rec)await rec.chapter('tab','출고일지정 탭에서 저장값 재확인');
 await text('출고일 지정');assert.equal(await page.$eval('button[aria-keyshortcuts="Control+S"]',n=>n.disabled),true,'tab2 cannot save a hidden product quantity');await text('연습업체');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');
 assert.equal(await page.$eval('input[aria-label="2026-11-05 분배수량"]',n=>Number(n.value)),6);
 await hold('출고일지정 탭도 같은 편집창과 저장 절차를 사용합니다.\n기본 출고요일 설정은 실제 출고일 저장과 별도입니다.');await text('닫기');
 if(rec)await rec.chapter('customers','업체부터 선택하는 독립 작업공간');
 await text('출고분배 및 업체정보');await page.waitForSelector('[data-ai-verify="customer-777"]');
 assert.equal(await page.$$eval('[data-testid="distribution-group-buttons"]',n=>n.length),0,'farm country controls absent in customer workspace');
 await click('[data-ai-verify="customer-777"]');await page.waitForSelector('[data-ai-verify="date-edit-777-3513"]');
 assert((await page.content()).includes('US Douglas'),'customer items not restricted by farm country');
 await hold('업체정보는 업체를 먼저 고르고 그 업체의 품목을 봅니다.\n농장정보에서 고른 국가·품종에 제한되지 않습니다.');
 await select('select[aria-label="업체 출고일 분류"]','2026-11-05');await page.waitForSelector('[data-ai-verify="customer-777"]');
 await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForSelector('[role="dialog"] input');await text('닫기');
 await hold('두 작업공간 모두 저장된 출고일로 분류합니다.\n행 옆 날짜순 단·송이 입력칸에서 총량을 유지하며 날짜별 수량을 바꿉니다.');
 assert.deepEqual(errors,[]);assert.equal(posts.filter(x=>x.path==='/api/orders'||x.path==='/api/shipment/distribute').length,0);
 if(record){capturedGuide=await rec.stop();stopped=true;const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json','utf8'));const wf=registry.workflows.find(w=>w.id==='shipment-distribution-dates');wf.sourceFiles=['lib/distributionKakaoRequests.js','lib/distributionSalesInboxRefresh.js','pages/shipment/distribute.js','components/shipment/DistributionKakaoFeed.js','components/shipment/DistributionDateEditor.js','components/shipment/DistributionProductTree.js','components/shipment/DistributionDateFilter.js','lib/shipmentDistributionNavigation.js','components/shipment/DistributionInlineDates.js','lib/shipmentInlineDates.js','lib/shipmentDateDisplayUnits.js','lib/shipmentMajorInlineDates.js'];wf.guides[0].status='ready';wf.guides[0].chapters=capturedGuide.chapters;fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');return;}
 // Empty-scope and near-miss regressions are dry-only, after the narrated workflow.
 for(const year of [2025,2026]){await week(year+'-45-03');await page.waitForSelector('[data-testid="distribution-no-order-candidates"]');await click('[data-ai-verify="customer-777"]');await page.waitForNetworkIdle({idleTime:200});await click('[data-ai-verify="add-panel-open"]');await page.waitForSelector('[data-testid="distribution-add-panel"]');await page.type('[data-ai-verify="add-prod-search"]','Honey');await click('[data-ai-verify="add-prod-3513"]');await click('[data-ai-verify="add-panel-close"]');}
 assert.equal(posts.filter(x=>x.path==='/api/orders'||x.path==='/api/shipment/distribute').length,0);
 assert.deepEqual(errors,[]);

 await week('2026-45-01');await click('[data-ai-verify="customer-777"]');await page.waitForSelector('[data-testid="inline-dates-777-3513"] input');
 await select(inline+' select','송이');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-05"]',n=>n.value),'120');
 await fill('2026-11-05','1');assert.equal(await page.$eval(inline+' [data-inline-preview]',n=>n.disabled),true);assert((await page.$eval(inline,n=>n.textContent)).includes('정확히 저장할 수 없는'));await text('날짜 취소');
 await fill('2026-11-05','1.5');assert.equal(await page.$eval(inline+' [data-inline-preview]',n=>n.disabled),true);assert((await page.$eval(inline,n=>n.textContent)).includes('정수로 입력'));await text('날짜 취소');await select(inline+' select','단');
 await fill('2026-11-05','3');await fill('2026-11-09','12');const beforeDatePosts=posts.length;
 await page.keyboard.down('Control');await page.keyboard.press('KeyS');await page.keyboard.up('Control');assert.equal(posts.length,beforeDatePosts);
 await text('출고분배 및 농장정보');assert(await page.$('select[aria-label="업체 출고일 분류"]'),'date draft blocks tab switch');
 staleRead=true;await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('날짜 또는 출고수량이 변경되었습니다.'));assert.equal(await page.$$eval('[role="dialog"] .btn-primary',n=>n.length),0,'stale baseline cannot preview or save');await text('닫기');staleRead=false;stalePack=true;await click('[data-ai-verify="date-edit-777-3513"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent.includes('품목의 단위·입수가 변경되었습니다.'));await text('닫기');stalePack=false;
 await text('날짜 취소');assert.equal(await page.$eval(inline+' input[data-date-inline="2026-11-05"]',n=>Number(n.value)),6);
 await week('2026-45-01');await click('[data-ai-verify="customer-777"]');await page.waitForSelector('[data-distribute-qty="true"]');const qty=await page.$('[data-distribute-qty="true"]');await qty.click({clickCount:3});await qty.type('2');await text('출고분배 및 농장정보');assert.equal(await page.$$eval('[data-ai-verify="customer-777"]',n=>n.length),1,'dirty tab switch blocked');page.once('dialog',d=>d.accept());await click('[data-ai-verify="discard-drafts"]');await text('출고분배 및 농장정보');await page.waitForSelector('[data-testid="distribution-product-list"]');
 axisFixture=true;
 for(const selected of ['01','02','03']){
  await week('2026-45-'+selected);await text('🔍 조회');await page.waitForNetworkIdle({idleTime:200});await click('[data-ai-verify="product-3513"]');await page.waitForSelector('[data-testid="inline-dates-778-3513"]');
  for(const key of [777,778,779])assert.deepEqual(await page.$$eval(`[data-testid="inline-dates-${key}-3513"] [data-subweek-row]`,n=>n.map(e=>e.dataset.subweekRow)),['45-01','45-02','45-03']);
  const only02='[data-testid="inline-dates-778-3513"]';assert.equal(await page.$$eval(only02+' input',n=>n.length),selected==='02'?7:0);assert.equal(await page.$eval(only02+' [data-major-total]',n=>n.textContent),'30');assert.equal(await page.$eval(only02+' [data-subweek-total="45-01"]',n=>n.textContent),'0');
  assert.equal(await page.$$eval('[data-testid="inline-dates-779-3513"] input, [data-testid="inline-dates-779-3513"] button',n=>n.length),0);assert.equal(await page.$$eval('[data-testid="distribution-date-header"]',n=>n.filter(e=>e.getBoundingClientRect().height).length),1);
 }
 await page.screenshot({path:'outputs/common-axis-desktop.png',fullPage:true});
 await page.setViewport({width:390,height:844});await page.waitForSelector('[data-testid="distribution-product-list"]');await page.screenshot({path:'outputs/dual-mobile.png'});
 console.log('PASS dual workflow: favorite hierarchy/disclosure, independent customer, actual date filters/editor/tab2, cross-year empty catalog; synthetic APIs only.');
 }finally{if(rec&&!stopped)await rec.stop().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
