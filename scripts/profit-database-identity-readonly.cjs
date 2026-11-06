// Manual metadata diagnosis only. No application import, persistence, raw environment/config/error output.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const {createHash}=require('node:crypto');
const APP='nenova-erp',ROOT='/var/www/nenova-erp',FIELDS=['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'];
const NEXT_ENV_FILES=['.env.production.local','.env.local','.env.production','.env'];
const CODES=new Set(['IDENTITY_MODE_INVALID','IDENTITY_EXPECTED_INVALID','IDENTITY_TARGET_INVALID','IDENTITY_TARGET_CHANGED','IDENTITY_ENV_INVALID','CONFIG_UNAVAILABLE','IDENTITY_QUERY_INVALID','IDENTITY_MISMATCH','IDENTITY_PROBE_FAILED']);
const fail=code=>{throw Object.assign(Error(),{code});};
const PROOF_REASONS=new Set(['NODE_ENV_UNPROVEN','CANONICAL_NEXT_START_UNPROVEN','CANONICAL_NEXT_ENTRY_UNPROVEN','CANONICAL_NEXT_ARGS_UNPROVEN','CANONICAL_NEXT_TITLE_UNPROVEN','CWD_UNPROVEN','START_TIME_UNPROVEN','ENV_FILES_NEWER_OR_CHANGED','NEXT_ENV_LOAD_UNPROVEN','INITIAL_ENV_UNPROVEN','CONFIG_VALUES_UNAVAILABLE','NEXT_ENV_PROOF_UNAVAILABLE']);
const unproven=reason=>{throw Object.assign(Error(),{code:'CONFIG_UNAVAILABLE',reason});};
const IDENTITY_SQL=`SELECT
 LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(N'SERVER=',CONVERT(nvarchar(256),SERVERPROPERTY('ServerName')),N'|DB=',DB_NAME())),2)) IdentityHash,
 CAST(CASE WHEN OBJECT_ID(N'dbo.WebTaxableExchangeRate',N'U') IS NULL THEN 0 ELSE 1 END AS bit) TaxableRateTablePresent,
 (SELECT snapshot_isolation_state FROM sys.databases WHERE database_id=DB_ID()) SnapshotIsolationState,
 (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE database_id=DB_ID()) ReadCommittedSnapshotOn,
 (SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo') AND name IN (N'WebInvoiceCostRevision',N'WebInvoiceCostLine',N'WebInvoiceDocument',N'WebInvoiceOperation')) InvoiceTablesPresent,
 (SELECT COUNT(*) FROM (VALUES (N'WebInvoiceCostRevision',N'CostRevisionId',NULL),(N'WebInvoiceCostLine',N'CostRevisionId',N'LineId'),(N'WebInvoiceDocument',N'DocumentId',NULL),(N'WebInvoiceOperation',N'OperationId',NULL)) required(TableName,FirstKey,SecondKey)
  WHERE EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id=OBJECT_ID(N'dbo.'+required.TableName,N'U') AND i.is_unique=1 AND i.is_disabled=0 AND i.is_hypothetical=0 AND i.has_filter=0
   AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0)=CASE WHEN required.SecondKey IS NULL THEN 1 ELSE 2 END
   AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=1 AND c.name=required.FirstKey)
   AND (required.SecondKey IS NULL OR EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=2 AND c.name=required.SecondKey)))) InvoiceUniqueKeyScopes`;
