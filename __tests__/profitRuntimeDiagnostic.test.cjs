const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
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
