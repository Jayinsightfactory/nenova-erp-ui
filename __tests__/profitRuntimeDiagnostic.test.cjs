const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('runtime diagnostic exposes restart controls without environment secrets or watch paths',()=>{
 const source=fs.readFileSync('scripts/diagnose-runtime-readonly.cjs','utf8'),logs=[];
 const fake={name:'nenova-erp',pid:1,monit:{cpu:0,memory:645*1048576},pm2_env:{status:'online',restart_time:266,pm_uptime:Date.now(),max_memory_restart:700*1048576,watch:['/PRIVATE_PATH'],cron_restart:'0 4 * * *',autorestart:true,restart_delay:0,env:{TOKEN:'PRIVATE_TOKEN'}}};
 const run=value=>vm.runInNewContext(source,{Buffer,Date,require:name=>({'node:fs':{},'node:path':{},'node:os':{uptime:()=>10,loadavg:()=>[0,0,0],totalmem:()=>4096*1048576,freemem:()=>2413*1048576},'node:child_process':{execFileSync:()=>JSON.stringify([value]),spawnSync:()=>({status:0,stdout:''})}}[name]),console:{log:value=>logs.push(value)}});
 run(fake);const row=logs.map(JSON.parse).find(row=>row.section==='pm2');
 assert.equal(row.maxMemoryRestart,700*1048576);assert.equal(row.watchEnabled,true);assert.equal(row.watchPathCount,1);assert.equal(row.cronRestart,'0 4 * * *');assert.equal(row.restartDelayMs,0);assert(!logs.join('').includes('PRIVATE_'));
 logs.length=0;run({...fake,pm2_env:{...fake.pm2_env,max_memory_restart:'PRIVATE_TOKEN',cron_restart:'PRIVATE_TOKEN'}});const bad=logs.map(JSON.parse).find(row=>row.section==='pm2');assert.equal(bad.maxMemoryRestart,null);assert.equal(bad.cronRestart,'configured');assert(!logs.join('').includes('PRIVATE_'));
});
