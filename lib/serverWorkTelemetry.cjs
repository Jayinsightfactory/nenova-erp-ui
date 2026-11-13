'use strict';
// One process-wide observer for next start as well as the custom HTTP server.
// Log only server-defined routes and numeric measurements, never request fields.
const fs=require('node:fs'), path=require('node:path'), dc=require('node:diagnostics_channel');
const {AsyncLocalStorage}=require('node:async_hooks');
const {monitorEventLoopDelay,performance}=require('node:perf_hooks');
const {randomUUID}=require('node:crypto');
const KEY=Symbol.for('nenova.work-telemetry.v1');
const STAGES=new Set(['dbPool','dbQuery','personalFile','guidance','quality','admission','multipart','store','remit','txBegin','txQuery','txCommit']);
const BASE=['/api/auth/login','/api/desktop/home-workspace','/api/work/drive-ingest','/api/pm/office','/api/ping'];
const BUCKETS=[100,250,500,1000,2000,5000,15000,60000];
const DIR=()=>path.join(process.cwd(),'data/runtime/server-logs');
const DAY=86400000, MAX_DAY=16*1024*1024;
function fileWriter(dir=DIR()){
 let pending=[],busy=false,dropped=0,cleaned='';
 async function flush(){
  if(busy||!pending.length)return;busy=true;
  try{
   const batch=pending.splice(0),date=new Date(), day=date.toISOString().slice(0,10);
   await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
   if(cleaned!==day){
    for(const name of await fs.promises.readdir(dir)){
     if(/^work-\d{4}-\d\d-\d\d\.jsonl$/.test(name)&&Date.parse(name.slice(5,15)+'T00:00:00Z')<Date.parse(day+'T00:00:00Z')-6*DAY)await fs.promises.unlink(path.join(dir,name)).catch(()=>{});
    }cleaned=day;
   }
   const file=path.join(dir,'work-'+day+'.jsonl'),size=await fs.promises.stat(file).then(x=>x.size,e=>{if(e.code==='ENOENT')return 0;throw e});
   if(size<MAX_DAY){if(dropped){batch.push({at:date.toISOString(),kind:'dropped',count:dropped});dropped=0;}const data=batch.map(x=>JSON.stringify(x)).join('\n')+'\n';if(size+Buffer.byteLength(data)<=MAX_DAY)await fs.promises.appendFile(file,data,{mode:0o600});else dropped+=batch.length;}
   else dropped+=batch.length;
  }catch{dropped++;if(dropped===1)console.warn('[server-work] LOG_WRITE_FAILED');}
  finally{busy=false;if(pending.length)setImmediate(flush).unref();}
 }
 return event=>{if(pending.length<500)pending.push(event);else dropped++;void flush()};
}
function start({write=fileWriter(),routes=BASE,interval=60000}={}){
 if(globalThis[KEY])return globalThis[KEY];
 const als=new AsyncLocalStorage(),allowed=new Set(routes);let groups=new Map(),samples=0,suppressed=0,active=0,cpu=process.cpuUsage(),last=performance.now();
 const lag=monitorEventLoopDelay({resolution:40});lag.enable();
 const emit=obj=>write({at:new Date().toISOString(),pid:process.pid,...obj});
 const note=({request:req,response:res})=>{
  const url=String(req.url||'').split('?',1)[0];if(!url.startsWith('/api/'))return;
  const route=allowed.has(url)?url:'other-api',method=['GET','POST','PUT','PATCH','DELETE'].includes(req.method)?req.method:'other';
  const record={id:randomUUID(),route,method,stages:{},start:performance.now()};active++;
  als.enterWith(record);let done=false;
  const finish=()=>{if(done)return;done=true;active--;
   const ms=Math.round(performance.now()-record.start),status=res.writableFinished?res.statusCode:499;
   const g=groups.get(route)||{count:0,errors:0,busy:0,maxMs:0,buckets:Array(BUCKETS.length+1).fill(0)};groups.set(route,g);g.count++;if(status>=500||status===499)g.errors++;if(status===429||status===503)g.busy++;g.maxMs=Math.max(g.maxMs,ms);const i=BUCKETS.findIndex(b=>ms<=b);g.buckets[i<0?BUCKETS.length:i]++;
   if(ms>=1000||status>=500||status===499){if(samples++<60)emit({kind:'request',route,method,id:record.id,ms,status,stages:record.stages});else suppressed++;}
  };
  res.once('finish',finish);res.once('close',finish);
 };
 const ch=dc.channel('http.server.request.start');ch.subscribe(note);
 const tick=()=>{const now=performance.now(),delta=process.cpuUsage(cpu);cpu=process.cpuUsage();const ingest=globalThis[Symbol.for('nenova.drive-ingest-service.v1')]?.status();emit({kind:'minute',...(ingest?{ingest}:{}),freeMemMiB:Math.round(require('node:os').freemem()/1048576),spanMs:Math.round(now-last),active,rssMiB:Math.round(process.memoryUsage().rss/1048576),cpuPct:Math.round((delta.user+delta.system)/Math.max(1,now-last)/10),loopP99Ms:Math.round(lag.percentile(99)/1e6),loopMaxMs:Math.round(lag.max/1e6),suppressed,groups:Object.fromEntries(groups)});groups=new Map();last=now;samples=0;suppressed=0;lag.reset();};
 const timer=setInterval(tick,interval);timer.unref();
 const service={als,allowed,stop(){clearInterval(timer);ch.unsubscribe(note);lag.disable();delete globalThis[KEY];},tick};globalThis[KEY]=service;return service;
}
function startProduction(){
 const s=start();
 fs.promises.readFile(path.join(process.cwd(),process.env.NEXT_DIST_DIR||'.next','server/pages-manifest.json'),'utf8')
 .then(data=>{for(const route of Object.keys(JSON.parse(data)))if(route.startsWith('/api/')&&!route.includes('['))s.allowed.add(route)}).catch(()=>{});
}
function measure(stage,fn){
 const rec=globalThis[KEY]?.als.getStore();if(!rec||!STAGES.has(stage))return fn();
 const at=performance.now(),finish=()=>{rec.stages[stage]=(rec.stages[stage]||0)+Math.round(performance.now()-at)};
 try{const r=fn();if(r&&typeof r.then==='function')return Promise.resolve(r).finally(finish);finish();return r;}catch(e){finish();throw e;}
}
module.exports={start,startProduction,measure,fileWriter,BUCKETS};