function selectProcess(rows){
 if(!Array.isArray(rows))fail('IDENTITY_TARGET_INVALID');const targets=rows.filter(p=>p?.name===APP);
 if(targets.length!==1||targets[0].pm2_env?.status!=='online'||!Number.isInteger(targets[0].pid)||targets[0].pid<=0||targets[0].pid>2147483647)fail('IDENTITY_TARGET_INVALID');
 return targets[0].pid;
}
function parseDatabaseFields(buffer){
 const result={};
 try{
  for(let start=0;start<buffer.length;){const found=buffer.indexOf(0,start),end=found<0?buffer.length:found;
   for(const field of FIELDS){const prefix=Buffer.from(field+'=');if(end-start>=prefix.length&&buffer.subarray(start,start+prefix.length).equals(prefix)){if(Object.hasOwn(result,field))fail('IDENTITY_ENV_INVALID');result[field]=buffer.subarray(start+prefix.length,end).toString('utf8');}}
   start=end+1;
  }
  return result;
 }finally{buffer.fill(0);}
}
function parseInitialEnvironment(buffer){
 const env=Object.create(null);
 for(const entry of buffer.toString('utf8').split('\0')){if(!entry)continue;const i=entry.indexOf('='),name=entry.slice(0,i);if(i<=0||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||Object.hasOwn(env,name))fail('CONFIG_UNAVAILABLE');env[name]=entry.slice(i+1);}
 return env;
}
function envFileSnapshot(io,startedAt){
 return NEXT_ENV_FILES.map(name=>{
  const file=path.join(ROOT,name);let link;
  try{link=io.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {name,exists:false};unproven('ENV_FILES_NEWER_OR_CHANGED');}
  const stat=io.statSync(file);
  if(!stat.isFile()||stat.size>1048576||![stat.mtimeMs,stat.ctimeMs,stat.size,stat.ino,stat.dev,link.mtimeMs].every(Number.isFinite)||stat.mtimeMs>startedAt||link.mtimeMs>startedAt)unproven('ENV_FILES_NEWER_OR_CHANGED');
  const bytes=io.readFileSync(file);if(!Buffer.isBuffer(bytes))fail('CONFIG_UNAVAILABLE');
  let hash;try{hash=createHash('sha256').update(bytes).digest('hex');}finally{bytes.fill(0);}
  return {name,exists:true,realPath:io.realpathSync(file),mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,size:stat.size,ino:stat.ino,dev:stat.dev,linkMtimeMs:link.mtimeMs,linkCtimeMs:link.ctimeMs,hash};
 });
}
function canonicalNextStart(io,pid,metadata){
 let reason='CANONICAL_NEXT_ENTRY_UNPROVEN';try{
  const entry=ROOT+'/node_modules/next/dist/bin/next';
  if(![entry,ROOT+'/node_modules/.bin/next'].includes(metadata?.pm_exec_path)||io.realpathSync(metadata.pm_exec_path)!==io.realpathSync(entry))unproven(reason);
  reason='CANONICAL_NEXT_ARGS_UNPROVEN';
  const args=metadata.args==='start'?['start']:metadata.args;
  if(!Array.isArray(args)||args.some(v=>typeof v!=='string')||!(args.length===1&&args[0]==='start'||args.length===3&&args[0]==='start'&&['-p','--port'].includes(args[1])&&/^[1-9]\d{0,4}$/.test(args[2])&&Number(args[2])<=65535))unproven(reason);
  reason='CANONICAL_NEXT_TITLE_UNPROVEN';
  const bytes=io.readFileSync('/proc/'+pid+'/cmdline');
  try{if(!Buffer.isBuffer(bytes)||bytes.length>4096||!/^next-server \(v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\)\0*$/.test(bytes.toString('utf8')))unproven(reason);}finally{if(Buffer.isBuffer(bytes))bytes.fill(0);}
 }catch{unproven(reason);}
}
function reconstructNextEnvironment({pid,startedAt,initialEnviron,pm2Env},{io=fs,env=process.env,clock=Date.now,loadNext}={}){
 try{
  if(!Number.isInteger(startedAt)||startedAt<=0||startedAt>clock())unproven('START_TIME_UNPROVEN');
  if(io.realpathSync(ROOT)!==ROOT||io.readlinkSync('/proc/'+pid+'/cwd')!==ROOT)unproven('CWD_UNPROVEN');
  const initial=parseInitialEnvironment(initialEnviron),defaultProduction=!Object.hasOwn(initial,'NODE_ENV');
  if(defaultProduction){canonicalNextStart(io,pid,pm2Env);initial.NODE_ENV='production';}else if(initial.NODE_ENV!=='production')unproven('NODE_ENV_UNPROVEN');
  if(initial.__NEXT_PROCESSED_ENV!==undefined)unproven('INITIAL_ENV_UNPROVEN');
  const before=envFileSnapshot(io,startedAt),prior={...env};let fields,loadError=false;
  const replace=value=>{for(const key of Object.keys(env))if(!Object.hasOwn(value,key))delete env[key];for(const [key,v]of Object.entries(value))env[key]=v;};
  try{
   replace(initial);const next=loadNext();
   const loaded=next.loadEnvConfig(ROOT,false,{info(){},error(){loadError=true;}},true);
   if(loadError||!Array.isArray(loaded.loadedEnvFiles)||JSON.stringify(loaded.loadedEnvFiles.map(f=>f.path))!==JSON.stringify(before.filter(f=>f.exists).map(f=>f.name)))unproven('NEXT_ENV_LOAD_UNPROVEN');
   fields=Object.fromEntries(FIELDS.map(key=>[key,env[key]]));connectionConfig(fields);
  }finally{replace(prior);}
  const verify=()=>{if(io.readlinkSync('/proc/'+pid+'/cwd')!==ROOT)unproven('CWD_UNPROVEN');if(defaultProduction)canonicalNextStart(io,pid,pm2Env);if(JSON.stringify(envFileSnapshot(io,startedAt))!==JSON.stringify(before))unproven('ENV_FILES_NEWER_OR_CHANGED');};
  const verifyTarget=metadata=>{if(defaultProduction){canonicalNextStart(io,pid,metadata);if(JSON.stringify(metadata.args)!==JSON.stringify(pm2Env.args)||metadata.pm_exec_path!==pm2Env.pm_exec_path)unproven('CANONICAL_NEXT_START_UNPROVEN');}};
  verify();return {fields,verify,verifyTarget,startedAt,configSource:defaultProduction?'verified_canonical_next_start_env':'verified_next_production_env',configProof:defaultProduction?'CANONICAL_NEXT_START_DEFAULT_PRODUCTION':'EXPLICIT_PRODUCTION'};
 }catch(error){if(error.code==='CONFIG_UNAVAILABLE'&&PROOF_REASONS.has(error.reason))throw error;unproven('NEXT_ENV_PROOF_UNAVAILABLE');}finally{initialEnviron.fill(0);}
}
const WINDOWS=[{id:'first',start:'2026-11-06T10:40:17.000Z',end:'2026-11-06T10:41:38.000Z'},{id:'second',start:'2026-11-06T10:51:58.000Z',end:'2026-11-06T10:53:20.000Z'}];
const RECOVERY_CODES=new Set(['PENDING_STOCK_ACTIVE_RUN','PENDING_STOCK_ARGUMENTS_INVALID','PENDING_STOCK_CALC_FAILED','PENDING_STOCK_CALC_HASH_REQUIRED','PENDING_STOCK_CAPABILITY_REQUIRED','PENDING_STOCK_COOLDOWN','PENDING_STOCK_FINAL_IDLE_REQUIRED','PENDING_STOCK_GATE_CHANGED','PENDING_STOCK_GATE_INVALID','PENDING_STOCK_GATE_LOCKED','PENDING_STOCK_GATE_READ_FAILED','PENDING_STOCK_IDLE','PENDING_STOCK_NATIVE_FAILED','PENDING_STOCK_ORIGINAL_TRANSACTION_REQUIRED','PENDING_STOCK_RECOVERED','PENDING_STOCK_RECOVERY_FAILED','PENDING_STOCK_RESULT_INVALID','PENDING_STOCK_TOO_YOUNG','PENDING_STOCK_TRANSACTION_MARKER_REQUIRED','PENDING_STOCK_TRANSACTION_REQUIRED','CHILD_DEADLINE_DISCONNECT','CHILD_PROCESS_ERROR','CHILD_EXIT_WITHOUT_RESULT','CHILD_EXIT_AFTER_COMMIT','CHILD_START_FAILED','RECOVERY_JOURNAL_UNAVAILABLE','RECOVERY_FAILED']);
function summarizeRecoveryJournal(text,{tailTruncated=false}={}){
 const attempts=new Map();let earliestAt=null,latestAt=null,invalidLines=0;
 const at=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
 for(const line of String(text).split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   if(line.length>16384)throw Error();const v=JSON.parse(line);
   if(!at(v.at)||typeof v.attempt!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.attempt)||!['started','finished','timeout','failed'].includes(v.phase))throw Error();
   earliestAt=earliestAt===null||v.at<earliestAt?v.at:earliestAt;latestAt=latestAt===null||v.at>latestAt?v.at:latestAt;
   const item=attempts.get(v.attempt)||{start:null,finish:null,last:v.at,orderYear:null,orderWeek:null,status:'unknown',code:'OTHER'};attempts.set(v.attempt,item);item.last=v.at>item.last?v.at:item.last;
   if(v.scope&&typeof v.scope.orderYear==='string'&&/^20\d{2}$/.test(v.scope.orderYear)&&typeof v.scope.orderWeek==='string'&&/^(0[1-9]|[1-4]\d|5[0-3])-\d{2}$/.test(v.scope.orderWeek)){item.orderYear=v.scope.orderYear;item.orderWeek=v.scope.orderWeek;}
   if(v.phase==='started')item.start=item.start===null||v.at<item.start?v.at:item.start;
   if(v.phase==='finished'){item.finish=v.at;item.status=['skipped','recovered','failed','unknown'].includes(v.result?.status)?v.result.status:'unknown';item.code=RECOVERY_CODES.has(v.result?.code)?v.result.code:'OTHER';}
   else if(v.phase!=='started'){item.status=v.phase==='failed'?'failed':'unknown';item.code=RECOVERY_CODES.has(v.code)?v.code:'OTHER';}
  }catch{invalidLines++;}
 }
 const overlaps=[],windowCounts={first:0,second:0};let partialPairs=0,overlapCount=0;
 for(const item of attempts.values()){
  const pairComplete=item.start!==null&&item.finish!==null&&item.start<=item.finish;if(!pairComplete)partialPairs++;
  const from=item.start||item.last,to=item.finish||item.last,windows=WINDOWS.filter(w=>from<=w.end&&to>=w.start).map(w=>w.id);
  if(!windows.length)continue;overlapCount++;for(const id of windows)windowCounts[id]++;
  if(overlaps.length<20)overlaps.push({startedAt:item.start,finishedAt:item.finish,lastObservedAt:item.last,orderYear:item.orderYear,orderWeek:item.orderWeek,status:item.status,code:item.code,pairComplete,windows});
 }
 return {recoveryJournal:true,status:'PASS',code:'JOURNAL_OBSERVED',tailTruncated,earliestAt,latestAt,partialPairs,invalidLines,overlapCount,windowCounts,truncated:overlapCount>overlaps.length,windows:WINDOWS.map(w=>({...w,tailMayOmitWindow:tailTruncated&&(earliestAt===null||earliestAt>w.start)})),overlaps};
}
function readRecoveryJournal(io=fs){
 try{const file='/var/lib/nenova/stock-recovery/attempts.jsonl',stat=io.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error();const bytes=Math.min(stat.size,4*1024*1024),buffer=Buffer.alloc(bytes),fd=io.openSync(file,'r');
  try{io.readSync(fd,buffer,0,bytes,stat.size-bytes);}finally{io.closeSync(fd);}
  let text=buffer.toString('utf8');buffer.fill(0);if(stat.size>bytes){const newline=text.indexOf('\n');text=newline<0?'':text.slice(newline+1);}
  return {...summarizeRecoveryJournal(text,{tailTruncated:stat.size>bytes}),scannedBytes:bytes};
 }catch{return {recoveryJournal:true,status:'UNAVAILABLE',code:'JOURNAL_UNAVAILABLE'};}
}
function connectionConfig(env){
 for(const key of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD']){if(env[key]===undefined||env[key]==='')fail('CONFIG_UNAVAILABLE');if(typeof env[key]!=='string')fail('IDENTITY_ENV_INVALID');}
 const raw=env.DB_PORT,port=raw===undefined||raw===''?1433:typeof raw==='string'&&/^\d{1,5}$/.test(raw)?Number(raw):NaN;
 if(!Number.isInteger(port)||port<=0||port>65535)fail('IDENTITY_ENV_INVALID');
 return {server:env.DB_SERVER,port,database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,connectionTimeout:15000,requestTimeout:10000,
  options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true,connectTimeout:15000,requestTimeout:10000},pool:{max:1,min:0,idleTimeoutMillis:1000}};
}
function safeFailure(error){const result={status:'FAILED',code:CODES.has(error?.code)?error.code:'IDENTITY_PROBE_FAILED'};if(result.code==='CONFIG_UNAVAILABLE'&&PROOF_REASONS.has(error?.reason))result.reason=error.reason;return result;}
async function runProbe({mode,expectedIdentityHash},deps){
 if(!['local','production'].includes(mode))fail('IDENTITY_MODE_INVALID');
 if(expectedIdentityHash!==undefined&&expectedIdentityHash!==''&&!/^[a-f0-9]{64}$/.test(expectedIdentityHash))fail('IDENTITY_EXPECTED_INVALID');
 let pid=null,fields,pool,proof,configSource=mode==='production'?'proc_initial_environ':'local_next_env';
 try{
  if(mode==='production'){
   const rows=await deps.list();pid=selectProcess(rows);const initialEnviron=await deps.readEnviron(pid);
   try{
    fields=parseDatabaseFields(Buffer.from(initialEnviron));
    if(['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'].some(key=>fields[key]===undefined||fields[key]==='')){
     if(typeof deps.reconstructNext!=='function')fail('CONFIG_UNAVAILABLE');
     proof=await deps.reconstructNext({pid,startedAt:rows.find(p=>p.name===APP).pm2_env.pm_uptime,pm2Env:rows.find(p=>p.name===APP).pm2_env,initialEnviron});fields=proof.fields;configSource=proof.configSource;
    }
   }finally{initialEnviron.fill(0);}
  }
  else fields=await deps.localFields();
  const config=connectionConfig(fields);fields=null;pool=deps.createPool(config);pool.on?.('error',()=>{});await pool.connect();
  const request=pool.request(),query=request.query.bind(request);let reads=0;
  request.query=statement=>{if(statement!==IDENTITY_SQL||++reads!==1||!/^[\s]*SELECT\b/i.test(statement)||/\b(INSERT|UPDATE|DELETE|EXEC|EXECUTE|MERGE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(statement))fail('IDENTITY_QUERY_INVALID');return query(statement);};
  request.batch=request.execute=()=>fail('IDENTITY_QUERY_INVALID');
  const result=await request.query(IDENTITY_SQL),row=result.recordset?.length===1?result.recordset[0]:null;
  if(!row||typeof row.IdentityHash!=='string'||!/^[a-f0-9]{64}$/.test(row.IdentityHash)||typeof row.TaxableRateTablePresent!=='boolean'||!Number.isInteger(row.InvoiceTablesPresent)||row.InvoiceTablesPresent<0||row.InvoiceTablesPresent>4||!Number.isInteger(row.InvoiceUniqueKeyScopes)||row.InvoiceUniqueKeyScopes<0||row.InvoiceUniqueKeyScopes>4||!Number.isInteger(row.SnapshotIsolationState)||row.SnapshotIsolationState<0||row.SnapshotIsolationState>3||typeof row.ReadCommittedSnapshotOn!=='boolean')fail('IDENTITY_QUERY_INVALID');
  if(mode==='production'){
   const current=await deps.list();if(selectProcess(current)!==pid||(proof&&current.find(p=>p.name===APP).pm2_env.pm_uptime!==proof.startedAt))fail('IDENTITY_TARGET_CHANGED');
   proof?.verify();
   proof?.verifyTarget?.(current.find(p=>p.name===APP).pm2_env);
  }
  const matchesExpected=expectedIdentityHash?row.IdentityHash===expectedIdentityHash:null;
  return {status:matchesExpected===false?'FAILED':'PASS',code:matchesExpected===false?'IDENTITY_MISMATCH':'IDENTITY_OBSERVED',mode,pid,configSource,...(proof?.configProof?{configProof:proof.configProof}:{}),identityHash:row.IdentityHash,matchesExpected,taxableRateTablePresent:row.TaxableRateTablePresent,invoiceTablesPresent:row.InvoiceTablesPresent,invoiceUniqueKeyScopes:row.InvoiceUniqueKeyScopes,snapshotIsolationState:row.SnapshotIsolationState,readCommittedSnapshotOn:row.ReadCommittedSnapshotOn,selectBatches:reads};
 }finally{fields=null;if(pool)await pool.close();}
}
function repositoryActivityRoutes(apiRoot){
 const routes=[];const walk=(folder,parts=[])=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(!/^[A-Za-z0-9_.\[\]-]+$/.test(entry.name)||entry.isSymbolicLink())continue;if(entry.isDirectory())walk(path.join(folder,entry.name),[...parts,entry.name]);else if(entry.isFile()&&/\.(js|ts)$/.test(entry.name)){const names=[...parts,entry.name.replace(/\.(js|ts)$/,'')];if(names.at(-1)==='index')names.pop();routes.push('/api/'+names.join('/'));}}};walk(apiRoot);return routes.sort();
}
function summarizeActivity(rows,routes){
 const templates=[...new Set(routes)].filter(r=>typeof r==='string'&&/^\/api\/(?:[A-Za-z0-9_.\[\]-]+\/?)+$/.test(r)).sort((a,b)=>Number(a.includes('['))-Number(b.includes('['))||b.length-a.length);
 const matchers=templates.map(route=>({route,regex:new RegExp('^'+route.split('/').map(p=>/^\[\[\.\.\.[A-Za-z0-9_]+\]\]$/.test(p)?'.*':/^\[\.\.\.[A-Za-z0-9_]+\]$/.test(p)?'.+':/^\[[A-Za-z0-9_]+\]$/.test(p)?'[^/]+':p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'/?$')}));
 const groups=new Map();let invalid=0,nonServer=0,matchedRequests=0;
 const anchors=new Set(['/api/sales/profit-report','/api/sales/profit-report-output','/api/sales/profit-stock-adjustment-notes','/api/sales/profit-report-week-check','/api/finance/exchange']);
 const timestamp=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v));
 for(const row of rows){
  if(!row||row.kind!=='api'||row.recordedBy!=='server'){nonServer++;continue;}
  if(!timestamp(row.startedAt)||!timestamp(row.receivedAt)||!Number.isInteger(row.duration)||row.duration<0||row.duration>86400000||!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(row.method)||!Number.isInteger(row.status)||row.status<100||row.status>599||typeof row.path!=='string'||row.path.length>300||!row.path.startsWith('/')||/[?#\x00-\x20]/.test(row.path)){invalid++;continue;}
  const route=matchers.find(m=>m.regex.test(row.path))?.route||'other_api';
  if(!['POST','PUT','PATCH','DELETE'].includes(row.method)&&!(row.method==='GET'&&anchors.has(route)))continue;
  const start=Date.parse(row.startedAt),end=start+row.duration;
  for(const window of WINDOWS){if(start>Date.parse(window.end)||end<Date.parse(window.start))continue;matchedRequests++;
   const bucket=new Date(Math.max(start,Date.parse(window.start))).toISOString().slice(0,16)+':00.000Z';
   const feature=route.startsWith('/api/finance/')?'finance':route.startsWith('/api/sales/')?'sales_profit':/\/arrival|\/warehouse|\/stock/.test(route)?'inventory_cost':/\/customs|\/freight/.test(route)?'customs_freight':/\/order|\/shipment|\/estimate/.test(route)?'order_shipment':'other';
   const value={window:window.id,minuteBucket:bucket,method:row.method,status:row.status,routeTemplate:route,feature,count:0},key=JSON.stringify(value);
   if(!groups.has(key))groups.set(key,value);groups.get(key).count++;
  }
 }
 return {matchedRequests,groups:[...groups.values()].slice(0,100),groupCount:groups.size,truncated:groups.size>100,invalid,nonServer};
}
function readActivityJournal(routes=[],io=fs){
 const root='/var/lib/nenova/user-activity',limit=16*1024*1024,maxFiles=10000;let scannedFiles=0,bytesRead=0,invalid=0,refused=0,missingHours=0,bounded=false;const rows=[];
 try{
  const directory=folder=>{const stat=io.lstatSync(folder);if(!stat.isDirectory()||stat.isSymbolicLink()||io.realpathSync(folder)!==folder)throw Error();};directory(root);directory(root+'/2026-11-06');
  for(const hour of ['19','20']){
   const folder=root+'/2026-11-06/'+hour;try{directory(folder);}catch{missingHours++;continue;}
   const files=io.readdirSync(folder).filter(n=>/^[a-f0-9]{64}\.jsonl$/.test(n)).sort();
   for(const name of files){if(scannedFiles>=maxFiles){bounded=true;break;}scannedFiles++;const file=folder+'/'+name;let fd,buffer;
    try{const stat=io.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>65536){refused++;continue;}if(bytesRead+stat.size>limit){bounded=true;break;}
     fd=io.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0x20000));const opened=io.fstatSync(fd);if(!opened.isFile()||opened.ino!==stat.ino||opened.dev!==stat.dev||opened.size!==stat.size){refused++;continue;}
     buffer=Buffer.alloc(stat.size);const n=io.readSync(fd,buffer,0,buffer.length,0);bytesRead+=n;if(n!==buffer.length){invalid++;continue;}
     const lines=buffer.toString('utf8').trim().split(/\r?\n/);if(lines.length!==1){invalid++;continue;}rows.push(JSON.parse(lines[0]));
    }catch{invalid++;}finally{if(buffer)buffer.fill(0);if(fd!==undefined)io.closeSync(fd);}
   }
  }
  const summary=summarizeActivity(rows,routes);return {section:'activity_window_diagnostic',status:'PASS',code:'ACTIVITY_WINDOWS_OBSERVED',...summary,invalid:invalid+summary.invalid,scannedFiles,bytesRead,refused,missingHours,bounded,coverageComplete:false,receivedHourScope:'KST_2026_11_06_19_20',delayedPersistenceMayBeOutsideScope:true,requestSourceAndSameValueUnknown:true};
 }catch{return {section:'activity_window_diagnostic',status:'UNAVAILABLE',code:'ACTIVITY_WINDOWS_UNAVAILABLE',scannedFiles,bytesRead,coverageComplete:false};}
}
async function main({mode,expectedIdentityHash=process.env.DB_IDENTITY_EXPECTED_HASH,activityRoutes=[],activityOnly=false}={}){
 const rawWrite=process.stdout.write.bind(process.stdout),stdoutWrite=process.stdout.write,stderrWrite=process.stderr.write,prior={...console};
 const output=value=>rawWrite(value+'\n');
 try{
  for(const key of ['log','warn','error','info','debug'])console[key]=()=>{};
  process.stdout.write=process.stderr.write=()=>true;
  if(mode==='production'){const activity=readActivityJournal(activityRoutes);output(JSON.stringify(activity));if(activityOnly===true){if(activity.status!=='PASS')process.exitCode=1;return activity;}output(JSON.stringify(readRecoveryJournal()));}
  let mssql;
  const deps={
   list:async()=>JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15000,maxBuffer:8*1024*1024})),
   readEnviron:async pid=>fs.readFileSync('/proc/'+pid+'/environ'),
   reconstructNext:options=>reconstructNextEnvironment(options,{loadNext:()=>{const entry=require.resolve('@next/env',{paths:[ROOT]});if(require.cache?.[entry])fail('CONFIG_UNAVAILABLE');return require(entry);}}),
   localFields:async()=>{require('@next/env').loadEnvConfig(process.env.PROFIT_ENV_DIR||process.cwd(),false,{info(){},error(){}});return Object.fromEntries(FIELDS.map(k=>[k,process.env[k]]));},
   createPool:config=>{mssql??=mode==='production'?require(require.resolve('mssql',{paths:[ROOT]})):require('mssql');return new mssql.ConnectionPool(config);},
  };
  const result=await runProbe({mode,expectedIdentityHash},deps);output(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;return result;
 }catch(error){const result=safeFailure(error);output(JSON.stringify(result));process.exitCode=1;return result;}
 finally{Object.assign(console,prior);process.stdout.write=stdoutWrite;process.stderr.write=stderrWrite;}
}
module.exports={main,runProbe,selectProcess,parseDatabaseFields,connectionConfig,safeFailure,IDENTITY_SQL,reconstructNextEnvironment,summarizeRecoveryJournal,readRecoveryJournal,envFileSnapshot,repositoryActivityRoutes,summarizeActivity,readActivityJournal};
if(require.main===module){if(process.argv[2]==='package-activity-entry')process.stdout.write('\nmodule.exports.main('+JSON.stringify({mode:'production',activityOnly:true,activityRoutes:repositoryActivityRoutes(path.join(process.cwd(),'pages/api'))})+").catch(()=>{console.log(JSON.stringify({status:'FAILED',code:'IDENTITY_PROBE_FAILED'}));process.exitCode=1;});\n");else main({mode:process.argv[2]}).catch(()=>{console.log(JSON.stringify({status:'FAILED',code:'IDENTITY_PROBE_FAILED'}));process.exitCode=1;});}
