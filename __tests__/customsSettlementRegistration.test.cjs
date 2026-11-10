const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const policy=require('../lib/customsSettlementPlan.cjs'),store=require('../lib/customsSettlementStore.cjs');
const receipt=(id='TEST-001',awb='12312345678',net=100)=>({issuer:'SUNYUL',documentId:id,sourceHash:require('crypto').createHash('sha256').update(id).digest('hex'),awb,date:'2026-08-30',charges:[{code:'HANDLING',net,vat:net/10,total:net+net/10}],total:net+net/10,currency:'CNY',foreignAmount:100,grossWeight:1});
const candidate=(major='35',awb='12312345678')=>({year:'2026',orderWeek:`${major}-01`,awb,matchId:`2026|${major}-01|${awb}`,targetKey:'country|중국|01',currency:'CNY',foreignAmount:100,grossWeight:1});
const job=(receipts,major='35')=>({jobId:'00000000-0000-4000-8000-000000000001',year:'2026',major,status:'REVIEW_READY',files:receipts.map(r=>({sourceHash:r.sourceHash,status:'READY',receipt:r}))});
async function setup(candidates=[candidate()],savedByMajor={}){const api=await import('../lib/customsSettlementRegistration.js'),root=await fs.mkdtemp(path.join(os.tmpdir(),'settlement-register-'));const options={root,loadCandidates:async()=>structuredClone(candidates),loadContext:async(year,major)=>({year,major,candidates:candidates.filter(c=>c.orderWeek.startsWith(major+'-')),saved:structuredClone(savedByMajor[major]||{}),mapping:{country:{HANDLING:{field:'SunYul1_1',basis:'total'}}}})};return {...api,options,root};}
test('same-year exact matching automatically registers typed actual net/gross, without SQL write',async()=>{
  const saved={'35':{'country|중국|01':{SunYul1_1:100}}},before=JSON.stringify(saved),s=await setup([candidate()],saved),j=job([receipt()]);
  const preview=await s.reviewSettlementRegistration(j,s.options);assert.equal(preview.groups[0].plan.patches[0].status,'basis_reconciled');
  const result=await s.registerSettlementJob(j,{...s.options,automatic:true});assert.equal(result.registeredDocuments,1);assert.equal(result.erpWrites,0);assert.equal(JSON.stringify(saved),before);
  assert.equal((await store.readLedger(s.root,2026,35)).values['country|중국|01'].SunYul1_1,110);
});
test('real DB difference and ItemCount require confirmation, then file actual wins without changing DB',async()=>{
  const s=await setup([candidate()],{'35':{'country|중국|01':{SunYul1_1:0}}}),j=job([receipt()]);
  assert.equal((await s.registerSettlementJob(j,{...s.options,automatic:true})).registeredDocuments,0);
  const review=await s.reviewSettlementRegistration(j,s.options);assert.equal(review.rows[0].status,'confirmation');
  await assert.rejects(s.registerSettlementJob(j,{...s.options,reviewDigest:review.reviewDigest,confirmed:false}),/다시 확인/);
  const result=await s.registerSettlementJob(j,{...s.options,selectedHashes:[j.files[0].sourceHash],reviewDigest:review.reviewDigest,confirmed:true});assert.equal(result.registeredDocuments,1);
});
test('active exact AWB outside ZIP scope is proposed and requires explicit destination confirmation',async()=>{
  const s=await setup([candidate('35')]),j=job([receipt()],'36');assert.equal((await s.registerSettlementJob(j,{...s.options,automatic:true})).registeredDocuments,0);
  const r=await s.reviewSettlementRegistration(j,s.options);assert.equal(r.rows[0].major,'35');assert.equal(r.rows[0].status,'review');
  const links={[j.files[0].sourceHash]:candidate().matchId},review=await s.reviewSettlementRegistration(j,{...s.options,links});
  const result=await s.registerSettlementJob(j,{...s.options,links,selectedHashes:[j.files[0].sourceHash],reviewDigest:review.reviewDigest,confirmed:true});assert.equal(result.results[0].major,'35');
  await assert.rejects(fs.stat(path.join(s.root,'2026-36.json')),/ENOENT/);
});
test('combined AWB link requires same currency plus exact sum of foreign amount and GW',async()=>{
  const a=receipt(),b={...receipt('TEST-002','12399999999'),foreignAmount:200,grossWeight:2},c={...candidate(),foreignAmount:300,grossWeight:3},s=await setup([c]),j=job([a,b]);
  assert.equal((await s.registerSettlementJob(j,{...s.options,automatic:true})).registeredDocuments,1);
  const links={[b.sourceHash]:c.matchId},selectedHashes=[b.sourceHash],review=await s.reviewSettlementRegistration(j,{...s.options,links,selectedHashes});assert.equal(review.rows[1].matchProof.type,'MANUAL_COMBINED_AMOUNT_AND_GW');
  const result=await s.registerSettlementJob(j,{...s.options,links,selectedHashes,reviewDigest:review.reviewDigest,confirmed:true});assert.equal(result.registeredDocuments,1);assert.equal((await store.readLedger(s.root,2026,35)).values[c.targetKey].SunYul1_1,220);
  const bad=await setup([{...c,grossWeight:4}]),r=await bad.reviewSettlementRegistration(j,{...bad.options,links});assert.equal(r.rows[1].status,'review');assert.match(r.rows[1].reason,/동시 검산/);
});
test('unchecked receipt stays unregistered and same declaration across changed scope is not duplicated',async()=>{
  const a=receipt(),b=receipt('TEST-002'),s=await setup(),j=job([a,b]),selectedHashes=[a.sourceHash],r=await s.reviewSettlementRegistration(j,{...s.options,selectedHashes});
  const result=await s.registerSettlementJob(j,{...s.options,selectedHashes,reviewDigest:r.reviewDigest,confirmed:true});assert.equal(result.registeredDocuments,1);assert.equal((await store.readLedger(s.root,2026,35)).documents.length,1);
  const again=await s.registerSettlementJob(job([a],'36'),{...s.options,automatic:true});assert.equal(again.registeredDocuments,0);assert.equal((await s.reviewSettlementRegistration(job([a],'36'),s.options)).rows[0].major,'35');
});
test('new actual source replaces whole split group once while preserving all file parts',async()=>{
  const {settlementCountryRow,settlementColombiaRow}=await import('../lib/customsSettlementEvidence.js');
  const original={SunYul1_1:900,SunYul1_2:99},ledger={values:{'country|중국|01':{SunYul1_1:110,SunYul1_2:220,SunYul1_3:330},'colombia|35-01':{ActualQuarantineAgencyFee:0,HandlingFee:27000}}};
  const row=settlementCountryRow(original,ledger,'중국');assert.equal(row.SunYul1,660);assert.equal(row.SunYul1_1,110);assert.equal(original.SunYul1_1,900);
  assert.equal(settlementColombiaRow({ItemCount:4},ledger,'35-01').ActualQuarantineAgencyFee,0);
});
test('AWB normalizes only separators, never guesses letters; prior year does not match',async()=>{
  assert.equal(policy.awbOf('180- 12345678\r\n'),'18012345678');assert.equal(policy.awbOf('18O-12345678'),null);
  const c={...candidate(),year:'2025'},s=await setup([c]),r=await s.reviewSettlementRegistration(job([receipt()]),s.options);
  // The real loader is selected-year scoped; the orchestrator independently enforces it too.
  assert.notEqual(r.rows[0].status,'auto');
});
test('stored integer bit flip, document fingerprint change, and impossible calendar date fail closed',async()=>{
  const s=await setup(),j=job([receipt()]);await s.registerSettlementJob(j,{...s.options,automatic:true});
  const filename=path.join(s.root,'2026-35.json'),ledger=JSON.parse(await fs.readFile(filename));
  const changed=structuredClone(ledger);changed.values['country|중국|01'].SunYul1_1++;
  assert.throws(()=>store.validateLedger(changed,2026,35),/totals|digest/);
  const docChanged=structuredClone(ledger);docChanged.documents[0].foreignAmount++;assert.throws(()=>store.validateLedger(docChanged,2026,35),/digest/);
  assert.throws(()=>policy.validateReceipt({...receipt(),date:'2026-02-30'}),/존재하는/);
});
test('a corrupt external ledger cannot be swallowed into zero report costs',async()=>{
  const {loadSettlementEvidence}=await import('../lib/customsSettlementEvidence.js'),{withErpReadContext}=await import('../lib/erpReadContext.js');
  await assert.rejects(withErpReadContext({queryFn:async()=>({recordset:[]}),externalEvidence:{'customs-settlement:2026:35':{version:1,year:'2025'}}},async()=>{await loadSettlementEvidence(2026,35).catch(()=>({values:{}}));}),/전체 변경을 취소/);
});
test('standalone customs major input never applies shipment blur formatting or crosses selected year',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../pages/sales/customs-clearance.js'),'utf8');
  const start=source.indexOf('export function standaloneCustomsScope'),end=source.indexOf('// SSR',start);
  const scope=new Function(`${source.slice(start,end).replace('export ','')};return standaloneCustomsScope;`)();
  for(const input of ['36','36-01','2026-36-01'])assert.deepEqual(scope('2026',input),{year:'2026',week:input==='36'?'36':'36-01'});
  assert.deepEqual(scope('2025','2025-36-04'),{year:'2025',week:'36-04'});
  assert.deepEqual(scope('2026',' 6 '),{year:'2026',week:'06'});
  for(const [year,week] of [['2026','2025-36-01'],['2025','2026-36-01'],['','36'],['20260','36'],['2026',''],['2026','00'],['2026','53'],['2026','36-00'],['2026','36-05'],['2026','36-1'],['2026','2026-36'],['2026','36x']])assert.equal(scope(year,week),null,`${year}/${week}`);
  const ssrStart=source.indexOf('export async function getServerSideProps'),ssrEnd=source.indexOf('export default',ssrStart);
  const ssr=new Function('getCurrentWeek',`${source.slice(ssrStart,ssrEnd).replace('export ','')};return getServerSideProps;`)(()=> '2026-45-01');
  for(const query of [{year:'2025',week:'36-01'},{year:'2026',week:'2025-36-01'},{year:'bad',week:'53'}]){
    const {props}=await ssr({query});assert.equal(props.initialSelectedYear,query.year);assert.equal(props.initialSelectedWeek,query.week);
    assert.equal(Boolean(scope(props.initialSelectedYear,props.initialSelectedWeek)),query.year==='2025');
  }
  assert.doesNotMatch(source,/useWeekInput\(|weekInput\.props/);
  assert.match(source,/scope \? <CustomsClearancePanel[^\n]+week=\{scope.week\} year=\{scope.year\}/);
  const embedded=await fs.readFile(path.join(__dirname,'../pages/sales/profit-report.js'),'utf8');
  assert.match(embedded,/aria-label="보고서 차수"[^\n]+onChange=[^\n]+weekInput.setValue\(e.target.value\)/);
});

