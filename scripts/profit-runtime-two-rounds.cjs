// Runner only. Never forward child stdout/stderr wholesale or exception messages.
const {spawn}=require('node:child_process');
const {runtimeValidationMode,assessRound,assessRounds}=require('./lib/profit-runtime-validation.cjs');
const KINDS=['main','output','context','period','stock-reference'];
const CODES=new Set(['PROFIT_SOURCES_CHANGED','PROFIT_CALENDAR_INVALID','PROFIT_INVOICE_FENCE_INCOMPLETE','PROFIT_HISTORICAL_SNAPSHOT_REQUIRED','PROFIT_STORED_CALCULATION_REQUIRED','APPROVAL_REPORT_SOURCE_FAILED','APPROVAL_EXTERNAL_EVIDENCE_REQUIRED','PROFIT_SNAPSHOT_INCOMPLETE','EREQUEST','ETIMEOUT','ECANCEL','ECONNCLOSED','ECONNRESET','ESOCKET','ELOGIN','EINVALIDSTATE','ENOTOPEN']);
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max?value:null;
const scope=value=>({year:typeof value?.year==='string'&&/^20\d{2}$/.test(value.year)?value.year:null,week:typeof value?.week==='string'&&/^(0[1-9]|[1-4]\d|5[0-3])$/.test(value.week)?value.week:null});
function safeObserver(value){
 if(value?.profitUiReadDiagnostic!==true||!['request','requestfailed','response_headers','response_body','summary','explicit_query'].includes(value.event))return null;
 const out={profitUiReadDiagnostic:true,event:value.event,elapsedMs:integer(value.elapsedMs,600000)};
 if(value.event==='summary'){
  out.stage=['before_query','ui_ready_timeout','ui_ready'].includes(value.stage)?value.stage:null;out.selected=scope(value.selected);out.counts={};
  for(const kind of KINDS)if(value.counts?.[kind]!==undefined)out.counts[kind]=integer(value.counts[kind],1000);
  for(const key of ['failed','aborted','pending'])out[key]=integer(value[key],1000);
  out.ui=null;if(value.ui&&typeof value.ui==='object'){out.ui={scope:scope(value.ui.scope),alerts:integer(value.ui.alerts,1000)};for(const key of ['scopeMatches','queryPresent','queryDisabled','exportPresent','exportEnabled','emptyState','basisPresent'])out.ui[key]=typeof value.ui[key]==='boolean'?value.ui[key]:null;}
 }else if(value.event==='explicit_query'){out.clicked=value.clicked===true;out.selected=scope(value.selected);}
 else{
  out.id=integer(value.id,1000);out.kind=KINDS.includes(value.kind)?value.kind:null;
  if(value.event==='request'){out.scope=scope(value.scope);out.scopeMatches=typeof value.scopeMatches==='boolean'?value.scopeMatches:null;}
  if(value.event==='requestfailed')out.aborted=typeof value.aborted==='boolean'?value.aborted:null;
  if(['response_headers','response_body'].includes(value.event))out.httpStatus=value.httpStatus>=100?integer(value.httpStatus,599):null;
  if(value.event==='response_body'){
   out.bodyCode=CODES.has(value.bodyCode)?value.bodyCode:null;out.codePresent=typeof value.codePresent==='boolean'?value.codePresent:null;
   out.bodyState=['success','api_error','other_json','unreadable'].includes(value.bodyState)?value.bodyState:null;
   out.basis=['stored','live','confirmed'].includes(value.basis)?value.basis:null;out.payloadScopeMatches=typeof value.payloadScopeMatches==='boolean'?value.payloadScopeMatches:null;
  }
 }
 return out;
}
const failure=code=>Object.assign(Error(),{code});
function safeResult(value){
 if(value?.runtimeHttpFailure===true)return {runtimeHttpFailure:true,status:value.status>=100?integer(value.status,599):null,kind:['main','output','week-check','stock-notes','other-api'].includes(value.kind)?value.kind:null};
 if(value?.status!=='PASS'||!value.scope)return null;
 return {runtimeFileResult:true,status:'PASS',scope:scope(value.scope),requests:integer(value.requests,1000),httpStatuses:Array.isArray(value.httpStatuses)?value.httpStatuses.slice(0,10).map(n=>n>=100?integer(n,599):null):null,blockedWrites:integer(value.blockedWrites,100000),actualBusinessWrites:integer(value.actualBusinessWrites,100000),initialDifferenceCount:Array.isArray(value.initialScreenDifferences)?value.initialScreenDifferences.length:null,financialDigest:typeof value.financialDigest==='string'&&/^[a-f0-9]{64}$/.test(value.financialDigest)?value.financialDigest:null,bytes:integer(value.bytes,1000000000),sheets:integer(value.sheets,1000)};
}
const ASSESS_CODES=new Set(['RUNTIME_HTTP_FAILURE','RUNTIME_READ_BUDGET_FAILED','RUNTIME_FILE_MONEY_FAILED']);
const FAILURE_REASONS={RUNTIME_CHILD_EXIT:'child_exit',RUNTIME_CHILD_DEADLINE:'deadline',RUNTIME_CHILD_SPAWN:'child_spawn',RUNTIME_ROUND_ASSESS:'assess',RUNTIME_ROUNDS_ASSESS:'assess',RUNTIME_HTTP_FAILURE:'assess',RUNTIME_READ_BUDGET_FAILED:'assess',RUNTIME_FILE_MONEY_FAILED:'assess',RUNTIME_MODE_DENIED:'mode'};
function safeFailure(error){const code=Object.hasOwn(FAILURE_REASONS,error?.code)?error.code:'RUNTIME_RUNNER_FAILED';return {runtimeValidation:'FAIL',reason:FAILURE_REASONS[code]||'runner',code};}
async function round({spawnChild=spawn,log=console.log,deadlineMs=270000}={}){
 const messages=[];
 let child;try{child=spawnChild(process.execPath,['scripts/profit-production-download-smoke.cjs'],{env:process.env,stdio:['ignore','pipe','pipe']});}catch{throw failure('RUNTIME_CHILD_SPAWN');}
 let pending='';child.stdout.on('data',chunk=>{pending+=chunk;for(;;){const end=pending.indexOf('\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+1);try{const value=JSON.parse(line);messages.push(value);const safe=safeObserver(value)||safeResult(value);if(safe)log(JSON.stringify(safe));}catch{}}});child.stderr.on('data',()=>{});
 let deadline=false;const timer=setTimeout(()=>{deadline=true;child.kill();},deadlineMs);
 try{const code=await new Promise((resolve,reject)=>{child.on('error',()=>reject(failure('RUNTIME_CHILD_SPAWN')));child.on('exit',resolve);});if(deadline)throw failure('RUNTIME_CHILD_DEADLINE');if(code!==0)throw failure('RUNTIME_CHILD_EXIT');try{return assessRound(messages);}catch(error){throw failure(ASSESS_CODES.has(error.message)?error.message:'RUNTIME_ROUND_ASSESS');}}finally{clearTimeout(timer);}
}
async function main(){
 try{if(runtimeValidationMode(process.env)!==true)throw Error();}catch{throw failure('RUNTIME_MODE_DENIED');}const hashes=[];
 for(let i=0;i<2;i++){const result=await round();hashes.push(result.financialDigest);console.log(JSON.stringify({runtimeRound:i+1,result:'PASS',mainOutputPass:true,financialDigest:result.financialDigest}));}
 let result;try{result=assessRounds(hashes);}catch{throw failure('RUNTIME_ROUNDS_ASSESS');}console.log(JSON.stringify({runtimeValidation:'PASS',...result}));
}
if(require.main===module)main().catch(error=>{console.log(JSON.stringify(safeFailure(error)));process.exitCode=1;});
module.exports={main,round,safeObserver,safeResult,safeFailure};
