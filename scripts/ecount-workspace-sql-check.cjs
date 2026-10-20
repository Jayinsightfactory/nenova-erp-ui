'use strict';
// Real SQL verification. Every mutation is inside an explicitly rolled-back transaction.
// Usage: node scripts/ecount-workspace-sql-check.cjs --env-file <absolute .env.local path>
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const sql=require('mssql');
const policy=require('../lib/ecountWorkspacePolicy.cjs');
const menus=require('../data/ecount-workbench/source-menu.json').menus;
const allowed=new Set(['ecount_work.Version','ecount_work.Head','ecount_work.Audit']);
let stage='CONFIG';
function verifyWriteAllowlist(text) {
  if(/\b(?:CREATE|ALTER|DROP|TRUNCATE|MERGE|DELETE)\b/i.test(text)) throw Error('WRITE_SCOPE_REJECTED');
  for(const match of text.matchAll(/\b(?:INSERT\s+INTO|UPDATE)\s+([\w.]+)/gi)) {
    if(!allowed.has(match[1])) throw Error('WRITE_SCOPE_REJECTED');
  }
  if(/\bEXEC(?:UTE)?\b/i.test(text) && !text.includes('sys.sp_getapplock')) throw Error('EXEC_SCOPE_REJECTED');
}
function sourceStore() {
  return fs.readFileSync(path.join(__dirname,'../lib/ecountWorkspaceStore.js'),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/export async function /g,'async function ');
}
function storeFor(q) {
  const context={crypto,sql,policy,query:q,withTransaction:async fn=>fn(q),effectiveAuthority:u=>u.Authority};
  vm.createContext(context);vm.runInContext(sourceStore()+'\nthis.saveVersion=saveVersion;',context);
  return context;
}
function requestFor(connection) {
  return async (text,params={})=>{
    verifyWriteAllowlist(text);
    const request=new sql.Request(connection);
    for(const [name,p] of Object.entries(params)) request.input(name,p.type,p.value);
    return request.query(text);
  };
}
async function rollbackOnly(pool,fn) {
  const transaction=new sql.Transaction(pool);let begun=false,rolledBack=false;
  transaction.on('rollback',()=>{rolledBack=true;});
  try {await transaction.begin();begun=true;return await fn(requestFor(transaction));}
  finally {if(begun&&!rolledBack) await transaction.rollback();}
}
const parameter=(type,value)=>({type,value});
const scope=policy.scopeOf({dataset:'sales',menuId:menus.find(m=>m.program===policy.PROGRAMS.sales).id});
const scopeSql='RootKey=@root AND MenuId=@menu AND Program=@program AND Dataset=@dataset';
function scopeParams(extra={}) {return {root:parameter(sql.VarChar(32),scope.root),menu:parameter(sql.NVarChar(100),scope.menuId),program:parameter(sql.VarChar(30),scope.program),dataset:parameter(sql.VarChar(10),scope.dataset),...extra};}
async function currentRevision(q) {
  const lock='ecount-workspace:'+crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  await q("DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 51003,'Workspace lock unavailable',1",{lock:parameter(sql.NVarChar(255),lock)});
  return (await q(`SELECT Revision AS revision FROM ecount_work.Head WITH(UPDLOCK,HOLDLOCK) WHERE ${scopeSql}`,scopeParams())).recordset[0]?.revision||0;
}
const actor={userId:'synthetic-ecount-sql-check',authority:1,accountActive:true};
function payload(revision,qty) {return {...scope,action:'import',expectedRevision:revision,reasonCode:'IMPORT',periodFrom:null,periodTo:null,rows:[{qty,unitPrice:'12.34000000',supplyAmt:'123.45000000',vat:'12.34500000',total:'135.79500000',refDate:null,isSubtotal:false}]};}
async function verifyAbsent(pool,versionIds) {
  const q=requestFor(pool);
  for(const id of versionIds) {
    const p={version:parameter(sql.UniqueIdentifier,id)};
    for(const table of ['Version','Head','Audit']) {
      const found=(await q(`SELECT COUNT(*) AS n FROM ecount_work.${table} WHERE VersionId=@version`,p)).recordset[0].n;
      assert.equal(found,0,'ROLLBACK_NOT_CONFIRMED');
    }
  }
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--env-file'||!path.isAbsolute(args[1])) throw Error('EXPLICIT_ENV_FILE_REQUIRED');
  // Native parser avoids undeclared dotenv dependency and never changes process.env.
  const env=require('node:util').parseEnv(fs.readFileSync(args[1],'utf8'));
  if(!['DB_SERVER','DB_NAME','DB_USER','DB_PASSWORD'].every(k=>env[k])) throw Error('DB_CONFIG_REQUIRED');
  stage='CONNECT';
  const pool=await new sql.ConnectionPool({server:env.DB_SERVER,port:Number(env.DB_PORT||1433),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true,enableArithAbort:true},connectionTimeout:15000,requestTimeout:20000,pool:{max:2,min:0,idleTimeoutMillis:1000}}).connect();
  let checks=0;
  try {
    const created=[];
    const testQty='9'+BigInt('0x'+crypto.randomBytes(8).toString('hex')).toString()+'.12345678';
    await rollbackOnly(pool,async q=>{
      stage='IMPORT_FIRST';
      const store=storeFor(q),initial=await currentRevision(q);
      const first=await store.saveVersion(payload(initial,testQty),actor);created.push(first.versionId);
      stage='IMPORT_CORRECTION';
      const second=await store.saveVersion({...payload(first.revision,testQty.replace('.12345678','.12345679')),reasonCode:'CORRECTION'},actor);created.push(second.versionId);
      assert.equal(second.revision,initial+2);
      stage='ACTIVATE';
      const rollback=await store.saveVersion({...scope,action:'activate',expectedRevision:second.revision,versionId:first.versionId,reasonCode:'ROLLBACK'},actor);
      assert.equal(rollback.revision,initial+3);
      stage='READBACK';
      const head=(await q(`SELECT VersionId AS versionId,Revision AS revision FROM ecount_work.Head WHERE ${scopeSql}`,scopeParams())).recordset[0];
      assert.equal(head.versionId.toLowerCase(),first.versionId.toLowerCase());assert.equal(head.revision,rollback.revision);
      const stored=(await q('SELECT RowsJson AS rowsJson FROM ecount_work.Version WHERE VersionId=@version',{version:parameter(sql.UniqueIdentifier,first.versionId)})).recordset[0];
      assert.equal(JSON.parse(stored.rowsJson)[0].qty,testQty);
      assert.equal(JSON.parse(stored.rowsJson)[0].unitPrice,'12.34000000');
      const events=(await q(`SELECT Revision AS revision,Action AS action FROM ecount_work.Audit WHERE ${scopeSql} AND Revision>@initial ORDER BY Revision`,scopeParams({initial:parameter(sql.Int,initial)}))).recordset;
      assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.action),['import','import','activate']);
      checks+=5;
    });
    stage='VERIFY_ROLLBACK';await verifyAbsent(pool,created);checks++;
    // Each trigger/constraint failure gets its own transaction, since THROW can abort it.
    for(const test of [{table:'Version',number:51001},{table:'Audit',number:51002},{table:'Head',number:547}]) {
      stage='NEGATIVE_'+test.table.toUpperCase();
      const ids=[];let rejected=false;
      try {
        await rollbackOnly(pool,async q=>{
          const store=storeFor(q),initial=await currentRevision(q);
          const saved=await store.saveVersion(payload(initial,testQty),actor);ids.push(saved.versionId);
          if(test.table==='Version') await q('UPDATE ecount_work.Version SET [RowCount]=[RowCount] WHERE VersionId=@version',{version:parameter(sql.UniqueIdentifier,saved.versionId)});
          else if(test.table==='Audit') await q('UPDATE ecount_work.Audit SET ReasonCode=ReasonCode WHERE VersionId=@version',{version:parameter(sql.UniqueIdentifier,saved.versionId)});
          else await q(`UPDATE ecount_work.Head SET VersionId=@version WHERE ${scopeSql}`,scopeParams({version:parameter(sql.UniqueIdentifier,crypto.randomUUID())}));
        });
      } catch(error) {
        rejected=[error.number,error.originalError?.info?.number,...(error.precedingErrors||[]).map(e=>e.number)].includes(test.number);
        if(!rejected) throw Error('SQL_NEGATIVE_CHECK_FAILED');
      }
      assert(rejected,'SQL_REJECTION_REQUIRED');await verifyAbsent(pool,ids);checks++;
    }
    console.log(JSON.stringify({success:true,checks,rollbackConfirmed:true,existingLedgersWritten:false}));
  } finally {await pool.close();}
}
if(require.main===module) main().catch(error=>{console.error(JSON.stringify({success:false,status:'SQL_CHECK_FAILED_NO_DATA_LOGGED',stage,sqlCode:Number.isInteger(error.number)?error.number:null,errorCode:['ERR_ASSERTION','EABORT','EREQUEST'].includes(error.code)?error.code:null}));process.exitCode=1;});
module.exports={verifyWriteAllowlist,rollbackOnly};
