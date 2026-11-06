const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const {runProbe,selectProcess,parseDatabaseFields,connectionConfig,safeFailure,IDENTITY_SQL}=require('../scripts/profit-database-identity-readonly.cjs');
const {reconstructNextEnvironment,summarizeRecoveryJournal,readRecoveryJournal}=require('../scripts/profit-database-identity-readonly.cjs');
const HASH='a'.repeat(64),fields={DB_SERVER:'PRIVATE_SERVER',DB_NAME:'PRIVATE_DB',DB_USER:'PRIVATE_USER',DB_PASSWORD:'PRIVATE_PASSWORD',DB_PORT:'1433'};
const row={IdentityHash:HASH,TaxableRateTablePresent:false,InvoiceTablesPresent:4,InvoiceUniqueKeyScopes:4,SnapshotIsolationState:0,ReadCommittedSnapshotOn:false};
function fixture(){let lists=0,connected=0,queries=0,closed=0,created=0;const processes=[{name:'nenova-erp',pid:123,pm2_env:{status:'online',env:{SECRET:'PRIVATE_JLIST'}}}];
 const deps={list:async()=>{lists++;return processes;},readEnviron:async pid=>{assert.equal(pid,123);return Buffer.from(Object.entries({...fields,OTHER_SECRET:'PRIVATE_OTHER'}).map(([k,v])=>k+'='+v).join('\0'));},localFields:async()=>fields,
  createPool:config=>{created++;assert.equal(config.pool.max,1);assert.equal(config.connectionTimeout,15000);assert.equal(config.requestTimeout,10000);assert.equal(config.options.requestTimeout,10000);return {connect:async()=>{connected++;},close:async()=>{closed++;},request:()=>({query:async text=>{queries++;assert.equal(text,IDENTITY_SQL);return {recordset:[row]};}})};}};
 return {deps,processes,stats:()=>({lists,connected,queries,closed,created})};
}
test('only DB5 fields decoded, source buffer zeroed, missing config never falls back',()=>{
 const input=Buffer.from('TOKEN=PRIVATE_OTHER\0DB_SERVER=PRIVATE_SERVER\0DB_USER=PRIVATE_USER\0DB_PASSWORD=PRIVATE_PASSWORD\0DB_NAME=PRIVATE_DB\0DB_PORT=1433\0');assert.deepEqual(parseDatabaseFields(input),fields);assert.ok(input.every(v=>v===0));
 const duplicate=Buffer.from('DB_NAME=x\0DB_NAME=y');assert.throws(()=>parseDatabaseFields(duplicate),{code:'IDENTITY_ENV_INVALID'});assert.ok(duplicate.every(v=>v===0));
 for(const port of [undefined,''])assert.equal(connectionConfig({...fields,DB_PORT:port}).port,1433);
 for(const port of [0,false,'0','70000','PRIVATE'])assert.throws(()=>connectionConfig({...fields,DB_PORT:port}),{code:'IDENTITY_ENV_INVALID'});
 assert.throws(()=>connectionConfig({}),{code:'CONFIG_UNAVAILABLE'});assert.throws(()=>connectionConfig({...fields,DB_NAME:undefined}),{code:'CONFIG_UNAVAILABLE'});
});
test('exact one online app and stable PID; one SELECT only, own pool closes on every acquired path',async()=>{
 const f=fixture(),result=await runProbe({mode:'production',expectedIdentityHash:HASH},f.deps);assert.equal(result.status,'PASS');assert.equal(result.matchesExpected,true);assert.equal(result.configSource,'proc_initial_environ');assert.deepEqual(f.stats(),{lists:2,connected:1,queries:1,closed:1,created:1});assert.doesNotMatch(JSON.stringify(result),/PRIVATE|DB_SERVER|DB_USER|DB_PASSWORD|DB_NAME|DB_PORT|"env":|"jlist":/i);
 const local=fixture();assert.equal((await runProbe({mode:'local'},local.deps)).identityHash,HASH);assert.equal(local.stats().lists,0);assert.equal(local.stats().queries,1);
 for(const rows of [[],[{name:'other',pid:1,pm2_env:{status:'online'}}],[...f.processes,...f.processes],[{name:'nenova-erp',pid:0,pm2_env:{status:'online'}}],[{name:'nenova-erp',pid:1,pm2_env:{status:'stopped'}}]])assert.throws(()=>selectProcess(rows),{code:'IDENTITY_TARGET_INVALID'});
 const changed=fixture();let count=0;changed.deps.list=async()=>[{name:'nenova-erp',pid:++count===1?123:124,pm2_env:{status:'online'}}];await assert.rejects(runProbe({mode:'production'},changed.deps),{code:'IDENTITY_TARGET_CHANGED'});assert.equal(changed.stats().closed,1);
 for(const phase of ['connect','query','invalid']){const g=fixture();g.deps.createPool=()=>({connect:async()=>{if(phase==='connect')throw Error('PRIVATE_CONNECT');},request:()=>({query:async()=>{if(phase==='query')throw Error('PRIVATE_QUERY');return {recordset:[{...row,IdentityHash:'PRIVATE_INVALID'}]};}}),close:async()=>{g.closed=true;}});await assert.rejects(runProbe({mode:'local'},g.deps));assert.equal(g.closed,true);}
});
test('missing initial proc fields refuses before pool and never reads local dotenv',async()=>{
 const f=fixture();f.deps.readEnviron=async()=>Buffer.from('DB_SERVER=PRIVATE\0TOKEN=PRIVATE');f.deps.localFields=async()=>assert.fail('no fallback');await assert.rejects(runProbe({mode:'production'},f.deps),{code:'CONFIG_UNAVAILABLE'});assert.equal(f.stats().created,0);
 const bad=fixture();await assert.rejects(runProbe({mode:'PRIVATE_MODE'},bad.deps),{code:'IDENTITY_MODE_INVALID'});await assert.rejects(runProbe({mode:'local',expectedIdentityHash:'PRIVATE'},bad.deps),{code:'IDENTITY_EXPECTED_INVALID'});assert.equal(bad.stats().created,0);
 const mismatch=fixture();const result=await runProbe({mode:'production',expectedIdentityHash:'b'.repeat(64)},mismatch.deps);assert.equal(result.status,'FAILED');assert.equal(result.code,'IDENTITY_MISMATCH');assert.equal(mismatch.stats().closed,1);
 assert.deepEqual(safeFailure({code:'PRIVATE',message:'PRIVATE_ENV',stack:'PRIVATE_SQL'}),{status:'FAILED',code:'IDENTITY_PROBE_FAILED'});
 assert.deepEqual(safeFailure({code:'CONFIG_UNAVAILABLE',reason:'NODE_ENV_UNPROVEN',message:'PRIVATE'}),{status:'FAILED',code:'CONFIG_UNAVAILABLE',reason:'NODE_ENV_UNPROVEN'});
 assert.deepEqual(safeFailure({code:'CONFIG_UNAVAILABLE',reason:'PRIVATE_PATH'}),{status:'FAILED',code:'CONFIG_UNAVAILABLE'});
});
test('owned request rejects every nonconstant query, batch and execute after its single SELECT',async()=>{
 const f=fixture();let request;f.deps.createPool=()=>({connect:async()=>{},close:async()=>{},request:()=>request={query:async()=>({recordset:[row]})}});
 await runProbe({mode:'production'},f.deps);
 for(const call of [()=>request.query('SELECT PRIVATE_OTHER'),()=>request.query('UPDATE Product SET X=1'),()=>request.query(IDENTITY_SQL),()=>request.batch('PRIVATE'),()=>request.execute('PRIVATE')])assert.throws(call,{code:'IDENTITY_QUERY_INVALID'});
});
test('same metadata SELECT exposes only typed isolation state0..3/RCSI boolean, rejects missing or coerced values',async()=>{
 for(const state of [0,1,2,3])for(const on of [false,true]){
  const f=fixture();f.deps.createPool=()=>({connect:async()=>{},close:async()=>{},request:()=>({query:async()=>({recordset:[{...row,SnapshotIsolationState:state,ReadCommittedSnapshotOn:on,PRIVATE:'PRIVATE_ROW'}]})})});
  const result=await runProbe({mode:'local'},f.deps);assert.equal(result.snapshotIsolationState,state);assert.equal(result.readCommittedSnapshotOn,on);assert.equal(result.selectBatches,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
 for(const patch of [{SnapshotIsolationState:undefined},{SnapshotIsolationState:-1},{SnapshotIsolationState:4},{SnapshotIsolationState:'1'},{SnapshotIsolationState:false},{ReadCommittedSnapshotOn:undefined},{ReadCommittedSnapshotOn:0},{ReadCommittedSnapshotOn:'false'}]){
  const f=fixture();f.deps.createPool=()=>({connect:async()=>{},close:async()=>{},request:()=>({query:async()=>({recordset:[{...row,...patch}]})})});await assert.rejects(runProbe({mode:'local'},f.deps),{code:'IDENTITY_QUERY_INVALID'});
 }
 assert.match(IDENTITY_SQL,/snapshot_isolation_state FROM sys\.databases WHERE database_id=DB_ID\(\)/);assert.match(IDENTITY_SQL,/is_read_committed_snapshot_on FROM sys\.databases WHERE database_id=DB_ID\(\)/);
});
test('actual node stdin packaging runs exactly one main, suppresses rogue raw stdout/stderr, fixed sanitized failure',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/profit-database-identity-readonly.cjs'),'utf8');
 for(const missing of [false,true]){
  const prologue=`const __native=require,__nativeWrite=process.stdout.write.bind(process.stdout);let __lists=0,__queries=0,__closes=0;
   const __env=${JSON.stringify(missing?'TOKEN=PRIVATE_ONLY':Object.entries(fields).map(([k,v])=>k+'='+v).join('\0'))};
   require=n=>{if(n==='node:fs')return {readFileSync:()=>{console.log('PRIVATE_STDOUT');process.stderr.write('PRIVATE_STDERR');return Buffer.from(__env);}};if(n==='node:child_process')return {execFileSync:()=>{__lists++;return JSON.stringify([{name:'nenova-erp',pid:123,pm2_env:{status:'online',env:{TOKEN:'PRIVATE'}}}]);}};if(n==='mssql')return {ConnectionPool:class{async connect(){}request(){return {query:async()=>{__queries++;return {recordset:[${JSON.stringify(row)}]};}};}async close(){__closes++;}}};return __native(n);};require.resolve=()=> 'mssql';require.main=__native.main;
   process.once('beforeExit',()=>__nativeWrite(JSON.stringify({fixtureCounts:true,lists:__lists,queries:__queries,closes:__closes})+'\\n'));
  `;
  const result=cp.spawnSync(process.execPath,['-'],{input:prologue+'\n'+source+"\nmodule.exports.main({mode:'production'});",encoding:'utf8',timeout:5000});assert.equal(result.status,missing?1:0);assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE/);
  const lines=result.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(lines.length,3);assert.equal(lines[0].code,'JOURNAL_UNAVAILABLE');assert.equal(lines[1].code,missing?'CONFIG_UNAVAILABLE':'IDENTITY_OBSERVED');assert.equal(lines[2].queries,missing?0:1);assert.equal(lines[2].closes,missing?0:1);assert.equal(lines[2].lists,missing?1:2);
 }
});
test('registered performance workflow only packages probe; deployment and push conditions unmodified',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/deploy.yml'),'utf8');assert.match(workflow,/group:.*nenova-cafe24-production/);assert.match(workflow,/if: github.event_name == 'workflow_dispatch' && inputs.diagnose_performance_only == true/);assert.match(workflow,/cat scripts\/profit-database-identity-readonly.cjs/);assert.match(workflow,/module.exports.main\(\{mode:'production'\}\)/);
 // Approved76b71a575 Git/LF baseline: diagnostic packaging must not alter either protected region.
 const normalized=workflow.replace(/\r\n/g,'\n'),hash=text=>require('node:crypto').createHash('sha256').update(text).digest('hex');
 assert.equal(hash(normalized.slice(normalized.indexOf('  deploy:'))),'5da709bd006a696f49e828cbb936e0515ab0ed0049243d57c4d7e909cf7293fa');
 assert.equal(hash(normalized.slice(0,normalized.indexOf('jobs:'))),'61a1a2c0ca460ce69033abefe2b26fd556490bb5c7ca6392621df271b2c779eb');
 assert.match(IDENTITY_SQL,/SERVERPROPERTY\('ServerName'\)/);assert.match(IDENTITY_SQL,/DB_NAME\(\)/);assert.doesNotMatch(IDENTITY_SQL,/\b(?:INSERT|UPDATE|DELETE|EXEC|MERGE|ALTER|CREATE|DROP)\b/i);
 assert.doesNotMatch(workflow.slice(workflow.indexOf('  diagnose-performance:'),workflow.indexOf('  diagnose-paste:')),/pm2 (?:restart|reload|save)|npm ci|npm run build/);
 assert.match(workflow,/npm install --prefix "\$RUNNER_TEMP\/identity-fixture" --ignore-scripts --no-save --package-lock=false "@next\/env@\$version"/);
 assert.match(workflow,/assert.equal\(require\(process.env.RUNNER_TEMP\+'\/identity-fixture\/node_modules\/@next\/env\/package.json'\).version,require\('\.\/package-lock.json'\).packages\['node_modules\/@next\/env'\].version\)/);
 assert.match(workflow,/IDENTITY_FIXTURE_NEXT_ENV_MODULE: \$\{\{ runner.temp \}\}\/identity-fixture\/node_modules\/@next\/env\/dist\/index.js/);
});
function nextFixture(){
 const ROOT='/var/www/nenova-erp',now=Date.parse('2026-11-07T00:00:00.000Z'),startedAt=now-10000;
 const files={'.env.production.local':'DB_NAME=PRIVATE_HIGHEST\nDB_USER=PRIVATE_FILE_USER\n','.env.local':'DB_NAME=PRIVATE_LOCAL\n','.env.production':'DB_SERVER=${BOOT_HOST}\nDB_PASSWORD=PRIVATE_PASSWORD\n','.env':'DB_NAME=PRIVATE_BASE\n'};
 const env={SSH_PRIVATE:'PRIVATE_RUNNER',NODE_ENV:'test'},stamp={mtimeMs:startedAt-1000,ctimeMs:startedAt-1000,size:0,ino:1,dev:1};let cwd=ROOT;
 const missing=()=>Object.assign(Error('PRIVATE'),{code:'ENOENT'}),filename=file=>path.basename(file);
 const stat=file=>{const name=filename(file);if(!(name in files))throw missing();return {...stamp,size:Buffer.byteLength(files[name]),isFile:()=>true,isSymbolicLink:()=>false};};
 const io={lstatSync:stat,statSync:stat,readFileSync:(file,encoding)=>{const name=filename(file);if(!(name in files))throw missing();return encoding==='utf8'?files[name]:Buffer.from(files[name]);},realpathSync:file=>file===ROOT?ROOT:file.replaceAll('\\','/'),readlinkSync:()=>cwd};
 const loadNext=()=>{
  const entry=process.env.IDENTITY_FIXTURE_NEXT_ENV_MODULE||require.resolve('@next/env');
  const source=fs.readFileSync(entry,'utf8'),module={exports:{}};
  require('node:vm').runInNewContext(source,{module,exports:module.exports,__dirname:path.dirname(entry),__filename:entry,require:n=>n==='fs'||n==='node:fs'?io:require(n),process:{env,cwd:()=>ROOT,versions:process.versions,version:process.version},console:{log(){},warn(){},error(){},info(){}},Buffer});return module.exports;
 };
 const initial=()=>Buffer.from('NODE_ENV=production\0BOOT_HOST=PRIVATE_SERVER\0DB_USER=PRIVATE_PROC_USER\0');
 return {ROOT,now,startedAt,files,env,stamp,io,loadNext,initial,setCwd:value=>{cwd=value;}};
}
test('verified fallback uses actual installed Next production precedence/expansion and restores diagnostic env; file drift invalidates proof',()=>{
 const f=nextFixture(),initial=f.initial(),prior={...f.env};
 const proof=reconstructNextEnvironment({pid:123,startedAt:f.startedAt,initialEnviron:initial},{io:f.io,env:f.env,clock:()=>f.now,loadNext:f.loadNext});
 assert.equal(proof.configSource,'verified_next_production_env');assert.equal(proof.fields.DB_NAME,'PRIVATE_HIGHEST');assert.equal(proof.fields.DB_SERVER,'PRIVATE_SERVER');assert.equal(proof.fields.DB_USER,'PRIVATE_PROC_USER');assert.deepEqual(f.env,prior);assert.ok(initial.every(v=>v===0));assert.doesNotThrow(()=>proof.verify());
 f.files['.env']='DB_NAME=PRIVATE_CHANGED\n';assert.throws(()=>proof.verify(),{code:'CONFIG_UNAVAILABLE'});
});
test('unverified cwd/start/NODE_ENV/newer files/loaded order/missing config refuses reconstruction without guessing',()=>{
 for(const mode of ['cwd','start','futureStart','newerFile','development','missingNodeEnv','processed','wrongOrder','missingDb']){
  const f=nextFixture();let startedAt=f.startedAt,initial=f.initial(),loadNext=f.loadNext;
  if(mode==='cwd')f.setCwd('/PRIVATE_OTHER');if(mode==='start')startedAt=undefined;if(mode==='futureStart')startedAt=f.now+1;if(mode==='newerFile')f.stamp.mtimeMs=f.startedAt+1;
  if(mode==='development')initial=Buffer.from('NODE_ENV=development');if(mode==='missingNodeEnv')initial=Buffer.from('BOOT_HOST=PRIVATE');if(mode==='processed')initial=Buffer.from('NODE_ENV=production\0__NEXT_PROCESSED_ENV=1');
  if(mode==='wrongOrder')loadNext=()=>({loadEnvConfig:()=>({loadedEnvFiles:[]})});if(mode==='missingDb')for(const key of Object.keys(f.files))delete f.files[key];
  const prior={...f.env};assert.throws(()=>reconstructNextEnvironment({pid:123,startedAt,initialEnviron:initial},{io:f.io,env:f.env,clock:()=>f.now,loadNext}),{code:'CONFIG_UNAVAILABLE'});assert.deepEqual(f.env,prior);assert.ok(initial.every(v=>v===0));
 }
});
test('proc DB values retain priority, verified fallback proof rechecked after SELECT and PID/start drift refuses result',async()=>{
 const strict=fixture();strict.deps.reconstructNext=()=>assert.fail('proc takes precedence');await runProbe({mode:'production'},strict.deps);
 for(const failure of [false,'files','start']){
  const f=fixture();f.processes[0].pm2_env.pm_uptime=1000;f.deps.readEnviron=async()=>Buffer.from('NODE_ENV=production');let verified=0;
  f.deps.reconstructNext=()=>({fields,startedAt:1000,configSource:'verified_next_production_env',verify:()=>{verified++;if(failure==='files')throw Object.assign(Error(),{code:'CONFIG_UNAVAILABLE'});}});
  if(failure==='start'){let lists=0;f.deps.list=async()=>[{...f.processes[0],pm2_env:{...f.processes[0].pm2_env,pm_uptime:++lists===1?1000:1001}}];}
  if(failure)await assert.rejects(runProbe({mode:'production'},f.deps),{code:failure==='files'?'CONFIG_UNAVAILABLE':'IDENTITY_TARGET_CHANGED'});
  else {const result=await runProbe({mode:'production'},f.deps);assert.equal(result.configSource,'verified_next_production_env');assert.equal(verified,1);}
  assert.equal(f.stats().queries,1);assert.equal(f.stats().closed,1);
 }
});
test('only absent NODE_ENV with canonical Next start metadata and known proc title proves default production',()=>{
 for(const args of ['start',['start'],['start','-p','3000'],['start','--port','65535']]){
  const f=nextFixture(),read=f.io.readFileSync,pm2Env={pm_exec_path:f.ROOT+'/node_modules/next/dist/bin/next',args},prior={...f.env};let title='next-server (v16.2.1)\0\0';
  f.io.readFileSync=(file,encoding)=>file==='/proc/123/cmdline'?Buffer.from(title):read(file,encoding);
  const initial=Buffer.from('BOOT_HOST=PRIVATE_SERVER\0DB_USER=PRIVATE_PROC_USER\0');
  const proof=reconstructNextEnvironment({pid:123,startedAt:f.startedAt,initialEnviron:initial,pm2Env},{io:f.io,env:f.env,clock:()=>f.now,loadNext:f.loadNext});
  assert.equal(proof.configSource,'verified_canonical_next_start_env');assert.equal(proof.configProof,'CANONICAL_NEXT_START_DEFAULT_PRODUCTION');assert.equal(proof.fields.DB_NAME,'PRIVATE_HIGHEST');assert.deepEqual(f.env,prior);assert.doesNotThrow(()=>proof.verifyTarget(pm2Env));assert.ok(initial.every(v=>v===0));
  assert.throws(()=>proof.verifyTarget({...pm2Env,args:['start','-p','9999']}),{code:'CONFIG_UNAVAILABLE'});title='PRIVATE_TITLE';assert.throws(()=>proof.verify(),{code:'CONFIG_UNAVAILABLE'});
 }
 for(const mode of ['empty','false','development','test','unknown','entry','dev','extra','zeroPort','bigPort','numericPort','rawTitle','nodeTitle']){
  const f=nextFixture(),read=f.io.readFileSync,pm2Env={pm_exec_path:f.ROOT+'/node_modules/next/dist/bin/next',args:['start']};let initial=Buffer.from('BOOT_HOST=PRIVATE_SERVER'),title='next-server (v16.2.1)\0';
  if(['empty','false','development','test','unknown'].includes(mode))initial=Buffer.from('NODE_ENV='+({empty:'',false:'false',unknown:'PRIVATE_VALUE'}[mode]??mode));
  if(mode==='entry')pm2Env.pm_exec_path='/PRIVATE/next';if(mode==='dev')pm2Env.args=['dev'];if(mode==='extra')pm2Env.args=['start','.'];if(mode==='zeroPort')pm2Env.args=['start','-p','0'];if(mode==='bigPort')pm2Env.args=['start','-p','65536'];if(mode==='numericPort')pm2Env.args=['start','-p',3000];if(mode==='rawTitle')title='PRIVATE';if(mode==='nodeTitle')title='node\0PRIVATE';
  f.io.readFileSync=(file,encoding)=>file==='/proc/123/cmdline'?Buffer.from(title):read(file,encoding);
  try{reconstructNextEnvironment({pid:123,startedAt:f.startedAt,initialEnviron:initial,pm2Env},{io:f.io,env:f.env,clock:()=>f.now,loadNext:f.loadNext});assert.fail('unproven must fail');}catch(error){const safe=safeFailure(error);assert.equal(safe.code,'CONFIG_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|next-server|3000|\/proc/);}
 }
});
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const event=(attempt,phase,at,extra={})=>JSON.stringify({attempt:uuid(attempt),phase,at,scope:{orderYear:'2026',orderWeek:'44-01',ownerToken:'PRIVATE_OWNER'},...extra});
test('journal pairs intervals across windows, caps output, hides IDs/owners/raw codes and marks partial/tail evidence',()=>{
 const text=[event(1,'started','2026-11-06T10:40:00.000Z'),event(1,'finished','2026-11-06T10:42:00.000Z',{result:{status:'recovered',code:'PENDING_STOCK_RECOVERED'}}),event(2,'started','2026-11-06T10:52:00.000Z'),event(2,'finished','2026-11-06T10:53:00.000Z',{result:{status:'PRIVATE_STATUS',code:'PRIVATE_CODE'}}),event(3,'finished','2026-11-06T10:40:30.000Z',{result:{status:'unknown',code:'CHILD_EXIT_WITHOUT_RESULT'}}),'PRIVATE_BROKEN_JSON'].join('\n');
 const result=summarizeRecoveryJournal(text,{tailTruncated:true});assert.equal(result.overlapCount,3);assert.equal(result.partialPairs,1);assert.equal(result.invalidLines,1);assert.deepEqual(result.windowCounts,{first:2,second:1});assert.equal(result.overlaps[0].status,'recovered');assert.equal(result.overlaps[1].code,'OTHER');assert.equal(result.windows[0].tailMayOmitWindow,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|00000000|owner|attempt/i);
 const late=summarizeRecoveryJournal(event(4,'finished','2026-11-06T10:54:00.000Z'),{tailTruncated:true});assert.equal(late.windows[0].tailMayOmitWindow,true);assert.equal(late.windows[1].tailMayOmitWindow,true);
 const large=summarizeRecoveryJournal(Array.from({length:25},(_,i)=>event(i,'started','2026-11-06T10:40:18.000Z')+'\n'+event(i,'finished','2026-11-06T10:40:19.000Z',{result:{status:'recovered',code:'PENDING_STOCK_RECOVERED'}})).join('\n'));assert.equal(large.overlapCount,25);assert.equal(large.overlaps.length,20);assert.equal(large.truncated,true);
});
test('journal fixed file is read-only bounded4MiB; unavailable/identity failure cannot hide journal observation',()=>{
 let closed=0;const text='PRIVATE_PARTIAL\n'+event(1,'started','2026-11-06T10:40:18.000Z')+'\n'+event(1,'finished','2026-11-06T10:40:19.000Z',{result:{status:'recovered',code:'PENDING_STOCK_RECOVERED'}})+'\n';
 const result=readRecoveryJournal({lstatSync:file=>{assert.equal(file,'/var/lib/nenova/stock-recovery/attempts.jsonl');return {size:5*1024*1024,isFile:()=>true,isSymbolicLink:()=>false};},openSync:(file,mode)=>{assert.equal(mode,'r');return 1;},readSync:(fd,buf,offset,length,position)=>{assert.equal(length,4*1024*1024);assert.equal(position,1024*1024);buf.fill(' ');buf.write(text);},closeSync:()=>{closed++;}});
 assert.equal(result.scannedBytes,4*1024*1024);assert.equal(result.overlapCount,1);assert.equal(closed,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|00000000/);assert.equal(readRecoveryJournal({}).code,'JOURNAL_UNAVAILABLE');
 const source=fs.readFileSync(path.join(__dirname,'../scripts/profit-database-identity-readonly.cjs'),'utf8');assert.ok(source.indexOf('output(JSON.stringify(readRecoveryJournal()))')<source.indexOf('await runProbe({mode,expectedIdentityHash}'));
});
