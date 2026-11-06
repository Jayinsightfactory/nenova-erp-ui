// Diagnostic only: context then one allowlisted main OR output GET. No browser/audit/retries.
// Never log authorization, source payloads, notes, error messages or stack traces.
const ORIGIN='https://nenovaweb.com';
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:null;
const safeBasis=value=>['stored','live','confirmed'].includes(value)?value:null;
function scope(year,week){
 if(!/^20\d{2}$/.test(String(year))||!/^\d{1,2}$/.test(String(week))||Number(week)<1||Number(week)>53)throw Error('PROBE_SCOPE_INVALID');
 return {year:String(year),week:String(Number(week)).padStart(2,'0')};
}
async function runProfitReadProbe({year='2026',week='44',target='main',token,fetchFn=fetch,log=console.log,deadlineMs=180000,clock=Date.now}={}){
 const selected=scope(year,week);
 if(!['main','output'].includes(target))throw Error('PROBE_TARGET_INVALID');
 if(typeof token!=='string'||!token.trim())throw Error('PROBE_CREDENTIAL_UNAVAILABLE');
 if(!Number.isFinite(deadlineMs)||deadlineMs<=0||deadlineMs>180000)throw Error('PROBE_DEADLINE_INVALID');
 const deadline=clock()+deadlineMs,results=[];
 const targetPath=target==='main'?`/api/sales/profit-report?year=${selected.year}&week=${selected.week}`:`/api/sales/profit-report-output?year=${selected.year}&week=${selected.week}&cols=C,E,F,G,H,I,J,K&category=1`;
 for(const [stage,path]of [['context','/api/sales/profit-report?context=1'],[target,targetPath]]){
  const started=clock(),remaining=deadline-started,controller=new AbortController();
  const result={stage,httpStatus:null,bodyCode:null,codePresent:false,elapsedMs:0,financialBasis:null,outcome:'deadline'};
  let timer;
  try{
   if(remaining<=0)throw Object.assign(Error(),{name:'AbortError'});
   timer=setTimeout(()=>controller.abort(),remaining);
   const response=await fetchFn(ORIGIN+path,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token},signal:controller.signal});
   result.httpStatus=response.status;
   let body;
   try{body=await response.json();}catch(error){if(controller.signal.aborted)throw error;result.outcome=response.ok?'invalid_json':'http_error';}
   if(body){result.codePresent=body.code!=null;result.bodyCode=safeCode(body.code);result.financialBasis=safeBasis(body.financialReadPolicy?.basis);result.outcome=!response.ok?'http_error':body.success===true?'ok':'api_error';}
  }catch(error){
   result.outcome=controller.signal.aborted||error.name==='AbortError'||error.name==='TimeoutError'?'deadline':'transport_error';
  }finally{clearTimeout(timer);result.elapsedMs=Math.max(0,clock()-started);}
  results.push(result);log(JSON.stringify(result));
  if(result.outcome!=='ok')break;
 }
 return {ok:results.length===2&&results.every(result=>result.outcome==='ok'),results};
}
module.exports={runProfitReadProbe,scope,safeCode,safeBasis};
if(require.main===module)runProfitReadProbe({year:process.env.PROBE_YEAR,week:process.env.PROBE_WEEK,target:process.env.PROBE_TARGET,token:process.env.NENOVAWEB_SERVICE_TOKEN})
 .then(result=>{if(!result.ok)process.exitCode=1;})
 .catch(error=>{console.error(JSON.stringify({stage:'configuration',bodyCode:safeCode(error.message)}));process.exitCode=1;});
