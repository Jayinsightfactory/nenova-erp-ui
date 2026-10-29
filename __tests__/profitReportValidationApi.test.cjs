const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
(async()=>{
 const {outputScope}=await import('../lib/profitRangeOutput.mjs');
 const source=fs.readFileSync('pages/api/sales/profit-report-validation.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export default withAuth(','return withAuth(');
 let writes=0,reads=0,fail=false,cacheClears=0;
 const frozen={orderYear:'2026',major:'38',rows:[],totals:{},audit:{issues:[]}};
 const dependencies={withAuth:f=>f,outputScope,
  loadReportData:async()=>{reads++;if(fail)throw Error('READ_FAILED');return frozen;},
  loadWeeklyReportPayload:async()=>{reads++;return frozen;},
  collectIndependentAudit:async()=>({integrity:{status:'STABLE_OBSERVED',sourceHash:'same'},weeks:[{major:'38',sqlLineage:{}}]}),
  readIndependentSources:async()=>({hash:'same'}),
  materializeProfitPayload:x=>x,profitDisplayCalculation:x=>x,
  applyTemplateDutyToReport:async x=>({...x,templateDuty:{approvedEstimate:true,version:'fixture'}}),
  clearTemplateDutyCache:()=>{cacheClears++;},
  auditProfitFormulas:raw=>{assert.equal(raw.templateDuty,undefined);return{status:'MATCH'};},auditReportSqlLineage:raw=>{assert.equal(raw.templateDuty,undefined);return{status:'MATCH'};},
  loadProfitReportSourceReconciliation:async({report})=>{assert.equal(report.templateDuty,undefined);return{status:'matched'};},
  buildProfitValidationGate:args=>{assert.equal(args.rawLive.templateDuty,undefined);assert.equal(args.live.templateDuty.version,'fixture');return{state:'held',year:args.year,major:args.major,displayAudit:args.display.audit};},
 };
 const handler=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
 async function call(method,query){const res=new EventEmitter();res.setHeader=(k,v)=>{res.headers={...res.headers,[k]:v};};res.status=n=>{res.statusCode=n;return res;};res.json=body=>{res.writableEnded=true;res.body=body;return res;};await handler({method,query},res);return res;}
 let res=await call('POST',{year:'2026',week:'38'});assert.equal(res.statusCode,405);assert.equal(reads,0);
 res=await call('GET',{week:'38'});assert.equal(res.statusCode,400);assert.equal(reads,0);
 res=await call('GET',{year:['2026','2025'],week:'38'});assert.equal(res.statusCode,400);
 res=await call('GET',{year:'2026',week:'38'});assert.equal(res.statusCode,200);assert.equal(res.body.state,'held');assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.body.displayAudit,frozen.audit);assert.equal(reads,2);assert.equal(cacheClears,1,'explicit validation clears stale duty cache after baseline capture');
 fail=true;const oldError=console.error;console.error=()=>{};try{res=await call('GET',{year:'2026',week:'38'});}finally{console.error=oldError;}assert.equal(res.statusCode,500);assert.equal(res.body.state,'held');assert.equal(writes,0);
 assert.equal(frozen.rows.length,0);assert.equal(frozen.audit.issues.length,0);
 let timeout,finishAudit,responses=0;
 const delayed={...dependencies,setTimeout:f=>{timeout=f;return 1;},clearTimeout:()=>{},collectIndependentAudit:()=>new Promise(r=>{finishAudit=r;})};
 const delayedHandler=new Function(...Object.keys(delayed),source)(...Object.values(delayed));
 const slow=new EventEmitter();slow.setHeader=()=>{};slow.status=n=>{slow.statusCode=n;return slow;};slow.json=body=>{responses++;slow.writableEnded=true;slow.body=body;};
 const pending=delayedHandler({method:'GET',query:{year:'2026',week:'38'}},slow);
 timeout();assert.equal(slow.statusCode,503);assert.equal(slow.body.state,'held');
 finishAudit({integrity:{},weeks:[]});await pending;assert.equal(responses,1,'late completion cannot overwrite timeout with success');
 console.log('profit validation API: GET/400/405/500 fail-closed, audit binding and preserved inputs passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
