// Explicit approved 2026/36-46 operation. Uses the existing authenticated POST,
// not local SQL calculations (server-only settlement files must remain authoritative).
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function parseRefreshArgs(args){
 const value={apply:false};
 for(const arg of args){if(arg==='--apply'){if(value.apply)throw Error('duplicate apply');value.apply=true;continue;}
  const m=/^--(from|to|report)=(.+)$/.exec(arg);if(!m||value[m[1]]!=null)throw Error('invalid argument');value[m[1]]=m[2];}
 const from=Number(value.from),to=Number(value.to);
 if(!/^\d{2}$/.test(value.from||'')||!/^\d{2}$/.test(value.to||'')||from<36||to>46||from>to)throw Error('Approved scope is 2026/36-46 only');
 if(value.apply&&!value.report)throw Error('Explicit operation report required');
 return {...value,from,to,year:'2026'};
}
export async function refreshFinalCaches(options,{token,fetchFn=fetch,progress=()=>{}}={}){
 if(options.year!=='2026'||!Number.isInteger(options.from)||!Number.isInteger(options.to)||options.from<36||options.to>46||options.from>options.to)throw Error('Approved scope required');
 if(!options.apply)return {mode:'dry-run',year:'2026',from:options.from,to:options.to,requests:0};
 if(!token)throw Error('Existing service credential unavailable');
 const results=[];
 for(let week=options.from;week<=options.to;week++){
  let phase='dispatch';
  try{
   const response=await fetchFn('https://nenovaweb.com/api/sales/profit-report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({year:'2026',week:String(week),action:'snapshotRefresh'}),signal:AbortSignal.timeout(180000)});
   phase='response';if(!response.ok)throw Object.assign(Error('HTTP response incomplete'),{safeCode:`HTTP_${response.status}`});
   const data=await response.json();
   if(!data.success||String(data.orderYear)!=='2026'||Number(data.major)!==week||data.cacheFinalizationVersion!==1||data.financialReadPolicy?.frozen!==true||data.snapshot?.servedFrom!=='snapshot')throw Object.assign(Error('Final cache confirmation missing'),{safeCode:'FINAL_CACHE_UNCONFIRMED'});
   results.push({week,status:'saved',version:data.snapshot.versionNo??null,snapKey:data.snapshot.snapKey??null});
  }catch(error){results.push({week,status:'outcome_unknown',code:error.safeCode||`REFRESH_${phase.toUpperCase()}_FAILED`});await progress(results);return {failed:true,results};}
  await progress(results);
 }
 return {failed:false,results};
}
async function main(){
 const options=parseRefreshArgs(process.argv.slice(2));
 if(!options.apply){console.log(JSON.stringify(await refreshFinalCaches(options)));return;}
 if(fs.existsSync(options.report))throw Error('Report exists; inspect before repeating');
 const report={scope:{year:'2026',from:options.from,to:options.to},started:new Date().toISOString(),status:'starting',results:[]};
 const persist=()=>fs.writeFileSync(options.report,JSON.stringify(report,null,2));persist();
 const result=await refreshFinalCaches(options,{token:process.env.NENOVAWEB_SERVICE_TOKEN,progress:rows=>{report.results=rows;persist();console.log(JSON.stringify(rows.at(-1)));}});
 Object.assign(report,result,{status:result.failed?'needs_inspection':'complete',finished:new Date().toISOString()});persist();if(result.failed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Explicit refresh stopped; inspect the scoped operation report. No automatic retry.');process.exitCode=1;});
