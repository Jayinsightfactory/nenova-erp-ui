// Read-only, aggregate diagnostics. Never print log lines or PM2 environment.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
// Kept self-contained: deploy diagnostics execute this file through node stdin.
function summarizeProfitSourceChanges(text,{since,until}){
 const marker='NENOVA_PROFIT_SOURCE_CHANGED ',events=[];let count=0;
 const tags=new Set(['SHIP','EST','WH','FC','STOCK','SH','WPR','WCUS','WFWD','WCOL','WSPE','WACL','WTXR','CUR','PRODUCT','FLOWER','RATECFG','RATEHIST','CUSHIST','ARRIMP']);
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 const year=v=>typeof v==='string'&&/^20\d{2}$/.test(v),major=v=>typeof v==='string'&&/^(0[1-9]|[1-4]\d|5[0-3])$/.test(v);
 for(const line of String(text).split(/\r?\n/)){
  const start=line.indexOf(marker);if(start<0)continue;
  try{
   const v=JSON.parse(line.slice(start+marker.length));
   if(!exact(v,['version','at','pid','scope','changedCount','changes','truncated','invoiceChanged','coveredYears'])||v.version!==1||!Number.isInteger(v.pid)||v.pid<=0||v.pid>2147483647||typeof v.at!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.at))continue;
   const at=Date.parse(v.at);if(!Number.isFinite(at)||new Date(at).toISOString()!==v.at||at<since||at>until)continue;
   if(!exact(v.scope,['year','major'])||!year(v.scope.year)||!major(v.scope.major)||!Number.isInteger(v.changedCount)||v.changedCount<0||v.changedCount>1000000||typeof v.truncated!=='boolean'||typeof v.invoiceChanged!=='boolean')continue;
   if(!Array.isArray(v.coveredYears)||!v.coveredYears.length||v.coveredYears.length>3||!v.coveredYears.every(year)||new Set(v.coveredYears).size!==v.coveredYears.length||!Array.isArray(v.changes)||v.changes.length>20||v.changes.length>v.changedCount||v.truncated!==(v.changedCount>v.changes.length))continue;
   if(!v.changes.every(c=>exact(c,['component','year','major','kind','timestampOnly'])&&tags.has(c.component)&&(c.year===null||year(c.year))&&(c.major===null||major(c.major))&&['added','removed','modified'].includes(c.kind)&&(c.timestampOnly===null||typeof c.timestampOnly==='boolean')&&(c.kind==='modified'||c.timestampOnly===null)))continue;
   count++;events.push(v);events.sort((a,b)=>b.at.localeCompare(a.at));events.length=Math.min(events.length,3);
  }catch{}
 }
 return {count,latest:events};
}
function summarizeProfitReadFailures(text,{since,until}){
 const marker='NENOVA_PROFIT_READ_FAILURE ',events=[];let count=0,explicitTimerFiredCount=0;
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 const pool=v=>exact(v,['size','borrowed','available','pending'])&&Object.values(v).every(n=>n===null||(Number.isInteger(n)&&n>=0&&n<=1000000));
 for(const line of String(text).split(/\r?\n/)){
  const start=line.indexOf(marker);if(start<0)continue;
  try{
   const v=JSON.parse(line.slice(start+marker.length));
   if(!exact(v,['version','at','pid','scope','phase','queryHash','elapsedMs','explicitTimerFired','poolAtDispatch','poolAtFailure','code'])||v.version!==1||!Number.isInteger(v.pid)||v.pid<=0||v.pid>2147483647||typeof v.at!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.at))continue;
   const at=Date.parse(v.at);if(!Number.isFinite(at)||new Date(at).toISOString()!==v.at||at<since||at>until)continue;
   if(!exact(v.scope,['year','major'])||typeof v.scope.year!=='string'||!/^20\d{2}$/.test(v.scope.year)||typeof v.scope.major!=='string'||!/^(0[1-9]|[1-4]\d|5[0-3])$/.test(v.scope.major))continue;
   if(!['current','prior','duty','preFence','postFence'].includes(v.phase)||typeof v.queryHash!=='string'||!/^[a-f0-9]{12}$/.test(v.queryHash)||!['ECANCEL','ETIMEOUT'].includes(v.code)||typeof v.explicitTimerFired!=='boolean'||!(v.elapsedMs===null||(Number.isInteger(v.elapsedMs)&&v.elapsedMs>=0&&v.elapsedMs<=86400000))||!pool(v.poolAtDispatch)||!pool(v.poolAtFailure))continue;
   count++;if(v.explicitTimerFired)explicitTimerFiredCount++;events.push(v);events.sort((a,b)=>b.at.localeCompare(a.at));events.length=Math.min(events.length,3);
  }catch{}
 }
 return {count,explicitTimerFiredCount,latest:events};
}
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
function memoryFlags(value){
 const tokens=Array.isArray(value)?value.filter(v=>typeof v==='string'):typeof value==='string'?(value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)||[]):[];
 const result={maxOldSpaceMiB:null,maxOldSpacePresent:false,maxSemiSpacePresent:false,maxHeapSizePresent:false,oldSpacePercentagePresent:false,exposeGcPresent:false,heapSnapshotPresent:false,heapProfilerPresent:false,invalidNumeric:false};
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i].replace(/["']/g,'').replaceAll('_','-'),match=token.match(/^--(max-old-space-size|max-semi-space-size|max-heap-size|max-old-space-size-percentage)(?:=(.*))?$/);
  if(match){const key={'max-old-space-size':'maxOldSpacePresent','max-semi-space-size':'maxSemiSpacePresent','max-heap-size':'maxHeapSizePresent','max-old-space-size-percentage':'oldSpacePercentagePresent'}[match[1]];result[key]=true;
   const raw=match[2]??tokens[i+1];if(match[2]===undefined&&raw!==undefined&&!raw.startsWith('--'))i++;
   const number=typeof raw==='string'&&/^\d{1,5}$/.test(raw)?Number(raw):null;
   if(number===null||number>32768)result.invalidNumeric=true;
   if(match[1]==='max-old-space-size')result.maxOldSpaceMiB=number!==null&&number<=32768?number:null;
  }
  if(/^--expose-gc(?:=|$)/.test(token))result.exposeGcPresent=true;
  if(/^--heapsnapshot(?:-|=|$)/.test(token))result.heapSnapshotPresent=true;
  if(/^--heap-prof(?:-|=|$)/.test(token))result.heapProfilerPresent=true;
 }
 return result;
}
function nodePrefixArguments(cmdline){
 const tokens=String(cmdline).split('\0').filter(Boolean),out=[];
 if(!tokens.length||!/^(node|nodejs)(?:\.exe)?$/i.test(path.basename(tokens[0])))return null;
 for(let i=1;i<tokens.length;i++){
  const token=tokens[i];if(token==='--'||!token.startsWith('-'))break;
  if(['-e','--eval','-p','--print'].includes(token))break;
  out.push(token);
  if(!token.includes('=')&&/^(?:-r|--require|--import|--loader|--experimental-loader|--icu-data-dir|--inspect-port|--max[-_]old[-_]space[-_]size|--max[-_]semi[-_]space[-_]size|--max[-_]heap[-_]size|--max-old-space-size-percentage)$/.test(token)&&i+1<tokens.length)out.push(tokens[++i]);
 }
 return out;
}
function byteLimit(value){
 const text=String(value).trim();if(text==='max')return {available:true,unlimited:true,limitMB:null};
 if(!/^\d+$/.test(text))return {available:false,unlimited:false,limitMB:null};
 const bytes=BigInt(text);return {available:true,unlimited:bytes>=2n**60n,limitMB:bytes>=2n**60n?null:Number(bytes)/1048576};
}
function cgroupMemory(pid){
 try{
  const entries=fs.readFileSync(`/proc/${pid}/cgroup`,'utf8').trim().split('\n');
  const v2=entries.find(line=>line.startsWith('0::')),v1=entries.find(line=>/^\d+:[^:]*\bmemory\b[^:]*:/.test(line));
  if(!v2&&!v1)return {available:false};
  const version=v2?2:1,root=v2?'/sys/fs/cgroup':'/sys/fs/cgroup/memory',group=(v2||v1).split(':').slice(2).join(':');
  let directory=path.resolve(root,'.'+group);if(directory!==root&&!directory.startsWith(root+'/'))return {available:false};
  const initial=directory,limits=[];let available=false;
  for(;;){try{const value=byteLimit(fs.readFileSync(path.join(directory,version===2?'memory.max':'memory.limit_in_bytes'),'utf8'));available||=value.available;if(value.limitMB!==null)limits.push(value.limitMB);}catch{}
   if(directory===root)break;directory=path.dirname(directory);
  }
  let currentMB=null;try{const text=fs.readFileSync(path.join(initial,version===2?'memory.current':'memory.usage_in_bytes'),'utf8').trim();if(/^\d+$/.test(text))currentMB=Number(text)/1048576;}catch{}
  return {available,version,limitMB:limits.length?Math.min(...limits):null,unlimited:available&&!limits.length,currentMB};
 }catch{return {available:false};}
}
function pm2MemoryMetric(env,key){
 const metric=env.axm_monitor?.[key];if(!metric||!['MiB','MB'].includes(metric.unit))return null;
 return typeof metric.value==='number'&&Number.isFinite(metric.value)?metric.value:typeof metric.value==='string'&&/^\d+(?:\.\d+)?$/.test(metric.value)?Number(metric.value):null;
}
function processMemoryDiagnostic(p){
 const env=p.pm2_env||{},pid=p.pid;if(!Number.isInteger(pid)||pid<=0)return {available:false};
 const configuredArgs=memoryFlags(env.node_args),configuredOptions=memoryFlags(env.NODE_OPTIONS??env.env?.NODE_OPTIONS);
 let actualArgs=null,actualOptions=null,procRssMB=null,procPeakRssMB=null,procAnonMB=null,replica=null,nodeExecutableVerified=false;
 try{nodeExecutableVerified=/^(node|nodejs)(?:\.exe)?$/i.test(path.basename(fs.readlinkSync(`/proc/${pid}/exe`)));}catch{}
 try{const prefix=nodePrefixArguments(fs.readFileSync(`/proc/${pid}/cmdline`,'utf8'));if(nodeExecutableVerified&&prefix!==null)actualArgs=memoryFlags(prefix);}catch{}
 try{const option=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').find(item=>item.startsWith('NODE_OPTIONS='));actualOptions=memoryFlags(option?.slice('NODE_OPTIONS='.length));}catch{}
 try{const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');for(const[key,set]of [['VmRSS',v=>procRssMB=v],['VmHWM',v=>procPeakRssMB=v],['RssAnon',v=>procAnonMB=v]]){const m=status.match(new RegExp('^'+key+':\\s+(\\d+) kB','m'));if(m)set(Number(m[1])/1024);}}catch{}
 const effective=actualArgs===null?null:actualArgs.maxOldSpacePresent?actualArgs:actualOptions?.maxOldSpacePresent?actualOptions:null;
 const effectiveSource=actualArgs===null?'unavailable_argv':actualArgs.maxOldSpacePresent?'argv':actualOptions===null?'unavailable_NODE_OPTIONS':actualOptions.maxOldSpacePresent?'NODE_OPTIONS':'default';
 const candidate=effective??(actualArgs===null&&configuredArgs.maxOldSpacePresent?configuredArgs:actualArgs===null&&actualOptions?.maxOldSpacePresent?actualOptions:actualOptions===null&&configuredOptions.maxOldSpacePresent?configuredOptions:null);
 const candidateSource=effective?effectiveSource:candidate===configuredArgs?'unverified_pm2_node_args':candidate===configuredOptions?'unverified_pm2_NODE_OPTIONS':candidate?'unverified_NODE_OPTIONS':effectiveSource==='default'?'default':'unverified_default';
 try{
  const args=[];if(!nodeExecutableVerified)throw Error('not_node');
  if(candidate?.maxOldSpaceMiB!==null&&candidate?.maxOldSpaceMiB!==undefined)args.push('--max-old-space-size='+candidate.maxOldSpaceMiB);
  args.push('-p',"JSON.stringify({node:process.versions.node,v8:process.versions.v8,heapLimitMB:require('node:v8').getHeapStatistics().heap_size_limit/1048576})");
  const raw=JSON.parse(cp.execFileSync(`/proc/${pid}/exe`,args,{encoding:'utf8',timeout:5000,maxBuffer:4096,stdio:['ignore','pipe','ignore'],env:{PATH:process.env.PATH||'',NODE_OPTIONS:''}}));
  let sameCgroup=null;try{sameCgroup=fs.readFileSync(`/proc/${pid}/cgroup`,'utf8').trim()===fs.readFileSync('/proc/self/cgroup','utf8').trim();}catch{}
  if(/^\d+\.\d+\.\d+$/.test(raw.node)&&/^\d+(?:\.\d+){1,4}(?:-node\.\d+)?$/.test(raw.v8)&&typeof raw.heapLimitMB==='number'&&Number.isFinite(raw.heapLimitMB))replica={node:raw.node,v8:raw.v8,heapLimitMB:raw.heapLimitMB,source:'fresh_same_executable_old_space_only',oldSpaceInputSource:candidateSource,isActualAppHeap:false,sameCgroup};
 }catch{}
 const cgroup=cgroupMemory(pid),hostMemMB=os.totalmem()/1048576;
 return {available:true,pid,nodeExecutableVerified,argvObservable:actualArgs!==null,actualNodeVersion:replica?.node??null,configuredArgs,configuredOptions,actualArgs,actualOptions,effectiveSource,effectiveMaxOldSpaceMiB:effective?.maxOldSpaceMiB??null,candidateSource,candidateMaxOldSpaceMiB:candidate?.maxOldSpaceMiB??null,replica,
  procRssMB,procPeakRssMB,procAnonMB,heapUsedMB:pm2MemoryMetric(env,'Used Heap Size'),heapTotalMB:pm2MemoryMetric(env,'Heap Size'),externalMB:pm2MemoryMetric(env,'External Memory'),arrayBuffersMB:pm2MemoryMetric(env,'Array Buffer Memory'),appHeapSource:'existing_pm2_metrics_only',cgroup,hostMemMB,effectiveSystemLimitMB:cgroup.limitMB==null?hostMemMB:Math.min(hostMemMB,cgroup.limitMB)};
}
const since=Date.now()-7*864e5, categories={timeout:/timeout|timed out|ETIMEDOUT/i,dbTimeout:/RequestError.*timeout|ConnectionError.*timeout|ETIMEOUT|request.*timed out/i,upstreamTimeout:/upstream.*timeout|gateway timeout/i,externalTimeout:/fetch failed|ECONNABORTED|AbortError|UND_ERR_CONNECT_TIMEOUT/i,connection:/ECONNRESET|ECONNREFUSED|ESOCKET|pool.*exhaust/i,lock:/deadlock|lock timeout|blocking/i,memory:/out of memory|ENOMEM|heap out/i,activityWorker:/userActivityWorker\.cjs|ERR_WORKER_PATH|ACTIVITY_QUEUE_FULL/i,activityWrite:/\[user-activity\] write_failed/i,error:/\b(?:error|failed|exception)\b/i};
const safeNumber=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
const safeMemory=value=>typeof value==='number'?safeNumber(value):typeof value==='string'&&/^\d+(?:[KMG]B?)?$/i.test(value)?value:null;
const safeCron=value=>!value?null:typeof value==='string'&&(/^[\d*/?,\-\s]{1,80}$/.test(value)||/^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$/.test(value))?value:'configured';
let processes=[];try{processes=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024}));}catch(e){console.log(JSON.stringify({section:'pm2',error:e.code||'unavailable'}));}
console.log(JSON.stringify({section:'host_now',date:new Date().toISOString(),uptimeSec:Math.round(os.uptime()),load:os.loadavg().map(x=>+x.toFixed(2)),totalMemMB:Math.round(os.totalmem()/1048576),freeMemMB:Math.round(os.freemem()/1048576)}));
for(const p of processes.filter(p=>/nenova|erp/i.test(p.name||'')))console.log(JSON.stringify({section:'node_memory_config',...processMemoryDiagnostic(p)}));
try{
 const file=path.join(process.env.PM2_HOME||path.join(os.homedir(),'.pm2'),'pm2.log');
 const stat=fs.statSync(file),bytes=Math.min(stat.size,4*1024*1024),buffer=Buffer.alloc(bytes),fd=fs.openSync(file,'r');
 try{fs.readSync(fd,buffer,0,bytes,stat.size-bytes);}finally{fs.closeSync(fd);}
 const until=Date.now(),pmIds=processes.filter(p=>/nenova|erp/i.test(p.name||'')).map(p=>p.pm2_env?.pm_id??p.pm_id);
 console.log(JSON.stringify({section:'pm2_memory_restart_30m',available:true,scannedBytes:bytes,tailTruncated:stat.size>bytes,...summarizeMemoryRestarts(buffer.toString('utf8'),{since:until-30*60000,until,pmIds})}));
}catch{console.log(JSON.stringify({section:'pm2_memory_restart_30m',available:false}));}
for(const p of processes.filter(p=>/nenova|erp/i.test(p.name||''))){
 const env=p.pm2_env||{},mon=p.monit||{};
 console.log(JSON.stringify({section:'pm2',name:p.name,status:env.status,pid:p.pid,restarts:env.restart_time,uptime:new Date(env.pm_uptime||0).toISOString(),cpuPercent:mon.cpu,memoryMB:Math.round((mon.memory||0)/1048576),maxMemoryRestart:safeMemory(env.max_memory_restart),watchEnabled:Array.isArray(env.watch)?env.watch.length>0:Boolean(env.watch),watchPathCount:Array.isArray(env.watch)?env.watch.length:null,cronRestart:safeCron(env.cron_restart),autorestart:typeof env.autorestart==='boolean'?env.autorestart:null,restartDelayMs:safeNumber(env.restart_delay),backoffRestartDelayMs:safeNumber(env.exp_backoff_restart_delay),unstableRestarts:safeNumber(env.unstable_restarts)}));
 for(const [kind,file] of Object.entries({out:env.pm_out_log_path,err:env.pm_err_log_path})){
  if(!file)continue;
  try{
   const stat=fs.statSync(file),bytes=Math.min(stat.size,4*1024*1024),buf=Buffer.alloc(bytes),fd=fs.openSync(file,'r');
   try{fs.readSync(fd,buf,0,bytes,stat.size-bytes);}finally{fs.closeSync(fd);}
   const text=buf.toString('utf8'),until=Date.now();
   if(p.name==='nenova-erp'){
    console.log(JSON.stringify({section:'profit_read_failures_30m',kind,scannedBytes:bytes,tailTruncated:stat.size>bytes,...summarizeProfitReadFailures(text,{since:until-30*60000,until})}));
    console.log(JSON.stringify({section:'profit_source_changes_30m',kind,scannedBytes:bytes,tailTruncated:stat.size>bytes,...summarizeProfitSourceChanges(text,{since:until-30*60000,until})}));
   }
   const counts=Object.fromEntries(Object.keys(categories).map(k=>[k,0]));let dated=0,undated=0;
   for(const line of text.split(/\r?\n/)){
    const dt=line.match(/20\d\d[-/]\d\d[-/]\d\d[ T]\d\d:\d\d/),when=dt?Date.parse(dt[0].replaceAll('/','-')+'Z'):NaN;
    if(Number.isFinite(when)&&when<since)continue;if(Number.isFinite(when))dated++;else undated++;
    for(const [k,re] of Object.entries(categories))if(re.test(line))counts[k]++;
   }
   console.log(JSON.stringify({section:'pm2_log',name:p.name,kind,scannedBytes:bytes,datedLines:dated,undatedLines:undated,counts}));
  }catch(e){console.log(JSON.stringify({section:'pm2_log',name:p.name,kind,error:e.code||'unavailable'}));}
 }
}
try{const r=cp.spawnSync('journalctl',['-k','--since','7 days ago','--no-pager','-o','short-iso'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});const hits=(r.stdout||'').split('\n').filter(x=>/out of memory|oom-kill|killed process/i.test(x));const hours={};for(const line of hits){const hour=line.match(/^20\d\d-\d\d-\d\dT\d\d/);if(hour)hours[hour[0]]=(hours[hour[0]]||0)+1;}console.log(JSON.stringify({section:'kernel',available:r.status===0,oomEvents:hits.length,oomHours:hours}));}catch(e){console.log(JSON.stringify({section:'kernel',error:e.code||'unavailable'}));}
