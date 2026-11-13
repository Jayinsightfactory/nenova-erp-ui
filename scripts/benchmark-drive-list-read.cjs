'use strict';
// One disposable, representative volume. No credentials/SQL/production endpoints.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {sendDriveListJson}=require('../lib/workDriveListResponse.cjs');
const {decodeDriveList}=require('../lib/workDriveListTable.cjs');
const {launch}=require('../lib/workDriveChild.cjs');
const {createDriveListReader,createDriveUsageReader}=require('../lib/workDriveListAsync.cjs');
const projectRoot=process.cwd(),prior=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-list-bench-')),root=path.join(dir,'data/drive'),boss={userId:'nenovaSS3',userName:'fixture-admin'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
require('node:module').register(pathToFileURL(path.join(projectRoot,'scripts/work-drive-esm-loader.mjs')));
let server,reader,usageReader,probe,usageActive=false,listWhileUsage=false;
const probeSource=`const http=require('node:http'),url=process.argv[1],samples=[];let stop=false;function next(){const start=performance.now();http.get(url,res=>{res.resume();res.on('end',()=>{samples.push(performance.now()-start);if(samples.length===1)process.send({ready:true});if(stop){samples.sort((a,b)=>a-b);process.send({count:samples.length,p95Ms:samples[Math.ceil(samples.length*.95)-1],maxMs:samples.at(-1)});process.disconnect();}else setTimeout(next,5);});}).on('error',()=>process.exit(2));}process.on('message',()=>{stop=true;});next();`;
async function measure(mode,url){
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
 probe=spawn(process.execPath,['-e',probeSource,url+'/heartbeat'],{env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});await new Promise((resolve,reject)=>{probe.once('error',reject);probe.once('message',resolve);});await sleep(15);
 const started=performance.now(),response=await fetch(url+'/'+mode),bytes=Buffer.from(await response.arrayBuffer()),decodeStarted=performance.now(),decoded=decodeDriveList(JSON.parse(bytes)),decodeMs=performance.now()-decodeStarted,listMs=performance.now()-started;
 const done=new Promise((resolve,reject)=>{probe.once('message',resolve);probe.once('error',reject);});probe.send('stop');const heartbeat=await done;await new Promise(resolve=>probe.once('exit',resolve));probe=null;
 return {listMs:Math.round(listMs*100)/100,status:response.status,payloadBytes:bytes.length,gzipBytes:require('node:zlib').gzipSync(bytes).length,decodeMs:Math.round(decodeMs*100)/100,heartbeat,body:decoded};
}
(async()=>{
 fs.mkdirSync(path.join(root,'originals'),{recursive:true});let index='';
 for(let i=0;i<12000;i++){
  const filename='fixture-'+i+'.txt',rel='originals/'+filename;fs.writeFileSync(path.join(root,rel),'fixture '+i);
  index+=JSON.stringify({id:'fixture-'+i,filename,rel,size:Buffer.byteLength('fixture '+i),sha:'fixture-'+i,cycle:'40-1',stage:'발주',dept:'synthetic',deptId:'synthetic',uploaderName:'fixture',sourceDir:'synthetic/'+'.'.repeat(460),uploadedAt:'2026-11-01T00:00:00Z',deleted:false,sensitive:false})+'\n';
 }
 fs.writeFileSync(path.join(root,'index.jsonl'),index);process.chdir(dir);const wd=await import(pathToFileURL(path.join(projectRoot,'lib/workDrive.js')));reader=createDriveListReader({projectRoot,launchChild:(...args)=>{const child=launch(...args),send=child.postMessage;child.postMessage=message=>{delete message.knownSignature;send(message);};return child;}});
 server=http.createServer(async(req,res)=>{
  if(req.url==='/heartbeat'){res.end('ok');return;}
  try{
   if(req.url==='/usage'){usageActive=true;try{const snapshot=await usageReader.read();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,usage:snapshot.usage}));}finally{usageActive=false;}return;}
   if(req.url==='/warm'&&usageActive)listWhileUsage=true;
   let files,usage;if(req.url==='/before'){files=wd.listVisible(boss);usage=wd.driveUsage();}else{const snapshot=await reader.read({includeUsage:!['/after','/warm'].includes(req.url)});files=wd.listVisible(boss,snapshot.rows);usage=snapshot.usage ?? null;}
   if(req.url==='/after'||req.url==='/warm')await sendDriveListJson(res,{success:true,files,usage},{table:true});
   else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,files,usage}));}
  }catch{res.statusCode=503;res.end('{}');}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const before=await measure('isolated',url),beforeWarm=await measure('isolated',url);delete beforeWarm.body;await reader.close();reader=createDriveListReader({projectRoot});usageReader=createDriveUsageReader({projectRoot});
 const after=await measure('after',url);const usageStarted=performance.now(),usagePromise=fetch(url+'/usage').then(async response=>({status:response.status,data:await response.json(),elapsedMs:Math.round((performance.now()-usageStarted)*100)/100}));
 const warm=await measure('warm',url),usageResult=await usagePromise,expectedUsage=wd.driveUsage(),sameUsage=['used','files','indexedNaive','onDisk','onDiskFiles'].every(key=>usageResult.data.usage[key]===expectedUsage[key]),sameFiles=JSON.stringify(before.body.files)===JSON.stringify(after.body.files)&&JSON.stringify(before.body.files)===JSON.stringify(warm.body.files);delete before.body;delete after.body;delete warm.body;
 const report={volume:{files:12000,indexBytes:Buffer.byteLength(index)},before,beforeWarm,after,warm,usage:{status:usageResult.status,elapsedMs:usageResult.elapsedMs,sameUsage,listWhileUsage,listDiskWalks:reader.stats().diskWalks,usageDiskWalks:usageReader.stats().diskWalks},sameFiles,heartbeatMaxImproved:after.heartbeat.maxMs<before.heartbeat.maxMs};console.log(JSON.stringify(report,null,2));
 const output=process.argv[2];if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));}if(before.status!==200||after.status!==200||!sameFiles||!sameUsage||reader.stats().diskWalks!==0)process.exitCode=1;
})().catch(()=>{console.error('SYNTHETIC_LIST_BENCHMARK_FAILED');process.exitCode=1;}).finally(async()=>{
 if(probe)probe.kill();if(reader)await reader.close();if(usageReader)await usageReader.close();if(server)await new Promise(resolve=>server.close(resolve));process.chdir(prior);if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('nenova-list-bench-'))throw Error('Unsafe fixture path');fs.rmSync(dir,{recursive:true,force:true});
});
