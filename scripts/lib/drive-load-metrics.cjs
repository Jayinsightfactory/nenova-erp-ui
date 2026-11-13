'use strict';
const fs=require('node:fs');
const {once}=require('node:events');
const NAMES=['login','home','upload','loginDuringUpload','homeDuringUpload'];
const LIMIT_MS=60000;
function bucket(){return {count:0,maxMs:0,statuses:Object.create(null),timeouts:0,errors:0,histogram:new Uint32Array(LIMIT_MS+2)};}
function add(target,event){
 target.count++;target.maxMs=Math.max(target.maxMs,event.ms);target.statuses[event.status]=(target.statuses[event.status]||0)+1;
 if(event.timeout)target.timeouts++;if(event.error)target.errors++;
 target.histogram[Math.min(LIMIT_MS+1,Math.ceil(event.ms))]++;
}
function snapshot(target){
 let seen=0,p95Ms=null;const threshold=Math.ceil(target.count*.95);
 if(target.count)for(let i=0;i<target.histogram.length;i++){seen+=target.histogram[i];if(seen>=threshold){p95Ms=i;break;}}
 return {count:target.count,p95Ms,maxMs:target.count?target.maxMs:null,statuses:{...target.statuses},timeouts:target.timeouts,errors:target.errors,percentileResolutionMs:1,p95Overflow: p95Ms===LIMIT_MS+1};
}
function numeric(value,fallback=0){return typeof value==='number'&&Number.isFinite(value)?value:fallback;}
function createLoadMetrics({sampleFile}={}){
 const buckets=Object.fromEntries(NAMES.map(name=>[name,bucket()]));
 // Optional local diagnostics only. Never serialize response bodies, JWTs, cookies,
 // identity strings, URLs or caller-provided object keys, even with samples enabled.
 const stream=sampleFile?fs.createWriteStream(sampleFile,{flags:'wx',mode:0o600,highWaterMark:64*1024}):null;
 let streamError,backpressure=0,closed=false;stream?.on('error',error=>{streamError=error;});
 async function record(name,result){
  if(!['login','home','upload'].includes(name)||closed)throw Error('INVALID_METRIC');
  const event={route:name,ms:Math.max(0,numeric(result.ms)),started:numeric(result.started),ended:numeric(result.ended),status:Math.min(599,Math.max(0,Math.trunc(numeric(result.status)))),overlap:result.overlap===true,timeout:result.timeout===true,error:result.error===true};
  add(buckets[name],event);if(event.overlap&&name!=='upload')add(buckets[name+'DuringUpload'],event);
  if(streamError)throw Error('METRIC_WRITE_FAILED');
  if(stream&&!stream.write(JSON.stringify(event)+'\n')){backpressure++;await once(stream,'drain');}
 }
 async function close(){if(closed)return;closed=true;if(stream){stream.end();await once(stream,'close');if(streamError)throw Error('METRIC_WRITE_FAILED');}}
 return {record,close,result:()=>Object.fromEntries(NAMES.map(name=>[name,snapshot(buckets[name])])),memory:()=>({histogramBytes:NAMES.length*(LIMIT_MS+2)*4,retainedResponseBodies:0,retainedRequestSamples:0,streamHighWaterBytes:stream?64*1024:0,backpressure})};
}
const METRIC_KEYS=['count','p95Ms','maxMs','timeouts','errors','percentileResolutionMs'];
function safeMetric(value={}){const result=Object.fromEntries(METRIC_KEYS.map(k=>[k,value[k]===null?null:numeric(value[k])]));result.p95Overflow=value.p95Overflow===true;result.statuses={};for(const [key,count] of Object.entries(value.statuses||{}))if(/^\d{1,3}$/.test(key)&&Number(key)<=599)result.statuses[key]=numeric(count);return result;}
function sanitizedSummary(summary){
 const safe={schemaVersion:2,mode:summary.mode==='actual-next-production-webpack-target-api-snapshot'?summary.mode:'actual-next-development-webpack-warmed',runId:/^[a-z0-9]+$/.test(summary.runId||'')?summary.runId:'redacted',configuredStageSeconds:numeric(summary.configuredStageSeconds),exactWallSeconds:numeric(summary.exactWallSeconds),productionBuildSeconds:numeric(summary.productionBuildSeconds),passed:summary.passed===true,errorCount:Array.isArray(summary.errors)?summary.errors.length:numeric(summary.errorCount),stages:[]};
 for(const key of ['startedAt','finishedAt'])if(typeof summary[key]==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(summary[key]))safe[key]=summary[key];
 if(/^[a-f0-9]{40}$/.test(summary.sourceRevision||''))safe.sourceRevision=summary.sourceRevision;
 safe.fixture={historicalOriginals:numeric(summary.snapshot?.historicalOriginals??summary.fixture?.historicalOriginals),initialIndexBytes:numeric(summary.snapshot?.initialIndexBytes??summary.fixture?.initialIndexBytes),personalTasksPerUser:250,maximumFileBytes:25*1024*1024,syntheticSqlOnly:true};
 for(const stage of summary.stages||[]){
  const s={};for(const k of ['concurrentIdentities','configuredSeconds','actualSeconds','uploadWindowSeconds','acceptedUniqueFiles','expectedUniqueFiles','retryResponses','failures'])s[k]=numeric(stage[k]);
  for(const k of ['minimumFixtureCoverage','maxSizeUploadSuccess','passed'])s[k]=stage[k]===true;
  for(const name of NAMES)s[name]=safeMetric(stage[name]);
  s.integrity={};for(const k of ['missing','badBytes','shaDuplicates'])s.integrity[k]=numeric(stage.integrity?.[k]);
  s.clientMemory={};for(const k of ['histogramBytes','retainedResponseBodies','retainedRequestSamples','streamHighWaterBytes','backpressure','rssMaxMiB','heapMaxMiB'])s.clientMemory[k]=numeric(stage.clientMemory?.[k]);safe.stages.push(s);
 }
 return safe;
}
function writeSafeSummary(file,summary){fs.mkdirSync(require('node:path').dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(sanitizedSummary(summary),null,2),{mode:0o600});}
module.exports={createLoadMetrics,sanitizedSummary,writeSafeSummary};
