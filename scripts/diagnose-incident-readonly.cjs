// Bounded, read-only historical numeric telemetry. Never emit request bodies or identities.
{
 const fs=require('node:fs');
 const from='2026-11-19T08:15:',to='2026-11-19T08:25:';
 const byMinute={};
 const file='/var/www/nenova-erp/data/runtime/server-logs/work-2026-11-19.jsonl';
 if(fs.existsSync(file)){
  const readline=require('node:readline');
  const input=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
  input.on('line',line=>{try{const v=JSON.parse(line);if(typeof v.at!=='string'||v.at<from||v.at>=to)return;const minute=v.at.slice(0,16),g=byMinute[minute]||={count:0,maxLoopMs:0,maxRssMiB:0,maxCpuPct:0,uploadCount:0,uploadErrors:0,maxUploadMs:0,stages:{}};
   if(v.kind==='minute'){g.count++;for(const [source,dest]of [['loopMaxMs','maxLoopMs'],['rssMiB','maxRssMiB'],['cpuPct','maxCpuPct']])if(Number.isFinite(v[source]))g[dest]=Math.max(g[dest],v[source]);const u=v.groups?.['/api/work/drive-ingest'];if(u){g.uploadCount+=Number(u.count)||0;g.uploadErrors+=Number(u.errors)||0;g.maxUploadMs=Math.max(g.maxUploadMs,Number(u.maxMs)||0);}}
   if(v.kind==='request'&&v.route==='/api/work/drive-ingest'){for(const k of ['admission','multipart','store','remit'])if(Number.isFinite(v.stages?.[k]))g.stages[k]=Math.max(g.stages[k]||0,v.stages[k]);}
  }catch{}});
  input.on('close',()=>console.log(JSON.stringify({section:'incident_numeric_telemetry',available:true,byMinute})));
 }else console.log(JSON.stringify({section:'incident_numeric_telemetry',available:false}));
}