test('actual panel shows entire receipt-covered split group and preserves raw DB parts when another input saves',async()=>{
  const ui=await import('../lib/customsSettlementPresentation.js'),source=await fs.readFile(path.join(__dirname,'../components/CustomsClearancePanel.js'),'utf8');
  const fieldKeys=['SunYul2_1','SunYul2_2','SunYul2_3','GW1'],countryEdits={'합성국가':{GW1:'21',SunYul2_2:'999'}};
  const start=source.indexOf('const countryValue = (row, field) =>'),end=source.indexOf('const setCountryEdit',start);
  const countryValue=new Function('countryEdits','settlementCoversCountryField','vatInclusiveToNet',`${source.slice(start,end)};return countryValue;`)(countryEdits,ui.settlementCoversCountryField,x=>x/1.1);
  const outStart=source.indexOf('const countryOut = (row) =>'),outEnd=source.indexOf('// 콜롬비아도',outStart);
  const countryOut=new Function('COUNTRY_FIELD_KEYS','countryEdits','countryValue','preserveSettlementCountryField','vatNetToInclusive',`${source.slice(outStart,outEnd)};return countryOut;`)(fieldKeys,countryEdits,countryValue,ui.preserveSettlementCountryField,x=>x*1.1);
  const saved={SunYul2_1:100,SunYul2_2:200,SunYul2_3:null,GW1:20},before=JSON.stringify(saved),row={category:'합성국가',saved,settlement:{values:{SunYul2_1:330}},effectiveRow:{SunYul2_1:330}};
  assert.deepEqual(fieldKeys.slice(0,3).map(f=>countryValue(row,f)),[330,'','']);
  assert.deepEqual(countryOut(row),{SunYul2_1:100,SunYul2_2:200,GW1:'21'});
  assert.equal(JSON.stringify(saved),before);assert.equal(fieldKeys.slice(0,3).reduce((n,f)=>n+Number(countryValue(row,f)||0),0),330);
  assert.match(source,/readOnly=\{settlementCoversCountryField\(row,field\)\}/);
});
test('automatic panel source refresh preserves all drafts; explicit loads reset and stale scope/sequence responses cannot win',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../components/CustomsClearancePanel.js'),'utf8'),start=source.indexOf('const load = useCallback('),end=source.indexOf('const refreshSettlementSource',start);
  const loadScope={current:'2026|35'},loadSequence={current:0},pending=[],state={drafts:3,data:null,errors:[],loading:false};
  const deps={useCallback:fn=>fn,week:'35',year:'2026',loadScope,loadSequence,
    fetch:()=>new Promise(resolve=>pending.push(data=>resolve({json:async()=>data}))),setLoading:v=>{state.loading=v;},setError:v=>state.errors.push(v),setMessage:()=>{},setData:v=>{state.data=v;},setCountryEdits:()=>{state.drafts--;},setColombiaEdits:()=>{state.drafts--;},setRateEdits:()=>{state.drafts--;}};
  const load=new Function(...Object.keys(deps),`${source.slice(start,end)};return load;`)(...Object.values(deps));
  const auto=load({preserveEdits:true});pending.shift()({success:true,id:'auto'});await auto;assert.equal(state.drafts,3);
  const old=load({preserveEdits:true}),newer=load({preserveEdits:true});pending[1]({success:true,id:'new'});await newer;pending[0]({success:true,id:'old'});await old;pending.splice(0);assert.equal(state.data.id,'new');
  const wrongScope=load({preserveEdits:true});loadScope.current='2027|35';pending.shift()({success:true,id:'wrong-year'});await wrongScope;assert.equal(state.data.id,'new');assert.equal(state.drafts,3);
  loadScope.current='2026|35';const explicit=load();pending.shift()({success:true,id:'explicit'});await explicit;assert.equal(state.drafts,0);
  assert.match(source,/refreshSettlementSource=useCallback\(\(\)=>load\(\{preserveEdits:true\}\)/);
});
test('same-scope old ZIP poll cannot overwrite a newer ZIP job',async()=>{
  const {readSettlementResponse}=await import('../lib/customsSettlementHttp.js');
  const source=await fs.readFile(path.join(__dirname,'../components/CustomsSettlementUpload.js'),'utf8'),start=source.indexOf('async function refresh('),end=source.indexOf('\n  useEffect',start),sequence={current:0},active={current:'2026|35'},pending=[],accepted=[];
  const deps={scope:'2026|35',sequence,active,readSettlementResponse,fetch:()=>new Promise(resolve=>pending.push(jobId=>resolve({ok:true,status:200,json:async()=>({success:true,job:{jobId}})}))),accept:d=>accepted.push(d.job.jobId)};
  const refresh=new Function(...Object.keys(deps),`${source.slice(start,end)};return refresh;`)(...Object.values(deps));
  const old=refresh('old');sequence.current++;const latest=refresh('new');pending[1]('new');await latest;pending[0]('old');await old;assert.deepEqual(accepted,['new']);
});
test('HTTP 2MiB upload rejected with proxy HTML yields safe 413 guidance without response disclosure',async()=>{
  const {readSettlementResponse}=await import('../lib/customsSettlementHttp.js'),http=require('node:http');
  const marker='PRIVATE_PROXY_BODY_DO_NOT_DISPLAY',server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(413,{'Content-Type':'text/html'});res.end(`<html>${marker}${'x'.repeat(2*1024*1024)}</html>`);});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(2*1024*1024)});await assert.rejects(readSettlementResponse(response),error=>error.statusCode===413&&/25MiB|서버 허용 한도/.test(error.message)&&!error.message.includes(marker)&&!/[<>]|Unexpected token/.test(error.message));}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});
test('settlement HTTP parser handles login/gateway/non-JSON/valid JSON without raw bodies or false success',async()=>{
  const {readSettlementResponse}=await import('../lib/customsSettlementHttp.js');
  for(const status of [401,403,502,503,504]){
    await assert.rejects(readSettlementResponse({status,ok:false,json:async()=>{throw Error('PRIVATE_HTML_BODY');}}),error=>error.statusCode===status&&!/PRIVATE|HTML_BODY/.test(error.message)&&(status<500?/로그인/.test(error.message):/접수|작업 상태/.test(error.message)));
  }
  const expected={success:true,job:{jobId:'fixture'}};assert.equal(await readSettlementResponse({status:200,ok:true,json:async()=>expected}),expected);
  await assert.rejects(readSettlementResponse({status:200,ok:true,json:async()=>null}),/응답을 확인하지 못했습니다/);
  await assert.rejects(readSettlementResponse({status:400,ok:false,json:async()=>({success:false,error:'정산서 원본을 확인하세요.'})}),/정산서 원본/);
});
