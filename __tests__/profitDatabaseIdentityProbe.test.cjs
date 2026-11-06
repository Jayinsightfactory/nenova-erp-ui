const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const {runProbe,selectProcess,parseDatabaseFields,connectionConfig,safeFailure,IDENTITY_SQL}=require('../scripts/profit-database-identity-readonly.cjs');
const HASH='a'.repeat(64),fields={DB_SERVER:'PRIVATE_SERVER',DB_NAME:'PRIVATE_DB',DB_USER:'PRIVATE_USER',DB_PASSWORD:'PRIVATE_PASSWORD',DB_PORT:'1433'};
const row={IdentityHash:HASH,TaxableRateTablePresent:false,InvoiceTablesPresent:4,InvoiceUniqueKeyScopes:4};
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
});
test('owned request rejects every nonconstant query, batch and execute after its single SELECT',async()=>{
 const f=fixture();let request;f.deps.createPool=()=>({connect:async()=>{},close:async()=>{},request:()=>request={query:async()=>({recordset:[row]})}});
 await runProbe({mode:'production'},f.deps);
 for(const call of [()=>request.query('SELECT PRIVATE_OTHER'),()=>request.query('UPDATE Product SET X=1'),()=>request.query(IDENTITY_SQL),()=>request.batch('PRIVATE'),()=>request.execute('PRIVATE')])assert.throws(call,{code:'IDENTITY_QUERY_INVALID'});
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
  const lines=result.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(lines.length,2);assert.equal(lines[0].code,missing?'CONFIG_UNAVAILABLE':'IDENTITY_OBSERVED');assert.equal(lines[1].queries,missing?0:1);assert.equal(lines[1].closes,missing?0:1);assert.equal(lines[1].lists,missing?1:2);
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
});
