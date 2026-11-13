#!/usr/bin/env node
'use strict';
// Real local Next + disposable SQL fixture. No production URLs, data or credentials.
 // Start scripts/setup-drive-ingest-synthetic-db.cjs first. --seconds=1800 runs a 30-minute stage.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),{spawn}=require('node:child_process');
const XLSX=require('xlsx');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const project=process.cwd(),seconds=Number(args.seconds||20),counts=String(args.counts||'5,10,20').split(',').map(Number),production=args.production==='1';
if(!Number.isFinite(seconds)||seconds<5||seconds>7200||counts.some(n=>![5,10,20].includes(n)))throw Error('Use --seconds=5..7200 and --counts=5,10,20');
const base=path.resolve(project,'work','mixed-load'),state=JSON.parse(fs.readFileSync(args['db-state']||path.join(base,'db-state.json'),'utf8'));
if(state.host!=='127.0.0.1'||state.database!=='NenovaUploadSynthetic'||!/^nenova-upload-synthetic-\d+$/.test(state.name))throw Error('Only the disposable loopback synthetic SQL fixture is allowed');
const runId=Date.now().toString(36),runtime=path.join(base,'runtime-'+runId),port=14349,origin='http://127.0.0.1:'+port;
const output=path.resolve(args.output||path.join(base,'result-'+runId+'.json'));
const summary={schemaVersion:1,runId,mode:production?'actual-next-production-webpack-target-api-snapshot':'actual-next-development-webpack-warmed',startedAt:new Date().toISOString(),configuredStageSeconds:seconds,sql:{engine:'SQL Server 2022 Docker',syntheticUsers:20,productionData:false},stages:[],errors:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const percentile=(a,p)=>a.length?Math.round([...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)]*100)/100:null;
const stats=a=>({count:a.length,p95Ms:percentile(a.map(x=>x.ms),.95),maxMs:a.length?Math.max(...a.map(x=>x.ms)):null,statuses:a.reduce((m,x)=>(m[x.status]=(m[x.status]||0)+1,m),{}),timeouts:a.filter(x=>x.timeout).length,errors:a.filter(x=>x.error).length});
let server,logs,agent=new http.Agent({keepAlive:true,maxSockets:128}),liveUploads=0;
function copyTree(from,to){if(!fs.existsSync(from))return;fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){const src=path.join(from,e.name),dest=path.join(to,e.name);if(e.isDirectory())copyTree(src,dest);else if(e.isFile()&&/\.(?:[cm]?js|jsx|json|tsx?|css|sql)$/.test(e.name))fs.copyFileSync(src,dest);}}
function snapshot(){
 fs.mkdirSync(runtime,{recursive:true});
 for(const dir of ['lib','config','desktop/shell','scripts'])copyTree(path.join(project,dir),path.join(runtime,dir));
 for(const route of ['auth/login.js','desktop/home-workspace.js','work/drive-ingest.js','sales/profit-report.js']){const dest=path.join(runtime,'pages/api',route);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,'pages/api',route),dest);}
 // Static source dependency of the existing boot scheduler; no runtime DB/Drive data.
 for(const manifest of ['data/profit-report-evidence/manual-input-manifest.v1.json','data/profit-report-evidence/awb-weight-attestations.v1.json','data/profit-report-evidence/historical-rates-2026-01-21.json','data/profit-report-inventory-catalog/v1/index.json','data/profit-template-duty-2026.json','data/profit-official-duty-2026.json','data/profit-workbook-duty-2026.json','data/profit-china-duty-recovery-2026.json']){fs.mkdirSync(path.dirname(path.join(runtime,manifest)),{recursive:true});fs.copyFileSync(path.join(project,manifest),path.join(runtime,manifest));}
 for(const name of ['package.json','next.config.js','instrumentation.js','web.js'])fs.copyFileSync(path.join(project,name),path.join(runtime,name));
 // Bind only to loopback; otherwise this is the same real web.js entry point.
 const entry=path.join(runtime,'web.js');fs.writeFileSync(entry,fs.readFileSync(entry,'utf8').replace("const hostname = '0.0.0.0';","const hostname = '127.0.0.1';").replace("next({ dev, hostname, port })","next({ dev, hostname, port, webpack:true })"));
 fs.symlinkSync(fs.realpathSync(path.join(project,'node_modules')),path.join(runtime,'node_modules'),'junction');
 const home=path.join(runtime,'data/runtime/personal-home');fs.mkdirSync(home,{recursive:true});
 const now=new Date(),date=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
 for(let i=1;i<=20;i++){
  const ownerId='synthetic'+String(i).padStart(2,'0'),rules=[];
  for(let j=0;j<250;j++)rules.push({id:crypto.randomUUID(),title:'Synthetic task '+j,versions:[{effectiveFrom:date,startDate:date,frequency:'daily',weekdays:[0,1,2,3,4,5,6],title:'Synthetic task '+j}],occurrences:{}});
  fs.writeFileSync(path.join(home,hash(ownerId)+'.json'),JSON.stringify({schemaVersion:1,ownerId,revision:1,rules,reads:{},requests:{}}));
 }
 summary.snapshot={fileCount:fs.readdirSync(path.join(runtime,'lib')).length,personalTasksPerUser:250};
 // Representative multi-megabyte append-only history, with real synthetic originals.
 const drive=path.join(runtime,'data/drive'),history=path.join(drive,'history');fs.mkdirSync(history,{recursive:true});let index='';
 for(let i=0;i<12000;i++){
  const bytes=Buffer.from('Historical synthetic original '+i),rel='history/'+i+'.txt';fs.writeFileSync(path.join(drive,rel),bytes);
  index+=JSON.stringify({id:'history-'+i,filename:'historical-'+i+'.txt',rel,sha:hash(bytes),size:bytes.length,ext:'txt',cycle:'',stage:'미분류',dept:'Synthetic',deptId:'synthetic',uploaderName:'Synthetic History',orbitUserId:'history',hostname:'SYNTHETIC-HISTORY',sourceDir:'synthetic/'+'.'.repeat(260),mtime:'2026-01-01T00:00:00Z',eventType:'synthetic',sensitive:false,confidence:0,version:1,uploadedAt:'2026-01-01T00:00:00Z',deleted:false})+'\n';
 }
 fs.writeFileSync(path.join(drive,'index.jsonl'),index);summary.snapshot.historicalOriginals=12000;summary.snapshot.initialIndexBytes=Buffer.byteLength(index);
}
function makeWorkbook(label,target=0){
 const book=XLSX.utils.book_new();for(let i=1;i<=12;i++)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic fixture',label],['Quantity',10],['Amount',12.5]]),i+'-1');
 const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true});if(!target)return bytes;
 const zip=XLSX.CFB.read(bytes,{type:'buffer'});XLSX.CFB.utils.cfb_add(zip,'synthetic/padding.bin',Buffer.alloc(1));const baseLength=XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:false}).length;
 const padding=zip.FileIndex[zip.FullPaths.findIndex(p=>p.endsWith('/synthetic/padding.bin'))];padding.content=Buffer.alloc(target-baseLength+1,37);padding.size=padding.content.length;const result=XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:false});
 if(result.length!==target||XLSX.read(result,{type:'buffer',bookSheets:true}).SheetNames.length!==12)throw Error('Maximum workbook validation failed');return result;
}
function makePdf(label){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream=`BT /F1 12 Tf 20 90 Td (Synthetic invoice ${label}) Tj ET`;objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);let text='%PDF-1.4\n',offsets=[0];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(text);
}
function fixtures(){
 const dir=path.join(runtime,'fixtures');fs.mkdirSync(dir);const all=[];
 for(let i=1;i<=20;i++)for(const kind of ['xlsx','pdf']){
  const name=kind==='xlsx'?`2026 40-1 원가자료 synthetic-${runId}-${i}.xlsx`:`2026 40-1 invoice synthetic-${runId}-${i}.pdf`,bytes=kind==='xlsx'?makeWorkbook(i):makePdf(i),file=path.join(dir,name);fs.writeFileSync(file,bytes);all.push({file,name,size:bytes.length,sha:hash(bytes),identity:i,kind});
 }
 const bytes=makeWorkbook('exact25MiB',25*1024*1024),name=`2026 40-1 원가자료 exact25MiB-${runId}.xlsx`,file=path.join(dir,name);fs.writeFileSync(file,bytes);all.push({file,name,size:bytes.length,sha:hash(bytes),identity:0,kind:'max25MiB'});return all;
}
function request(route,{method='GET',token,json,file,identity,timeoutMs=15000}={}){
 const started=performance.now(),overlap=liveUploads>0;
 return new Promise(resolve=>{
  const headers={};if(token)headers.authorization='Bearer '+token;
  let body,prefix,suffix,stream,done=false,timedOut=false;
  if(json){body=Buffer.from(JSON.stringify(json));headers['content-type']='application/json';headers['content-length']=body.length;}
  if(file){const boundary='synthetic-'+crypto.randomBytes(12).toString('hex'),fields={filename:file.name,orbitUserId:identity,userName:identity,hostname:'SYNTHETIC-PC',dir:'synthetic-fixture',eventType:'load-test',mtime:new Date().toISOString()};prefix=Buffer.from(Object.entries(fields).map(([key,value])=>`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('')+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.${file.kind==='pdf'?'pdf':'xlsx'}"\r\nContent-Type: application/octet-stream\r\n\r\n`);suffix=Buffer.from(`\r\n--${boundary}--\r\n`);headers['content-type']='multipart/form-data; boundary='+boundary;headers['content-length']=prefix.length+file.size+suffix.length;}
  const finish=(result)=>{if(done)return;done=true;stream?.destroy();resolve({ms:Math.round((performance.now()-started)*100)/100,started,ended:performance.now(),overlap,timeout:timedOut,...result});};
  const req=http.request(origin+route,{method,headers,agent},res=>{let text='';res.on('data',chunk=>{text+=chunk;if(text.length>2*1024*1024)req.destroy();});res.on('end',()=>{let data;try{data=JSON.parse(text);}catch{}finish({status:res.statusCode,data,retryAfter:Number(res.headers['retry-after']||0)});if(file&&!req.writableEnded)req.destroy();});});
  req.setTimeout(timeoutMs,()=>{timedOut=true;req.destroy();});req.on('error',()=>finish({status:0,error:true}));
  if(file){req.write(prefix);stream=fs.createReadStream(file.file);stream.on('error',()=>req.destroy());stream.on('end',()=>req.end(suffix));stream.pipe(req,{end:false});}else req.end(body);
 });
}
async function startServer(){
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{NODE_ENV:production?'production':'development',NEXT_TELEMETRY_DISABLED:'1',PORT:String(port),DB_SERVER:state.host,DB_PORT:String(state.port),DB_NAME:state.database,DB_USER:state.user,DB_PASSWORD:state.password,JWT_SECRET:'SyntheticJwt!'+crypto.randomBytes(24).toString('hex'),ORBIT_DRIVE_INGEST_TOKEN:'SyntheticIngest!'+crypto.randomBytes(24).toString('hex'),NENOVA_WORK_LOGS:'1',NENOVA_BUILD_WORKERS:'1'});
 summary.telemetryPath=path.join(runtime,'data/runtime/server-logs');
 logs=fs.openSync(path.join(runtime,'server.log'),'a');
 if(production){const start=performance.now(),buildEnv={...env};delete buildEnv.DB_SERVER;const build=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'build','--webpack'],{cwd:runtime,env:buildEnv,stdio:['ignore',logs,logs],windowsHide:true});const code=await new Promise(resolve=>build.once('exit',resolve));summary.productionBuildSeconds=Math.round((performance.now()-start)/10)/100;if(code!==0)throw Error('Isolated production API build failed; inspect server.log');}
 server=spawn(process.execPath,['web.js'],{cwd:runtime,env,stdio:['ignore',logs,logs],windowsHide:true});
 let login;for(let i=0;i<90;i++){if(server.exitCode!==null)throw Error('Next server exited during startup; inspect isolated server.log');login=await request('/api/auth/login',{method:'POST',json:{userId:'synthetic01',password:state.loginPassword},timeoutMs:10000});if(login.status===200&&login.data?.success)break;await sleep(1000);}
 if(login.status!==200)throw Error('Next SQL login readiness failed');
 const home=await request('/api/desktop/home-workspace',{token:login.data.token});if(home.status!==200||!home.data?.success)throw Error('Authenticated personal-home readiness failed');
 const warm=path.join(runtime,'fixtures','warm.txt');fs.writeFileSync(warm,'warm-up fixture');const r=await request('/api/work/drive-ingest',{method:'POST',token:env.ORBIT_DRIVE_INGEST_TOKEN,file:{file:warm,name:'warm-up.txt',size:15,kind:'txt'},identity:'warm',timeoutMs:60000});if(r.status!==200)throw Error('Upload route readiness failed: '+r.status);
 return env.ORBIT_DRIVE_INGEST_TOKEN;
}
async function stage(concurrency,all,ingestToken){
 const started=performance.now(),stopAt=started+seconds*1000,logs={login:[],home:[],upload:[]},accepted=new Map(),failures=[];let stopReaders=false;
 const maxFixture=(()=>{const bytes=makeWorkbook('max-'+runId+'-'+concurrency,25*1024*1024),name=`2026 40-1 원가자료 max25MiB-${runId}-${concurrency}.xlsx`,file=path.join(runtime,'fixtures',name);fs.writeFileSync(file,bytes);return {file,name,size:bytes.length,sha:hash(bytes),kind:'max25MiB'};})();
 const tokens=new Map();for(let i=1;i<=concurrency;i++){const id='synthetic'+String(i).padStart(2,'0'),r=await request('/api/auth/login',{method:'POST',json:{userId:id,password:state.loginPassword}});if(r.status!==200)throw Error('Stage initial login failed');tokens.set(id,r.data.token);}
 const readers=[...tokens].flatMap(([id,token])=>[
  (async()=>{while(!stopReaders){const r=await request('/api/auth/login',{method:'POST',json:{userId:id,password:state.loginPassword}});logs.login.push(r);if(r.status!==200||!r.data?.success)failures.push('login');await sleep(250);}})(),
  (async()=>{while(!stopReaders){const r=await request('/api/desktop/home-workspace?expectedOwnerId='+id,{token});logs.home.push(r);if(r.status!==200||!r.data?.success||r.data.ownerId!==id||r.data.totalTasks!==250||!r.data.tasks.every(task=>/^Synthetic task \d+$/.test(task.title)))failures.push('home');await sleep(250);}})()
 ]);
 const uploadStart=performance.now();
 await Promise.all([...tokens.keys()].map(async(id,index)=>{
  const files=all.filter(f=>f.identity===index+1);if(index===0)files.unshift(maxFixture);
  let iteration=0;
  do{
   let file;
   if(iteration<files.length)file=files[iteration];
   else{
    const kind=iteration%2?'pdf':'xlsx',label=`${runId}-${concurrency}-${id}-v${iteration}`,name=kind==='pdf'?`2026 40-1 invoice ${label}.pdf`:`2026 40-1 원가자료 ${label}.xlsx`,bytes=kind==='pdf'?makePdf(label):makeWorkbook(label),target=path.join(runtime,'fixtures',name);fs.writeFileSync(target,bytes);file={file:target,name,size:bytes.length,sha:hash(bytes),kind};
   }
   iteration++;let done=false;
   for(let retry=0;retry<40&&!done;retry++){
    liveUploads++;let r;try{r=await request('/api/work/drive-ingest',{method:'POST',token:ingestToken,file,identity:id,timeoutMs:60000});}finally{liveUploads--;}
    logs.upload.push({...r,kind:file.kind,sha:file.sha});
    if(r.status===200&&r.data?.success){if(accepted.has(file.sha)&&accepted.get(file.sha)!==r.data.id)failures.push('duplicate-id');accepted.set(file.sha,r.data.id);done=true;}
    else if(r.status===503||r.status===429)await sleep(Math.max(20,Math.min(5000,r.retryAfter*1000||100))+Math.random()*100);
    else{failures.push('upload-'+r.status);done=true;}
   }
   if(!done)failures.push('retry-exhausted');
   await sleep(Math.max(5000,seconds*1000/120));
  }while(performance.now()<stopAt||iteration<files.length);
 }));
 const uploadEnd=performance.now();stopReaders=true;await Promise.all(readers);
 const indexFile=path.join(runtime,'data/drive/index.jsonl'),rows=fs.readFileSync(indexFile,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.type!=='download'),latest=new Map(rows.map(r=>[r.id,r]));let missing=0,badBytes=0;
 for(const [sha,id] of accepted){const row=latest.get(id);if(!row||row.sha!==sha){missing++;continue;}const abs=path.resolve(runtime,'data/drive',row.rel);if(!abs.startsWith(path.resolve(runtime,'data/drive')+path.sep))throw Error('Unsafe fixture index path');const bytes=fs.readFileSync(abs);if(bytes.length!==row.size||hash(bytes)!==sha)badBytes++;}
 const shaIds=new Map();for(const row of rows)if(row.sha){if(!shaIds.has(row.sha))shaIds.set(row.sha,new Set());shaIds.get(row.sha).add(row.id);}const shaDuplicates=[...shaIds.values()].filter(ids=>ids.size>1).length;
 const plannedUnique=new Set(logs.upload.map(r=>r.sha)).size;
 const result={concurrentIdentities:concurrency,configuredSeconds:seconds,actualSeconds:Math.round((performance.now()-started)/10)/100,uploadWindowSeconds:Math.round((uploadEnd-uploadStart)/10)/100,login:stats(logs.login),home:stats(logs.home),upload:stats(logs.upload),loginDuringUpload:stats(logs.login.filter(r=>r.overlap)),homeDuringUpload:stats(logs.home.filter(r=>r.overlap)),acceptedUniqueFiles:accepted.size,expectedUniqueFiles:plannedUnique,minimumFixtureCoverage:accepted.size>=concurrency*2+1,retryResponses:logs.upload.filter(r=>[429,503].includes(r.status)).length,maxSizeUploadSuccess:logs.upload.some(r=>r.kind==='max25MiB'&&r.status===200),integrity:{missing,badBytes,shaDuplicates},failures:failures.length};
 result.passed=!failures.length&&!missing&&!badBytes&&!shaDuplicates&&accepted.size===result.expectedUniqueFiles&&result.minimumFixtureCoverage&&result.maxSizeUploadSuccess&&result.login.timeouts===0&&result.home.timeouts===0&&result.upload.timeouts===0&&result.loginDuringUpload.count>0&&result.homeDuringUpload.count>0;
 fs.writeFileSync(path.join(runtime,`stage-${concurrency}-measurements.json`),JSON.stringify(logs,(_k,v)=>_k==='data'?undefined:v));return result;
}
(async()=>{
 snapshot();const all=fixtures();summary.fixtures={xlsx:true,pdf:true,maximumFileBytes:25*1024*1024,exact25MiBWorkbookValid:true};const token=await startServer();
 for(const n of counts){const result=await stage(n,all,token);summary.stages.push(result);console.log(JSON.stringify(result));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(summary,null,2));}
 summary.passed=summary.stages.every(s=>s.passed);if(!summary.passed)process.exitCode=1;
})().catch(e=>{summary.errors.push(e.message);process.exitCode=1;console.error(e.message);}).finally(async()=>{
 summary.finishedAt=new Date().toISOString();summary.exactWallSeconds=(Date.parse(summary.finishedAt)-Date.parse(summary.startedAt))/1000;
 if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(r=>server.once('exit',r)),sleep(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}
 agent.destroy();if(logs)fs.closeSync(logs);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(summary,null,2));
 console.log(JSON.stringify({results:output,passed:summary.passed||false,exactWallSeconds:summary.exactWallSeconds,isolatedRuntime:runtime}));
});
