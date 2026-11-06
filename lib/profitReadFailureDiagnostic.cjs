// Ordinary live owner only. No SQL, parameters, error text or caller identity leaves this helper.
const {createHash}=require('node:crypto');
const MARKER='NENOVA_PROFIT_READ_FAILURE ';
const SOURCE_MARKER='NENOVA_PROFIT_SOURCE_CHANGED ';
const COMPONENTS=new Set(['SHIP','EST','WH','FC','STOCK','SH','WPR','WCUS','WFWD','WCOL','WSPE','WACL','WTXR','CUR','PRODUCT','FLOWER','RATECFG','RATEHIST','CUSHIST','ARRIMP']);
const PHASES=new Set(['current','prior','duty','preFence','postFence']);
function timestampOnly(before,after){
 if(typeof before!=='string'||typeof after!=='string')return null;
 const a=before.split('|'),b=after.split('|');
 const valid=parts=>parts.length===3&&/^\d+$/.test(parts[0])&&/^(?:-?\d+)?$/.test(parts[1])&&(parts[2]===''||/^20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:?\d{2})?$/.test(parts[2])||/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} 20\d{2} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}(?: \([^\r\n()]{1,80}\))?$/.test(parts[2]));
 if(!valid(a)||!valid(b))return null;
 return a[0]===b[0]&&a[1]===b[1]&&a[2]!==b[2];
}
function sourceChangeSummary(before,after,years){
 const a=JSON.parse(before),b=JSON.parse(after);
 const map=v=>{if(!Array.isArray(v.erp)||!v.erp.every(row=>Array.isArray(row)&&row.length===2&&row.every(x=>typeof x==='string')))throw Error();return new Map(v.erp);};
 const old=map(a),next=map(b),coveredYears=[...new Set(years.map(String))].sort();
 if(!coveredYears.length||coveredYears.length>3||coveredYears.some(y=>!/^20\d{2}$/.test(y)))throw Error();
 let changedCount=0;const changes=[];
 for(const key of [...new Set([...old.keys(),...next.keys()])].sort()){
  if(old.has(key)&&next.has(key)&&old.get(key)===next.get(key))continue;
  changedCount++;const [component,year,major,...extra]=key.split(':');
  if(changes.length>=20||extra.length||!COMPONENTS.has(component)||!(year===''||/^20\d{2}$/.test(year))||!(major===''||/^(0[1-9]|[1-4]\d|5[0-3])$/.test(major)))continue;
  changes.push({component,year:year||null,major:major||null,kind:!old.has(key)?'added':!next.has(key)?'removed':'modified',timestampOnly:old.has(key)&&next.has(key)?timestampOnly(old.get(key),next.get(key)):null});
 }
 return {changedCount,changes,truncated:changedCount>changes.length,invoiceChanged:a.invoice!==b.invoice,coveredYears};
}
function queryHash(statement){
 const clean=String(statement).replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ').trim();
 const normalized=clean.replace(/\s+/g,' ').replace(/\bIN\s*\([\d,\s]+\)/gi,'IN(<keys>)');
 return createHash('sha256').update(normalized).digest('hex').slice(0,12);
}
function poolSnapshot(pool){
 const value={};for(const key of ['size','borrowed','available','pending']){
  try{const n=pool[key];value[key]=Number.isInteger(n)&&n>=0&&n<=1000000?n:null;}catch{value[key]=null;}
 }return value;
}
function createProfitReadFailureDiagnostic({orderYear,major,pool,log=line=>console.warn(line),clock=Date.now,pid=process.pid}){
 const year=String(orderYear),week=String(major).padStart(2,'0');
 const valid=/^20\d{2}$/.test(year)&&/^(0[1-9]|[1-4]\d|5[0-3])$/.test(week)&&Number.isInteger(pid)&&pid>0&&pid<=2147483647;let phase='preFence',attempts=0,sourceLogged=false;
 return {
  phase(next){if(PHASES.has(next))phase=next;},
  sourceChanged(before,after,years){
   try{
    if(!valid||sourceLogged||before===after)return;sourceLogged=true;
    const summary=sourceChangeSummary(before,after,years);
    log(SOURCE_MARKER+JSON.stringify({version:1,at:new Date(clock()).toISOString(),pid,scope:{year,major:week},...summary}));
   }catch{} // Whole fence still throws its original typed409, even if logging fails.
  },
  begin(statement){
   const capturedPhase=phase,started=clock(),poolAtDispatch=poolSnapshot(pool);let explicitTimerFired=false;
   return {timerFired(){explicitTimerFired=true;},failed(error){
    try{
     if(!valid||attempts>=3||!['ECANCEL','ETIMEOUT'].includes(error?.code))return;
     attempts++;
     const now=clock(),elapsedMs=now-started;
     log(MARKER+JSON.stringify({version:1,at:new Date(now).toISOString(),pid,scope:{year,major:week},phase:capturedPhase,queryHash:queryHash(statement),elapsedMs:Number.isInteger(elapsedMs)&&elapsedMs>=0&&elapsedMs<=86400000?elapsedMs:null,explicitTimerFired,poolAtDispatch,poolAtFailure:poolSnapshot(pool),code:error.code}));
    }catch{} // Observation must never replace the original source error.
   }};
  },
 };
}
module.exports={createProfitReadFailureDiagnostic,queryHash,poolSnapshot,MARKER,SOURCE_MARKER,sourceChangeSummary,timestampOnly};
