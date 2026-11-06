const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function memoryHelpers(deps={}){
 const source=fs.readFileSync('scripts/diagnose-runtime-readonly.cjs','utf8');
 return new Function('fs','cp','path','os','process',source.slice(source.indexOf('function memoryFlags'),source.indexOf('const since='))+';return {memoryFlags,nodePrefixArguments,byteLimit,cgroupMemory,processMemoryDiagnostic};')
  (deps.fs||{},deps.cp||{},require('node:path').posix,deps.os||{totalmem:()=>4096*1048576},deps.process||{env:{PATH:'/SAFE_BIN'}});
}
test('memory flags expose numbers/booleans only, preserve zero and last flag; script arguments are not V8 flags',()=>{
 const {memoryFlags:f,nodePrefixArguments:prefix}=memoryHelpers();
 for(const input of [undefined,null,false,0,'',[]])assert.equal(f(input).maxOldSpaceMiB,null);
 assert.equal(f('--max-old-space-size=1536 --require "/PRIVATE_PATH" --heap-prof-dir=PRIVATE_TOKEN --expose-gc').maxOldSpaceMiB,1536);
 assert.equal(f(['--max_old_space_size','0']).maxOldSpaceMiB,0);
 assert.equal(f(['--max-old-space-size=1024','--max-old-space-size','768']).maxOldSpaceMiB,768);
 assert.equal(f('--max-old-space-size=PRIVATE_TOKEN').invalidNumeric,true);
 assert.equal(f('--max-old-space-size --expose-gc').exposeGcPresent,true);
 const flags=f(prefix('/usr/bin/node\0--require\0/PRIVATE\0--max-old-space-size=768\0/app.js\0--max-old-space-size=4096\0'));
 assert.equal(flags.maxOldSpaceMiB,768);assert.equal(f(prefix('/usr/bin/node\0--\0--max-old-space-size=4096')).maxOldSpaceMiB,null);
 assert.equal(f('--max-semi-space-size=16 --max-heap-size=768 --max-old-space-size-percentage=50 --heapsnapshot-signal=PRIVATE_SIGNAL').heapSnapshotPresent,true);
 assert.doesNotMatch(JSON.stringify(f('--max-old-space-size=PRIVATE_TOKEN --require "/PRIVATE_PATH" --heap-prof-dir=PRIVATE_DIR')),/PRIVATE/);
});
test('actual argv overrides actual NODE_OPTIONS; replica has sanitized flags/environment and is not app heap',()=>{
 const files={'/proc/7/cmdline':'/usr/bin/node\0--max-old-space-size=768\0/app.js\0--max-old-space-size=4096',
  '/proc/7/environ':'TOKEN=PRIVATE_TOKEN\0NODE_OPTIONS=--max-old-space-size=1024 --require=/PRIVATE_PATH\0',
  '/proc/7/status':'VmRSS:\t500000 kB\nVmHWM:\t700000 kB\nRssAnon:\t400000 kB',
  '/proc/7/cgroup':'0::/PRIVATE_GROUP/child','/proc/self/cgroup':'0::/OTHER_PRIVATE_GROUP',
  '/sys/fs/cgroup/PRIVATE_GROUP/child/memory.max':'max','/sys/fs/cgroup/PRIVATE_GROUP/child/memory.current':'314572800',
  '/sys/fs/cgroup/PRIVATE_GROUP/memory.max':'1073741824','/sys/fs/cgroup/memory.max':'max'};
 let invocations=0;
 const h=memoryHelpers({fs:{readFileSync:file=>{if(!(file in files))throw Error('PRIVATE_ERROR');return files[file];},readlinkSync:()=>'/SAFE/node'},cp:{execFileSync:(file,args,options)=>{
  invocations++;assert.equal(file,'/proc/7/exe');assert.deepEqual(args.slice(0,2),['--max-old-space-size=768','-p']);
  assert.deepEqual(Object.keys(options.env).sort(),['NODE_OPTIONS','PATH']);assert.equal(options.env.NODE_OPTIONS,'');assert.doesNotMatch(JSON.stringify({args,env:options.env}),/PRIVATE/);
  return JSON.stringify({node:'22.11.0',v8:'12.4.254.21-node.21',heapLimitMB:816});
 }}});
 const row=h.processMemoryDiagnostic({pid:7,pm2_env:{node_args:['--max-old-space-size=2048'],NODE_OPTIONS:'--max-old-space-size=1536',env:{TOKEN:'PRIVATE_TOKEN'},axm_monitor:{'Used Heap Size':{value:'101.5',unit:'MiB'},'Heap Size':{value:128,unit:'MiB'},'External Memory':{value:'PRIVATE',unit:'MiB'}}}});
 assert.equal(invocations,1);assert.equal(row.effectiveSource,'argv');assert.equal(row.effectiveMaxOldSpaceMiB,768);assert.equal(row.configuredArgs.maxOldSpaceMiB,2048);assert.equal(row.actualOptions.maxOldSpaceMiB,1024);
 assert.equal(row.replica.isActualAppHeap,false);assert.equal(row.replica.sameCgroup,false);assert.equal(row.heapUsedMB,101.5);assert.equal(row.externalMB,null);assert.equal(row.arrayBuffersMB,null);
 assert.equal(row.cgroup.limitMB,1024);assert.equal(row.cgroup.currentMB,300);assert.equal(row.effectiveSystemLimitMB,1024);assert.equal(row.procRssMB,500000/1024);
 assert.doesNotMatch(JSON.stringify(row),/PRIVATE|\/proc|\/SAFE|TOKEN|--require/);
 files['/proc/7/cmdline']='/usr/bin/node\0/app.js';assert.equal(h.processMemoryDiagnostic({pid:7}).effectiveSource,'NODE_OPTIONS');
 files['/proc/7/cmdline']='next-server (v16.2.1)\0';
 const overwritten=h.processMemoryDiagnostic({pid:7,pm2_env:{node_args:'--max-old-space-size=768'}});
 assert.equal(overwritten.argvObservable,false);assert.equal(overwritten.actualArgs,null);assert.equal(overwritten.effectiveMaxOldSpaceMiB,null);assert.equal(overwritten.effectiveSource,'unavailable_argv');assert.equal(overwritten.candidateSource,'unverified_pm2_node_args');assert.equal(overwritten.replica.oldSpaceInputSource,'unverified_pm2_node_args');
});
test('cgroup v1/unlimited/missing and absent process data stay distinct; invalid numbers never default to zero',()=>{
 const {byteLimit}=memoryHelpers();assert.deepEqual(byteLimit('0'),{available:true,unlimited:false,limitMB:0});assert.equal(byteLimit('max').unlimited,true);assert.equal(byteLimit('9223372036854771712').unlimited,true);assert.equal(byteLimit('PRIVATE').available,false);
 const files={'/proc/9/cgroup':'4:cpu,memory:/PRIVATE_GROUP','/sys/fs/cgroup/memory/PRIVATE_GROUP/memory.limit_in_bytes':'2147483648','/sys/fs/cgroup/memory/PRIVATE_GROUP/memory.usage_in_bytes':'524288000','/sys/fs/cgroup/memory/memory.limit_in_bytes':'9223372036854771712'};
 const h=memoryHelpers({fs:{readFileSync:file=>{if(!(file in files))throw Error();return files[file];}}});
 assert.deepEqual(h.cgroupMemory(9),{available:true,version:1,limitMB:2048,unlimited:false,currentMB:500});
 const missing=h.processMemoryDiagnostic({pid:10});assert.equal(missing.effectiveSource,'unavailable_argv');assert.equal(missing.replica,null);assert.equal(missing.heapUsedMB,null);assert.equal(missing.cgroup.available,false);
 assert.equal(h.processMemoryDiagnostic({pid:0}).available,false);
});
test('runtime diagnostic exposes restart controls without environment secrets or watch paths',()=>{
 const source=fs.readFileSync('scripts/diagnose-runtime-readonly.cjs','utf8'),logs=[];
 const fake={name:'nenova-erp',pid:1,monit:{cpu:0,memory:645*1048576},pm2_env:{status:'online',restart_time:266,pm_uptime:Date.now(),max_memory_restart:700*1048576,watch:['/PRIVATE_PATH'],cron_restart:'0 4 * * *',autorestart:true,restart_delay:0,env:{TOKEN:'PRIVATE_TOKEN'}}};
 const run=value=>vm.runInNewContext(source,{Buffer,Date,process:{env:{}},require:name=>({'node:fs':{},'node:path':{},'node:os':{uptime:()=>10,loadavg:()=>[0,0,0],totalmem:()=>4096*1048576,freemem:()=>2413*1048576},'node:child_process':{execFileSync:()=>JSON.stringify([value]),spawnSync:()=>({status:0,stdout:''})}}[name]),console:{log:value=>logs.push(value)}});
 run(fake);const row=logs.map(JSON.parse).find(row=>row.section==='pm2');
 assert.equal(row.maxMemoryRestart,700*1048576);assert.equal(row.watchEnabled,true);assert.equal(row.watchPathCount,1);assert.equal(row.cronRestart,'0 4 * * *');assert.equal(row.restartDelayMs,0);assert(!logs.join('').includes('PRIVATE_'));
 logs.length=0;run({...fake,pm2_env:{...fake.pm2_env,max_memory_restart:'PRIVATE_TOKEN',cron_restart:'PRIVATE_TOKEN'}});const bad=logs.map(JSON.parse).find(row=>row.section==='pm2');assert.equal(bad.maxMemoryRestart,null);assert.equal(bad.cronRestart,'configured');assert(!logs.join('').includes('PRIVATE_'));
});
test('daemon memory reason counts only selected PM2 ids inside last30min; no raw lines or unrelated restarts',()=>{
 const source=fs.readFileSync('scripts/diagnose-runtime-readonly.cjs','utf8');
 const sum=new Function(source.slice(source.indexOf('function summarizeMemoryRestarts'),source.indexOf('const since='))+';return summarizeMemoryRestarts;')();
 const make=(at,id,tail='current_memory=1101004800 max_memory_limit=1073741824 [octets]')=>`${at}: PM2 log: [PM2][WORKER] Process ${id} restarted because it exceeds --max-memory-restart value (${tail}) PRIVATE_TOKEN`;
 const until=Date.parse('2026-11-06T07:00:00Z'),since=until-30*60000;
 const text=[make('2026-11-06T06:29:59Z',0),make('2026-11-06T06:30:00Z',0),make('2026-11-06T06:55:00Z',0),make('2026-11-06T06:59:00Z',1),make('2026-11-06T07:00:01Z',0),'2026-11-06T06:58:00Z: Process0 restarted due to deployment PRIVATE'].join('\n');
 assert.deepEqual(sum(text,{since,until,pmIds:[0]}),{count:2,latestTime:'2026-11-06T06:55:00.000Z',currentMB:1050,maxMB:1024,scoped:true});
 assert.equal(sum(text,{since,until,pmIds:[]}).scoped,false);
 assert.deepEqual(sum(make('2026-11-06T06:55:00Z',0,'PRIVATE_INVALID_BYTES'),{since,until,pmIds:[0]}),{count:1,latestTime:'2026-11-06T06:55:00.000Z',currentMB:null,maxMB:null,scoped:true});
 assert.doesNotMatch(JSON.stringify(sum(text,{since,until,pmIds:[0]})),/PRIVATE|Process|WORKER/);
});
