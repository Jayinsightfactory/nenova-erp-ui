// Ordinary live owner only. No SQL, parameters, error text or caller identity leaves this helper.
const {createHash}=require('node:crypto');
const MARKER='NENOVA_PROFIT_READ_FAILURE ';
const PHASES=new Set(['current','prior','duty','preFence','postFence']);
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
 const valid=/^20\d{2}$/.test(year)&&/^(0[1-9]|[1-4]\d|5[0-3])$/.test(week)&&Number.isInteger(pid)&&pid>0&&pid<=2147483647;let phase='preFence',attempts=0;
 return {
  phase(next){if(PHASES.has(next))phase=next;},
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
module.exports={createProfitReadFailureDiagnostic,queryHash,poolSnapshot,MARKER};
