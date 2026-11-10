// Real UI, production policy with synthetic API/isolated temp file source, no SQL.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core'),JSZip=require('jszip');
const {createWorkflowGuideRecorder}=require('./lib/workflow-guide-recorder.cjs');
const dry=process.argv.includes('--dry-run');
async function main(){
  fs.mkdirSync('.verify',{recursive:true});const registry=JSON.parse(fs.readFileSync('config/workflow-guides.json')),workflow=registry.workflows.find(w=>w.id==='customs-settlement-zip');
  const reg=await import('../lib/customsSettlementRegistration.js'),root=await fsp.mkdtemp(path.join(os.tmpdir(),'customs-guide-source-'));
  const make=(id,awb)=>({issuer:'SUNYUL',documentId:id,sourceHash:crypto.createHash('sha256').update(id).digest('hex'),awb,date:'2026-08-30',charges:[{code:'DUTY',net:0,vat:0,total:1200},{code:'IMPORT_VAT',net:0,vat:0,total:5000},{code:'HANDLING',net:27000,vat:2700,total:29700},{code:'QUARANTINE_AGENCY',net:40000,vat:4000,total:44000}],total:79900});
  const receipts=[make('TEST-001','12312345678'),make('TEST-002','12399999999')],candidates=[{year:'2026',orderWeek:'35-01',awb:receipts[0].awb,targetKey:'country|태국|01'},{year:'2026',orderWeek:'34-01',awb:receipts[1].awb,targetKey:'country|미국|01'}].map(c=>({...c,matchId:`2026|${c.orderWeek}|${c.awb}`}));
  const options={root,loadCandidates:async()=>candidates,loadContext:async(year,major)=>({year,major,candidates:candidates.filter(c=>c.orderWeek.startsWith(major+'-')),saved:{},mapping:{country:{DUTY:{field:'Customs1_1',basis:'total'},HANDLING:{field:'SunYul1_1',basis:'total'},QUARANTINE_AGENCY:{field:'SunYul1_1',basis:'total'}}}})};
  const complete={jobId:'00000000-0000-4000-8000-000000000001',year:'2026',major:'35',status:'REVIEW_READY',total:3,completed:3,files:[...receipts.map(receipt=>({sourceHash:receipt.sourceHash,status:'READY',receipt})),{sourceHash:'c'.repeat(64),status:'REVIEW',hint:{awb:'12388888888',part:'2'},error:'첫 페이지 판독 보류 — 뒤 페이지 자동 판독 안 함'}]};
  let uploadedAt=null,automatic=false;const automaticResult=async()=>{if(!automatic){await reg.registerSettlementJob(complete,{...options,automatic:true});automatic=true;complete.registration={state:'DONE'};}return {success:true,job:complete,worker:{connected:true},review:await reg.reviewSettlementRegistration(complete,options)};};
  const zip=new JSZip();zip.file('연습용 정산서.pdf','%PDF-synthetic-only');fs.writeFileSync('.verify/customs-guide-synthetic.zip',await zip.generateAsync({type:'nodebuffer'}));
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const base=`http://localhost:${port}`,secret=crypto.randomUUID(),log=fs.openSync('.verify/customs-guide-server.log','w');
  const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret,PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED:'1'},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
  let browser,page,rec,stopped=false;const errors=[];let sourceReads=0;
  try{
    for(let n=0;n<120;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===119)throw Error('Guide server startup failed');await new Promise(r=>setTimeout(r,1000));}
    browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
    const user={userId:'guide',userName:'연습 담당자',authority:1,deptName:'경영지원',accountActive:true};await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'1h'}),url:base});
    await page.setRequestInterception(true);page.on('request',async request=>{try{
      const url=new URL(request.url());if(url.origin!==base)return request.abort();if(!url.pathname.startsWith('/api/'))return request.continue();let data={success:true,user,items:[],rows:[],data:[],countries:[],colombia:[],rates:{},autoGw:{},activeCategories:[]};
      if(url.pathname==='/api/sales/customs-clearance'){
        sourceReads++;const saved={SunYul1_1:20000,SunYul1_2:47000,SunYul1_3:null,GW1:0,GW2:0};
        data={...data,major:'35',orderYear:'2026',activeCategories:['태국'],countries:[{category:'태국',saved,effectiveRow:automatic?{GW1:0,GW2:0,Customs1_1:1200,SunYul1_1:73700}:saved,...(automatic?{settlement:{values:{Customs1_1:1200,SunYul1_1:73700}}}:{}),weightSource:{},worldFreightAuto:{},total:automatic?68200:67000/1.1,totalSource:automatic?'sun_yul_settlement_file':'saved'}]};
      }
      if(url.pathname==='/api/sales/customs-settlement'){
        const body=JSON.parse(request.postData()||'{}');
        if(body.action==='upload'){uploadedAt=Date.now();data={success:true,job:automatic?complete:{...complete,status:'QUEUED',completed:0,files:complete.files.map(f=>({...f,status:'QUEUED',receipt:undefined}))}};}
        else if(body.action==='preview')data={success:true,review:await reg.reviewSettlementRegistration(complete,{...options,links:body.links,selectedHashes:body.selectedHashes})};
        else if(body.action==='apply'){const result=await reg.registerSettlementJob(complete,{...options,links:body.links,selectedHashes:body.selectedHashes,reviewDigest:body.reviewDigest,confirmed:body.confirmed});data={success:true,result,review:await reg.reviewSettlementRegistration(complete,options),message:'실제 정산 원천 등록 완료. 저장된 매출자료는 대상 차수에서 직접 갱신하세요.'};}
        else if(body.action==='resume'||automatic||Date.now()-uploadedAt>500)data=await automaticResult();
        else data={success:true,job:{...complete,status:'QUEUED',completed:0,files:complete.files.map(f=>({...f,status:'QUEUED',receipt:undefined}))},worker:{connected:true}};
      }else assert.equal(request.method(),'GET','No real writes allowed');
      await request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
    }catch(e){errors.push(e.message);if(!request.isInterceptResolutionHandled())await request.abort().catch(()=>{});}});
    await page.goto(base+'/sales/customs-clearance?year=2026&week=35',{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('[aria-label="선율 정산 ZIP 연결"] input[type=file]');assert.equal(await page.$eval('[aria-label=연도]',n=>n.value),'2026');assert.deepEqual(errors,[],'SSR/client selection must hydrate identically');
    rec=dry?{chapter(){},caption:async()=>{},pause:async()=>{},stop:async()=>({chapters:[]})}:await createWorkflowGuideRecorder(page,{workflowId:workflow.id,guideId:'support',title:workflow.title,sourceFiles:workflow.sourceFiles,fixtureOnly:true,ffmpegPath:process.env.FFMPEG_PATH||'ffmpeg',ffprobePath:process.env.FFPROBE_PATH||'ffprobe'});
    const hold=async text=>{await rec.caption(text);if(!dry)await rec.pause(6500);};
    const click=async text=>{const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text),text);assert(await h.asElement(),text);await h.evaluate(n=>n.scrollIntoView({block:'center'}));await h.asElement().click();await h.dispose();};
    rec.chapter('upload','ZIP 하나로 판독·확실건 자동등록');await hold('연도와 차수를 확인하고 ZIP을 올립니다. 각 PDF 첫 페이지만 판독합니다.\n정확한 AWB·귀속·금액이 검증된 정산서는 버튼을 반복 누르지 않아도 자동등록됩니다.');await (await page.$('[aria-label="선율 정산 ZIP 연결"] input[type=file]')).uploadFile(path.resolve('.verify/customs-guide-synthetic.zip'));await page.waitForFunction(()=>document.body.textContent.includes('원천 등록 완료 1건'));await hold('정상 문서는 자동등록됐고 아래 입력표도 다시 불러왔습니다.\n등록 완료와 저장된 매출자료 갱신 필요를 구분해서 보여줍니다.');assert(sourceReads>=2,'Automatic completion refreshes the source panel');
    await page.waitForFunction(()=>document.querySelectorAll('[data-customs-focus-key="태국"] input[readonly]').length===6);
    const actualParts=await page.$$eval('[data-customs-focus-key="태국"] input[readonly]',els=>els.map(e=>e.value).filter(Boolean));assert.deepEqual(actualParts,['1200','73700'],'Entire source-covered group uses effective values; old DB second part must not reappear');
    await page.$eval('[data-customs-focus-key="태국"]',node=>node.scrollIntoView({block:'center'}));await hold('아래 통관 입력표에도 검산한 실제 원천이 표시됩니다.\n연결된 분할 그룹 전체는 읽기 전용이며 이전 DB 분할값을 중복 합산하지 않습니다.');await page.$eval('[aria-label="선율 정산 ZIP 연결"]',node=>node.scrollIntoView({block:'start'}));
    rec.chapter('review','타차수·판독 보류만 확인');await hold('ZIP 이름과 실제 입고 차수가 다른 문서는 자동 이동하지 않습니다.\n판독 보류는 별도 건수로 남기며 원문 AWB·신고번호를 확인합니다.');await page.select('[aria-label="정산서 2 입고 선택"]',candidates[1].matchId);await click('검토 선택건 귀속·금액 재검증');await page.waitForFunction(()=>document.body.textContent.includes('2026년 34차 실제 원천'));
    rec.chapter('link','검토건 귀속·실제 원천 우선 확인');await hold('실제 귀속 차수와 금액을 검토합니다. 기존 DB 원문은 그대로 보존합니다.\n차액이 있으면 명시 확인한 실제 정산 원천을 계산에 우선 사용합니다.');await page.click('[aria-label="검토 원천 우선 반영 확인"]');await click('확인한 검토건 등록');await page.waitForFunction(()=>document.body.textContent.includes('원천 등록 완료 2건'));
    rec.chapter('preserve','중복 방지·과거 계산본 직접 갱신');await hold('등록 대상은 34차와 35차로 구분됩니다. 저장·확정 계산본은 바뀌지 않습니다.\n매출자료가 과거 저장본이면 해당 차수에서 직접 계산본 생성·갱신을 실행합니다.');await page.$eval('input[type=file]',n=>{n.value='';});await (await page.$('[aria-label="선율 정산 ZIP 연결"] input[type=file]')).uploadFile(path.resolve('.verify/customs-guide-synthetic.zip'));await page.waitForFunction(()=>document.body.textContent.includes('원천 등록 완료 2건'));await hold('같은 ZIP을 다시 올려도 신고번호별로 중복 등록하지 않습니다.\n정산서가 증명하지 않는 창고료·운송·한국방역까지 실제 비용으로 인증하지 않습니다.');
    assert.deepEqual(errors,[]);await page.screenshot({path:'.verify/customs-settlement-guide.png'});const result=await rec.stop();stopped=true;
    if(!dry){workflow.guides[0].status='ready';workflow.guides[0].chapters=result.chapters;fs.writeFileSync('config/workflow-guides.json',JSON.stringify(registry,null,2)+'\n');}console.log(JSON.stringify({result:'PASS',dry,productionWrites:0,allApisSynthetic:true,sourcePanelRefreshes:sourceReads}));
  }finally{if(rec&&!stopped){console.log(JSON.stringify({errors,alerts:await page?.$$eval('[role=alert]',els=>els.map(e=>e.textContent))}));await page?.screenshot({path:'.verify/customs-guide-failure.png'});await rec.stop().catch(()=>{});}await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
