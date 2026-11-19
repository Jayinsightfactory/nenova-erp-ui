const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const m=new Function(fs.readFileSync('lib/estimateLedgerReview.js','utf8').replace(/export /g,'')+';return {readEstimateLedgerReview,reviewSnapshot,compareReviewCandidate,REVIEW_SOURCE_SQL,REVIEW_ESTIMATES_SQL};')();
const sql={NVarChar:'string',Int:'int'};
test('invalid scope/key rejected before DB and cross-year source cannot leak',async()=>{
 for(const input of [{},{year:2026,week:45,deductionKey:0},{year:2026,week:'2025-45',deductionKey:1},{year:2026,week:45,deductionKey:2147483648}])await assert.rejects(()=>m.readEstimateLedgerReview(()=>assert.fail('DB called'),sql,input),e=>e.statusCode===400);
 for(const year of [2025,2026]){let calls=0;await assert.rejects(()=>m.readEstimateLedgerReview(async(text,params)=>{calls++;assert.equal(params.year.value,String(year));return {recordset:[]};},sql,{year,week:45,deductionKey:1}),e=>e.statusCode===404);assert.equal(calls,1);}
 assert.match(m.REVIEW_SOURCE_SQL,/COALESCE\(d.AppliedOrderYear,d.OrderYear\)=@year/);
 assert.match(m.REVIEW_ESTIMATES_SQL,/sm.CustKey=@cust AND e.ProdKey=@prod/);
});
test('snapshots expose only business fields and malformed history stays unknown',()=>{
 assert.equal(m.reviewSnapshot('bad'),null);assert.equal(m.reviewSnapshot('[]'),null);
 assert.deepEqual(m.reviewSnapshot(JSON.stringify({quantity:0,note:'',managerName:'private',password:'secret'})),{quantity:0,note:''});
});
test('different quantity/unit/price/owner and deleted master are warnings',()=>{
 const s={DeductionKey:1,Quantity:10,SourceUnit:'스팀(대)',EstimateCost:100};const e={Quantity:-10,Unit:'송이',Cost:100};
 assert.match(m.compareReviewCandidate(s,e),/확정 아님/);
 for(const [patch,expected] of [[{Quantity:-20},/수량 다름/],[{Unit:'단'},/단위 다름/],[{Cost:0},/단가 다름/],[{OwnerKey:2},/다른 신고/],[{MasterDeleted:1},/삭제된/]])assert.match(m.compareReviewCandidate(s,{...e,...patch}),expected);
});
test('original CREATE, current scope, negative other-number candidates and failures',async()=>{
 const source={DeductionKey:1,OrderYear:2025,CustKey:31,ProdKey:7,Quantity:10,SourceUnit:'단',EstimateKey:99};
 const history=[{HistoryKey:1,ActionType:'CREATE',AfterJson:'{"quantity":10,"orderYear":2025}'},{HistoryKey:2,ActionType:'REGISTER_ESTIMATE',AfterJson:'{"estimateKey":99}'}];
 const estimates=[{EstimateKey:99,InCurrentScope:1,Quantity:-10},{EstimateKey:100,InCurrentScope:1,Quantity:10},{EstimateKey:101,InCurrentScope:0,Quantity:-20}];let calls=0;
 const q=async(text,params)=>{calls++;if(text.includes('sys.columns'))return {recordset:[]};assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|EXEC)\s/i);if(calls===1)return {recordset:[source]};if(calls===2)return {recordset:history};assert.equal(params.sourceYear.value,'2025');assert.equal(params.cust.value,31);return {recordset:estimates};};
 const result=await m.readEstimateLedgerReview(q,sql,{year:2026,week:45,deductionKey:1});assert.equal(result.original.quantity,10);assert.equal(result.history.length,2);assert.equal(result.current.length,2);assert.deepEqual(result.candidates.map(e=>e.EstimateKey),[101]);
 await assert.rejects(()=>m.readEstimateLedgerReview(async()=>{throw Error('offline');},sql,{year:2026,week:45,deductionKey:1}),/offline/);
});

test('GET detail dispatch stays authenticated and returns scoped not-found instead of successful empty detail',async()=>{
 const source=fs.readFileSync('pages/api/estimate/ledger-alerts.js','utf8').replace(/^import .*;\s*$/gm,'').replace('export default ','return ');
 let authenticated=false,calls=0;const handler=new Function('withAuth','query','sql','readEstimateLedgerAlerts','readEstimateLedgerReview','estimateChangeHistory',source)(fn=>{authenticated=true;return fn;},()=>{},sql,()=>assert.fail('wrong dispatch'),async(q,s,input)=>{calls++;assert.equal(input.deductionKey,'10');const e=Error('not in scope');e.statusCode=404;throw e;},{calendar:async()=>({status:'checked',rows:[]})});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',query:{deductionKey:'10'}},res);assert.equal(res.statusCode,405);assert.equal(calls,0);
 await handler({method:'GET',query:{year:'2025',week:'45',deductionKey:'10'}},res);assert(authenticated);assert.equal(calls,1);assert.equal(res.statusCode,404);assert.equal(res.body.success,false);assert.equal(res.headers['Cache-Control'],'no-store');
});
