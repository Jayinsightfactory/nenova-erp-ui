// Observe existing browser traffic only. Never fetch, retry or log URLs/headers/body/errors.
const CODES=new Set(['PROFIT_SOURCES_CHANGED','PROFIT_CALENDAR_INVALID','PROFIT_INVOICE_FENCE_INCOMPLETE',
 'PROFIT_HISTORICAL_SNAPSHOT_REQUIRED','PROFIT_STORED_CALCULATION_REQUIRED','APPROVAL_REPORT_SOURCE_FAILED',
 'APPROVAL_EXTERNAL_EVIDENCE_REQUIRED','PROFIT_SNAPSHOT_INCOMPLETE']);
const year=value=>/^20\d{2}$/.test(String(value))?String(value):null;
const week=value=>/^\d{1,2}$/.test(String(value))&&+value>=1&&+value<=53?String(+value).padStart(2,'0'):null;
function observeProfitUiReads(page,{origin,selected,log=console.log,clock=Date.now}){
 const started=clock(),byRequest=new WeakMap(),records=[];
 const emit=value=>log(JSON.stringify({profitUiReadDiagnostic:true,...value}));
 const same=scope=>scope.year===selected.year&&scope.week===selected.week;
 function identify(req){
  let url;try{url=new URL(req.url());}catch{return null;}
  if(url.origin!==origin)return null;
  const output=url.pathname==='/api/sales/profit-report-output';
  if(!output&&url.pathname!=='/api/sales/profit-report')return null;
  const kind=output?'output':url.searchParams.get('context')==='1'?'context':url.searchParams.has('period')?'period':url.searchParams.has('stockPrices')?'stock-reference':'main';
  const scope={year:year(url.searchParams.get('year')),week:week(url.searchParams.get('week'))};
  return {id:records.length+1,kind,scope,scopeMatches:same(scope),httpStatus:null,bodyCode:null,bodyState:null,basis:null,finished:false,failed:false,aborted:false,startedAt:clock()};
 }
 page.on('request',req=>{const record=identify(req);if(!record)return;byRequest.set(req,record);records.push(record);emit({event:'request',id:record.id,kind:record.kind,scope:record.scope,scopeMatches:record.scopeMatches,elapsedMs:clock()-started});});
 page.on('requestfinished',req=>{const r=byRequest.get(req);if(r)r.finished=true;});
 page.on('requestfailed',req=>{const r=byRequest.get(req);if(!r)return;r.failed=true;r.aborted=req.failure?.()?.errorText==='net::ERR_ABORTED';emit({event:'requestfailed',id:r.id,kind:r.kind,aborted:r.aborted,elapsedMs:clock()-r.startedAt});});
 async function response(res){
  const r=byRequest.get(res.request());if(!r)return null;
  r.httpStatus=res.status();
  emit({event:'response_headers',id:r.id,kind:r.kind,httpStatus:r.httpStatus,elapsedMs:clock()-r.startedAt});
  if(r.kind==='output'&&r.httpStatus===200)return null;
  let body=null;
  try{body=await res.json();r.bodyState=body?.success===true?'success':body?.success===false?'api_error':'other_json';}
  catch{r.bodyState='unreadable';}
  r.bodyCode=CODES.has(body?.code)?body.code:null;
  r.basis=['stored','live','confirmed'].includes(body?.financialReadPolicy?.basis)?body.financialReadPolicy.basis:null;
  const payloadScope={year:year(body?.orderYear),week:week(body?.major)};
  emit({event:'response_body',id:r.id,kind:r.kind,httpStatus:r.httpStatus,bodyCode:r.bodyCode,bodyState:r.bodyState,basis:r.basis,payloadScopeMatches:same(payloadScope),elapsedMs:clock()-r.startedAt});
  return body;
 }
 async function summary(stage){
  let ui=null;
  try{const state=await page.evaluate(()=>{
   const buttons=[...document.querySelectorAll('button')],q=buttons.find(b=>['조회','조회 중…'].includes(b.textContent.trim())),out=buttons.find(b=>b.textContent.startsWith('엑셀 다운로드'));
   return {year:document.querySelector('[aria-label="보고서 연도"]')?.value,week:document.querySelector('[aria-label="보고서 차수"]')?.value,queryPresent:!!q,queryDisabled:!!q?.disabled,exportPresent:!!out,exportEnabled:!!out&&!out.disabled,emptyState:!!document.querySelector('[data-testid="profit-query-empty"]'),basisPresent:!!document.querySelector('[data-testid="profit-financial-basis"]'),alerts:document.querySelectorAll('[role="alert"]').length};
  });ui={scope:{year:year(state.year),week:week(state.week)},scopeMatches:same({year:year(state.year),week:week(state.week)}),queryPresent:state.queryPresent===true,queryDisabled:state.queryDisabled===true,exportPresent:state.exportPresent===true,exportEnabled:state.exportEnabled===true,emptyState:state.emptyState===true,basisPresent:state.basisPresent===true,alerts:Number.isInteger(state.alerts)?state.alerts:null};}catch{}
  const counts={};for(const r of records)counts[r.kind]=(counts[r.kind]||0)+1;
  const result={event:'summary',stage,selected,elapsedMs:clock()-started,counts,failed:records.filter(r=>r.failed).length,aborted:records.filter(r=>r.aborted).length,pending:records.filter(r=>!r.finished&&!r.failed).length,ui};emit(result);return result;
 }
 return {response,summary,mainCount:()=>records.filter(r=>r.kind==='main').length,markQuery:clicked=>emit({event:'explicit_query',clicked:clicked===true,selected,elapsedMs:clock()-started})};
}
module.exports={observeProfitUiReads};
