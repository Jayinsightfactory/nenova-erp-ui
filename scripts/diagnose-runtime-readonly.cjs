// Read-only, aggregate diagnostics. Never print log lines or PM2 environment.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
// Kept self-contained: deploy diagnostics execute this file through node stdin.
function summarizeMemoryRestarts(text,{since,until,pmIds}){
 const selected=new Set(pmIds.filter(Number.isInteger));let count=0,latestTime=null,currentMB=null,maxMB=null;
 for(const line of String(text).split(/\r?\n/)){
  if(!/restarted because it exceeds --max-memory-restart value/i.test(line))continue;
  const id=line.match(/\bProcess\s+(\d+)\s+restarted\b/i),timestamp=line.match(/^(20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)/);
  const at=timestamp?Date.parse(timestamp[1]):NaN;
  if(!id||!selected.has(Number(id[1]))||!Number.isFinite(at)||at<since||at>until)continue;
  count++;
  if(latestTime===null||at>=Date.parse(latestTime)){
   latestTime=new Date(at).toISOString();
   const values=line.match(/current_memory=(\d+)\s+max_memory_limit=(\d+)\s+\[octets\]/);
   currentMB=values?Math.round(Number(values[1])/1048576):null;
   maxMB=values?Math.round(Number(values[2])/1048576):null;
  }
 }
 return {count,latestTime,currentMB,maxMB,scoped:selected.size>0};
}
const since=Date.now()-7*864e5, categories={timeout:/timeout|timed out|ETIMEDOUT/i,dbTimeout:/RequestError.*timeout|ConnectionError.*timeout|ETIMEOUT|request.*timed out/i,upstreamTimeout:/upstream.*timeout|gateway timeout/i,externalTimeout:/fetch failed|ECONNABORTED|AbortError|UND_ERR_CONNECT_TIMEOUT/i,connection:/ECONNRESET|ECONNREFUSED|ESOCKET|pool.*exhaust/i,lock:/deadlock|lock timeout|blocking/i,memory:/out of memory|ENOMEM|heap out/i,activityWorker:/userActivityWorker\.cjs|ERR_WORKER_PATH|ACTIVITY_QUEUE_FULL/i,activityWrite:/\[user-activity\] write_failed/i,error:/\b(?:error|failed|exception)\b/i};
const safeNumber=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
const safeMemory=value=>typeof value==='number'?safeNumber(value):typeof value==='string'&&/^\d+(?:[KMG]B?)?$/i.test(value)?value:null;
const safeCron=value=>!value?null:typeof value==='string'&&(/^[\d*/?,\-\s]{1,80}$/.test(value)||/^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$/.test(value))?value:'configured';
let processes=[];try{processes=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024}));}catch(e){console.log(JSON.stringify({section:'pm2',error:e.code||'unavailable'}));}
console.log(JSON.stringify({section:'host_now',date:new Date().toISOString(),uptimeSec:Math.round(os.uptime()),load:os.loadavg().map(x=>+x.toFixed(2)),totalMemMB:Math.round(os.totalmem()/1048576),freeMemMB:Math.round(os.freemem()/1048576)}));
try{
 const file=path.join(process.env.PM2_HOME||path.join(os.homedir(),'.pm2'),'pm2.log');
 const stat=fs.statSync(file),bytes=Math.min(stat.size,4*1024*1024),buffer=Buffer.alloc(bytes),fd=fs.openSync(file,'r');
 try{fs.readSync(fd,buffer,0,bytes,stat.size-bytes);}finally{fs.closeSync(fd);}
 const until=Date.now(),pmIds=processes.filter(p=>/nenova|erp/i.test(p.name||'')).map(p=>p.pm2_env?.pm_id??p.pm_id);
 console.log(JSON.stringify({section:'pm2_memory_restart_30m',available:true,scannedBytes:bytes,tailTruncated:stat.size>bytes,...summarizeMemoryRestarts(buffer.toString('utf8'),{since:until-30*60000,until,pmIds})}));
}catch{console.log(JSON.stringify({section:'pm2_memory_restart_30m',available:false}));}
for(const p of processes.filter(p=>/nenova|erp/i.test(p.name||''))){const env=p.pm2_env||{},mon=p.monit||{};console.log(JSON.stringify({section:'pm2',name:p.name,status:env.status,pid:p.pid,restarts:env.restart_time,uptime:new Date(env.pm_uptime||0).toISOString(),cpuPercent:mon.cpu,memoryMB:Math.round((mon.memory||0)/1048576),maxMemoryRestart:safeMemory(env.max_memory_restart),watchEnabled:Array.isArray(env.watch)?env.watch.length>0:Boolean(env.watch),watchPathCount:Array.isArray(env.watch)?env.watch.length:null,cronRestart:safeCron(env.cron_restart),autorestart:typeof env.autorestart==='boolean'?env.autorestart:null,restartDelayMs:safeNumber(env.restart_delay),backoffRestartDelayMs:safeNumber(env.exp_backoff_restart_delay),unstableRestarts:safeNumber(env.unstable_restarts)}));for(const [kind,file] of Object.entries({out:env.pm_out_log_path,err:env.pm_err_log_path})){if(!file)continue;try{const stat=fs.statSync(file),bytes=Math.min(stat.size,4*1024*1024),buf=Buffer.alloc(bytes),fd=fs.openSync(file,'r');try{fs.readSync(fd,buf,0,bytes,stat.size-bytes);}finally{fs.closeSync(fd);}const counts=Object.fromEntries(Object.keys(categories).map(k=>[k,0]));let dated=0,undated=0;for(const line of buf.toString('utf8').split(/\r?\n/)){const dt=line.match(/20\d\d[-/]\d\d[-/]\d\d[ T]\d\d:\d\d/),when=dt?Date.parse(dt[0].replaceAll('/','-')+'Z'):NaN;if(Number.isFinite(when)&&when<since)continue;if(Number.isFinite(when))dated++;else undated++;for(const [k,re] of Object.entries(categories))if(re.test(line))counts[k]++;}console.log(JSON.stringify({section:'pm2_log',name:p.name,kind,scannedBytes:bytes,datedLines:dated,undatedLines:undated,counts}));}catch(e){console.log(JSON.stringify({section:'pm2_log',name:p.name,kind,error:e.code||'unavailable'}));}}}
try{const r=cp.spawnSync('journalctl',['-k','--since','7 days ago','--no-pager','-o','short-iso'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});const hits=(r.stdout||'').split('\n').filter(x=>/out of memory|oom-kill|killed process/i.test(x));const hours={};for(const line of hits){const hour=line.match(/^20\d\d-\d\d-\d\dT\d\d/);if(hour)hours[hour[0]]=(hours[hour[0]]||0)+1;}console.log(JSON.stringify({section:'kernel',available:r.status===0,oomEvents:hits.length,oomHours:hours}));}catch(e){console.log(JSON.stringify({section:'kernel',error:e.code||'unavailable'}));}
