// Manual metadata diagnosis only. No application import, persistence, raw environment/config/error output.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const APP='nenova-erp',ROOT='/var/www/nenova-erp',FIELDS=['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'];
const CODES=new Set(['IDENTITY_MODE_INVALID','IDENTITY_EXPECTED_INVALID','IDENTITY_TARGET_INVALID','IDENTITY_TARGET_CHANGED','IDENTITY_ENV_INVALID','CONFIG_UNAVAILABLE','IDENTITY_QUERY_INVALID','IDENTITY_MISMATCH','IDENTITY_PROBE_FAILED']);
const fail=code=>{throw Object.assign(Error(),{code});};
const IDENTITY_SQL=`SELECT
 LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(N'SERVER=',CONVERT(nvarchar(256),SERVERPROPERTY('ServerName')),N'|DB=',DB_NAME())),2)) IdentityHash,
 CAST(CASE WHEN OBJECT_ID(N'dbo.WebTaxableExchangeRate',N'U') IS NULL THEN 0 ELSE 1 END AS bit) TaxableRateTablePresent,
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
function connectionConfig(env){
 for(const key of ['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD']){if(env[key]===undefined||env[key]==='')fail('CONFIG_UNAVAILABLE');if(typeof env[key]!=='string')fail('IDENTITY_ENV_INVALID');}
 const raw=env.DB_PORT,port=raw===undefined||raw===''?1433:typeof raw==='string'&&/^\d{1,5}$/.test(raw)?Number(raw):NaN;
 if(!Number.isInteger(port)||port<=0||port>65535)fail('IDENTITY_ENV_INVALID');
 return {server:env.DB_SERVER,port,database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,connectionTimeout:15000,requestTimeout:10000,
  options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true,connectTimeout:15000,requestTimeout:10000},pool:{max:1,min:0,idleTimeoutMillis:1000}};
}
function safeFailure(error){return {status:'FAILED',code:CODES.has(error?.code)?error.code:'IDENTITY_PROBE_FAILED'};}
async function runProbe({mode,expectedIdentityHash},deps){
 if(!['local','production'].includes(mode))fail('IDENTITY_MODE_INVALID');
 if(expectedIdentityHash!==undefined&&expectedIdentityHash!==''&&!/^[a-f0-9]{64}$/.test(expectedIdentityHash))fail('IDENTITY_EXPECTED_INVALID');
 let pid=null,fields,pool;
 try{
  if(mode==='production'){pid=selectProcess(await deps.list());fields=parseDatabaseFields(await deps.readEnviron(pid));}
  else fields=await deps.localFields();
  const config=connectionConfig(fields);fields=null;pool=deps.createPool(config);pool.on?.('error',()=>{});await pool.connect();
  const request=pool.request(),query=request.query.bind(request);let reads=0;
  request.query=statement=>{if(statement!==IDENTITY_SQL||++reads!==1||!/^[\s]*SELECT\b/i.test(statement)||/\b(INSERT|UPDATE|DELETE|EXEC|EXECUTE|MERGE|ALTER|CREATE|DROP|TRUNCATE)\b/i.test(statement))fail('IDENTITY_QUERY_INVALID');return query(statement);};
  request.batch=request.execute=()=>fail('IDENTITY_QUERY_INVALID');
  const result=await request.query(IDENTITY_SQL),row=result.recordset?.length===1?result.recordset[0]:null;
  if(!row||typeof row.IdentityHash!=='string'||!/^[a-f0-9]{64}$/.test(row.IdentityHash)||typeof row.TaxableRateTablePresent!=='boolean'||!Number.isInteger(row.InvoiceTablesPresent)||row.InvoiceTablesPresent<0||row.InvoiceTablesPresent>4||!Number.isInteger(row.InvoiceUniqueKeyScopes)||row.InvoiceUniqueKeyScopes<0||row.InvoiceUniqueKeyScopes>4)fail('IDENTITY_QUERY_INVALID');
  if(mode==='production'&&selectProcess(await deps.list())!==pid)fail('IDENTITY_TARGET_CHANGED');
  const matchesExpected=expectedIdentityHash?row.IdentityHash===expectedIdentityHash:null;
  return {status:matchesExpected===false?'FAILED':'PASS',code:matchesExpected===false?'IDENTITY_MISMATCH':'IDENTITY_OBSERVED',mode,pid,configSource:mode==='production'?'proc_initial_environ':'local_next_env',identityHash:row.IdentityHash,matchesExpected,taxableRateTablePresent:row.TaxableRateTablePresent,invoiceTablesPresent:row.InvoiceTablesPresent,invoiceUniqueKeyScopes:row.InvoiceUniqueKeyScopes,selectBatches:reads};
 }finally{fields=null;if(pool)await pool.close();}
}
async function main({mode,expectedIdentityHash=process.env.DB_IDENTITY_EXPECTED_HASH}={}){
 const rawWrite=process.stdout.write.bind(process.stdout),stdoutWrite=process.stdout.write,stderrWrite=process.stderr.write,prior={...console};
 const output=value=>rawWrite(value+'\n');
 try{
  for(const key of ['log','warn','error','info','debug'])console[key]=()=>{};
  process.stdout.write=process.stderr.write=()=>true;
  let mssql;
  const deps={
   list:async()=>JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15000,maxBuffer:8*1024*1024})),
   readEnviron:async pid=>fs.readFileSync('/proc/'+pid+'/environ'),
   localFields:async()=>{require('@next/env').loadEnvConfig(process.env.PROFIT_ENV_DIR||process.cwd(),false,{info(){},error(){}});return Object.fromEntries(FIELDS.map(k=>[k,process.env[k]]));},
   createPool:config=>{mssql??=mode==='production'?require(require.resolve('mssql',{paths:[ROOT]})):require('mssql');return new mssql.ConnectionPool(config);},
  };
  const result=await runProbe({mode,expectedIdentityHash},deps);output(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;return result;
 }catch(error){const result=safeFailure(error);output(JSON.stringify(result));process.exitCode=1;return result;}
 finally{Object.assign(console,prior);process.stdout.write=stdoutWrite;process.stderr.write=stderrWrite;}
}
module.exports={main,runProbe,selectProcess,parseDatabaseFields,connectionConfig,safeFailure,IDENTITY_SQL};
if(require.main===module)main({mode:process.argv[2]}).catch(()=>{console.log(JSON.stringify({status:'FAILED',code:'IDENTITY_PROBE_FAILED'}));process.exitCode=1;});
