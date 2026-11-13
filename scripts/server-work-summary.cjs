'use strict';
// Local operator command; no HTTP route or credentials. Never relay log lines.
const fs=require('node:fs'),path=require('node:path');
const bounds=require('../lib/serverWorkTelemetry.cjs').BUCKETS;
const focus=['/api/auth/login','/api/desktop/home-workspace','/api/work/drive-ingest','/api/work/drive','/api/orders','/api/orders/import-parse','/api/moyi/drive-admin'];
const knownStages=new Set(['dbQuery','dbPool','personalFile','guidance','quality','admission','multipart','store','remit']);
function distribution({buckets,...g}){let sum=0;const i=buckets.findIndex(n=>(sum+=n)>=.95*g.count);return {...g,p95BucketMs:bounds[i]||'>60000'};}
async function summary(dir,minutes){
 const sampled=new Map();
 const oldest=Date.now()-minutes*60000,groups=new Map(),stages=new Map();let maxLoopMs=0,maxCpuPct=0,maxRssMiB=0,suppressed=0,minutesSeen=0;
 const files=await fs.promises.readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e});
 for(const name of files.filter(n=>/^work-\d{4}-\d\d-\d\d\.jsonl$/.test(n)&&Date.parse(n.slice(5,15)+'T00:00:00Z')+86400000>=oldest)){
  const lines=require('node:readline').createInterface({input:fs.createReadStream(path.join(dir,name)),crlfDelay:Infinity});
  for await(const line of lines){let e;try{e=JSON.parse(line)}catch{continue}if(!(Date.parse(e.at)>=oldest))continue;
   if(e.kind==='minute'){
    minutesSeen++;maxLoopMs=Math.max(maxLoopMs,e.loopMaxMs);maxCpuPct=Math.max(maxCpuPct,e.cpuPct);maxRssMiB=Math.max(maxRssMiB,e.rssMiB);suppressed+=e.suppressed||0;
    for(const [k,v] of Object.entries(e.groups||{})){if(!/^(other-api|\/api\/[a-z0-9/_-]{1,120})$/i.test(k))continue;
     const g=groups.get(k)||{route:k,count:0,errors:0,busy:0,maxMs:0,buckets:bounds.concat(Infinity).map(()=>0)};groups.set(k,g);g.count+=v.count;g.errors+=v.errors;g.busy+=v.busy;g.maxMs=Math.max(g.maxMs,v.maxMs);v.buckets.forEach((n,i)=>g.buckets[i]+=n);
    }
   }
   if(e.kind==='request'){
    const durations={};
    for(const [k,v] of Object.entries(e.stages||{})){if(!knownStages.has(k)||!Number.isFinite(v)||v<0)continue;stages.set(k,Math.max(stages.get(k)||0,v));durations[k]=v;}
    if(!focus.includes(e.route)||!['GET','POST','PUT','PATCH','DELETE'].includes(e.method)||!Number.isFinite(e.ms)||e.ms<0||!Number.isInteger(e.status)||e.status<100||e.status>599)continue;
    const key=e.route+' '+e.method,item=sampled.get(key)||{route:e.route,method:e.method,samples:0,maxMs:-1};item.samples++;
    if(e.ms>item.maxMs){item.maxMs=e.ms;item.statusAtMax=e.status;item.stagesAtMaxMs=durations;}
    sampled.set(key,item);
   }
  }
 }
 const top=[...groups.values()].sort((a,b)=>b.errors-a.errors||b.maxMs-a.maxMs).slice(0,20).map(distribution);
 const focusRoutes=focus.map(route=>groups.has(route)?distribution(groups.get(route)):{route,count:0,p95BucketMs:null});
 return {minutesSeen,maxLoopMs,maxCpuPct,maxRssMiB,suppressed,slowStageMaxMs:Object.fromEntries(stages),top,focusRoutes,slowSamples:[...sampled.values()].sort((a,b)=>b.maxMs-a.maxMs)};
}
if(require.main===module)summary(path.join(process.cwd(),'data/runtime/server-logs'),Math.max(1,Math.min(1440,Number(process.argv[2])||30))).then(v=>console.log(JSON.stringify(v))).catch(()=>{console.error('SERVER_WORK_SUMMARY_FAILED');process.exitCode=1});
module.exports={summary};
