import crypto from 'crypto';
import { query, sql } from './db';
import { recentMonth } from './ecountCustomerLedgerPolicy.cjs';
import { validateLedger,validateFailure } from './ecountLedgerValidation.cjs';
import { freshness, isRefreshRequestAllowed } from './ecountLedgerSchedule.cjs';
import { calculatePendingReceipts, validateBankSnapshot } from './ecountPendingReceipts.cjs';

const DATASET = 'ledger723';
const fingerprint = code => crypto.createHash('sha256').update(`E040723:${code}`).digest('hex');
// Resolve a single active owner, including legacy Manager=UserName records.
// Exact official identity only; OrderCode is an order-entry mnemonic, not a verified source code.
export async function ledgerCustomers(userId = null, includeAllActive = false) {
  const r = await query(`
    SELECT c.CustKey, c.CustName, identityValue.code, owner.UserID AS managerUserId, owner.UserName AS managerName, owner.matches AS managerMatchCount,
           identityCount.matches AS codeMatchCount
    FROM Customer c
    CROSS APPLY (SELECT REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(c.BusinessNumber,''))),'-',''),' ','') AS code) identityValue
    CROSS APPLY (SELECT COUNT(*) AS matches, MIN(u.UserID) AS UserID, MIN(u.UserName) AS UserName FROM UserInfo u
      WHERE ISNULL(u.isDeleted,0)=0 AND NULLIF(LTRIM(RTRIM(c.Manager)),'') IS NOT NULL
      AND (LTRIM(RTRIM(c.Manager))=u.UserID OR LTRIM(RTRIM(c.Manager))=u.UserName)) owner
    CROSS APPLY (SELECT COUNT(*) AS matches FROM Customer other
      WHERE ISNULL(other.isDeleted,0)=0 AND REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(other.BusinessNumber,''))),'-',''),' ','')=identityValue.code) identityCount
     WHERE ISNULL(c.isDeleted,0)=0 AND (
       (@allActive=1 AND EXISTS (SELECT 1 FROM UserInfo adminUser WHERE ISNULL(adminUser.isDeleted,0)=0 AND adminUser.UserID=@uid))
       OR (@allActive=0 AND owner.matches=1 AND (@uid IS NULL OR owner.UserID=@uid))
     )
     ORDER BY c.CustName,c.CustKey`, {
      uid: { type: sql.NVarChar, value: userId }, allActive: { type: sql.Bit, value: includeAllActive },
    });
  return r.recordset.map(c => ({ custKey: c.CustKey, name: c.CustName, managerUserId: c.managerUserId, managerMatchCount:c.managerMatchCount, managerName:c.managerMatchCount===1?c.managerName:null,
    active: true, ecountCode: /^\d{10}$/.test(c.code) ? c.code : '', codeMatchCount: c.codeMatchCount,
    linked: /^\d{10}$/.test(c.code) && c.codeMatchCount === 1 }));
}
export async function readLedger(customer) {
  const period = recentMonth();
  const params={dataset:{type:sql.NVarChar,value:DATASET},scope:{type:sql.NVarChar,value:`customer:${customer.custKey}`}};
  const [r,attempt] = await Promise.all([query(`SELECT TOP (1) SnapshotKey, TakenAt, VerifyDetail FROM WebEcountSnapshot
    WHERE Dataset=@dataset AND Note=@scope AND VerifyStatus='GREEN'
    ORDER BY SnapshotKey DESC`,params),query(`SELECT TOP (1) SnapshotKey, VerifyStatus, VerifyDetail FROM WebEcountSnapshot
    WHERE Dataset=@dataset AND Note=@scope ORDER BY SnapshotKey DESC`,params)]);
  const record = r.recordset[0];
  let failure=null;
  try{
    const latest=attempt.recordset[0],stored=JSON.parse(latest?.VerifyDetail||'null');
    if(latest?.VerifyStatus==='RED'&&latest.SnapshotKey>(record?.SnapshotKey||0)&&stored?.codeHash===fingerprint(customer.ecountCode)&&stored.custKey===customer.custKey&&Number.isFinite(Date.parse(stored.collectedAt))&&Date.parse(stored.collectedAt)<=Date.now()+60000){
      validateFailure(stored,new Date(stored.collectedAt));failure={reason:stored.failure,at:stored.collectedAt};
    }
  }catch{}
  if (!record) return { ledger:null, period, failure,schedule:freshness(null) };
  let ledger;
  try {
    const stored = JSON.parse(record.VerifyDetail);
    if (stored.codeHash !== fingerprint(customer.ecountCode) || stored.custKey !== customer.custKey) throw new Error('SCOPE');
    if (!Number.isFinite(Date.parse(stored.collectedAt)) || Date.parse(stored.collectedAt)>Date.now()+60000) throw new Error('TIME');
    ledger = validateLedger({ ...stored, individual:true, screenRowCount:stored.rows.length, empty:stored.opening===null },new Date(stored.collectedAt));
  } catch { return { ledger:null, period, failure,schedule:freshness(null) }; }
  // DB DateTime has no timezone; collection time is the explicit UTC value in the payload.
  const stored = JSON.parse(record.VerifyDetail), takenAt = stored.collectedAt;
  const receipts=stored.bankEvidence?calculatePendingReceipts(stored.bankEvidence,{...ledger,collectedAt:takenAt},stored.codeHash):null;
  return { ledger, receipts, takenAt, failure,snapshotKey:record.SnapshotKey, period:{from:ledger.periodFrom,to:ledger.periodTo}, schedule:freshness(takenAt) };
}
export async function saveLedger(input) {
  const ledger = validateLedger(input);
  const customer = (await ledgerCustomers()).find(c=>c.custKey===ledger.custKey && c.linked);
  if (!customer || input.observedCode !== customer.ecountCode || input.observedBusinessIdentity !== customer.ecountCode) throw new Error('SOURCE_IDENTITY_MISMATCH');
  const collected = Date.parse(input.collectedAt);
  if (!Number.isFinite(collected) || collected > Date.now()+60000 || collected < Date.now()-10*60000) throw new Error('EXPIRED_COLLECTION');
  const stored = { ...ledger, collectedAt:new Date(collected).toISOString(), codeHash:fingerprint(customer.ecountCode) };
  if(input.bankEvidence){
    const result=calculatePendingReceipts(input.bankEvidence,stored,stored.codeHash);
    if(result.status==='VERIFIED'){
      // Retain only this customer's matching patterns, including conflicting history as evidence.
      const ids=new Set(result.rows.map(r=>r.id));
      const patterns=new Set(input.bankEvidence.after.rows.filter(r=>ids.has(r.id)).map(r=>r.pattern));
      stored.bankEvidence=Object.fromEntries(['before','after','history'].map(key=>{
        const bank=validateBankSnapshot(input.bankEvidence[key]);
        return [key,{...bank,rows:bank.rows.filter(r=>patterns.has(r.pattern)||(key==='history'&&r.code===stored.codeHash))}];
      }));
    }else stored.bankEvidence={unavailable:true};
  }
  // Atomic append to the existing web-only snapshot table. No schema or ERP ledger writes.
  const r = await query(`INSERT INTO WebEcountSnapshot
    (Dataset,PeriodFrom,PeriodTo,Actor,Source,RowCnt,VerifyStatus,VerifyScore,VerifyDetail,Note)
    OUTPUT INSERTED.SnapshotKey VALUES (@dataset,@from,@to,'ecount-ledger-collector','owner-pc',@count,'GREEN',100,@payload,@scope)`, {
    dataset:{type:sql.NVarChar,value:DATASET},from:{type:sql.NVarChar,value:ledger.periodFrom},to:{type:sql.NVarChar,value:ledger.periodTo},
    count:{type:sql.Int,value:ledger.rows.length},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(stored)},scope:{type:sql.NVarChar,value:`customer:${customer.custKey}`},
  });
  return { snapshotKey:r.recordset[0].SnapshotKey, count:ledger.rows.length };
}
export async function saveLedgerFailure(input){
  const attempt=validateFailure(input);
  const customer=(await ledgerCustomers()).find(c=>c.custKey===attempt.custKey&&c.linked);
  if(!customer||input.requestedCode!==customer.ecountCode)throw new Error('SOURCE_IDENTITY_MISMATCH');
  const collected=Date.parse(input.collectedAt);
  if(!Number.isFinite(collected)||collected>Date.now()+60000||collected<Date.now()-10*60000)throw new Error('EXPIRED_COLLECTION');
  const stored={...attempt,collectedAt:new Date(collected).toISOString(),codeHash:fingerprint(customer.ecountCode)};
  const r=await query(`INSERT INTO WebEcountSnapshot
    (Dataset,PeriodFrom,PeriodTo,Actor,Source,RowCnt,VerifyStatus,VerifyScore,VerifyDetail,Note)
    OUTPUT INSERTED.SnapshotKey VALUES (@dataset,@from,@to,'ecount-ledger-collector','owner-pc',0,'RED',0,@payload,@scope)`,{
    dataset:{type:sql.NVarChar,value:DATASET},from:{type:sql.NVarChar,value:attempt.periodFrom},to:{type:sql.NVarChar,value:attempt.periodTo},
    payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(stored)},scope:{type:sql.NVarChar,value:`customer:${customer.custKey}`},
  });
  return {snapshotKey:r.recordset[0].SnapshotKey,count:0};
}

const refreshNote = custKey => `refresh-request:${custKey}`;
function refreshEvent(row,custKey){
  try{
    const value=JSON.parse(row?.VerifyDetail||'null');
    if(value?.kind!=='LEDGER_REFRESH_REQUEST'||value.custKey!==custKey)return null;
    return {status:value.state,requestedAt:value.requestedAt,updatedAt:value.updatedAt,
      error:value.failure==='SOURCE_UNAVAILABLE'?'SOURCE_UNAVAILABLE':null};
  }catch{return null;}
}
export async function readLedgerRefreshRequest(custKey){
  const r=await query(`SELECT TOP (1) SnapshotKey,VerifyStatus,VerifyDetail FROM WebEcountSnapshot
    WHERE Dataset=@dataset AND Note=@note ORDER BY SnapshotKey DESC`,{
    dataset:{type:sql.NVarChar,value:DATASET},note:{type:sql.NVarChar,value:refreshNote(custKey)}});
  const event=refreshEvent(r.recordset[0],custKey);
  return event?{status:event.status,requestedAt:event.requestedAt,updatedAt:event.updatedAt,error:event.error}:null;
}
async function appendRefreshEvent(custKey,state,requestedAt,failure=null){
  const period=recentMonth(),updatedAt=new Date().toISOString();
  const verifyStatus=state==='COMPLETE'?'GREEN':state==='FAILED'?'RED':'AMBER';
  const payload={kind:'LEDGER_REFRESH_REQUEST',state,custKey,requestedAt,updatedAt,...(failure?{failure}: {})};
  const r=await query(`INSERT INTO WebEcountSnapshot
    (Dataset,PeriodFrom,PeriodTo,Actor,Source,RowCnt,VerifyStatus,VerifyScore,VerifyDetail,Note)
    OUTPUT INSERTED.SnapshotKey VALUES (@dataset,@from,@to,'ecount-ledger-refresh','web-request',0,@status,0,@payload,@note)`,{
    dataset:{type:sql.NVarChar,value:DATASET},from:{type:sql.NVarChar,value:period.from},to:{type:sql.NVarChar,value:period.to},
    status:{type:sql.NVarChar,value:verifyStatus},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(payload)},
    note:{type:sql.NVarChar,value:refreshNote(custKey)},
  });
  return r.recordset[0].SnapshotKey;
}
export async function requestLedgerRefresh(userId,custKey,now=Date.now(),includeAllActive=false){
  if(!isRefreshRequestAllowed(now))throw new Error('REQUEST_WINDOW_CLOSED');
  const customer=(await ledgerCustomers(userId,includeAllActive)).find(c=>c.custKey===custKey&&(!includeAllActive||c.managerMatchCount===1));
  if(!customer)throw new Error('CUSTOMER_FORBIDDEN');
  if(!customer.linked)throw new Error('CUSTOMER_LINK_REQUIRED');
  const current=refreshEvent((await query(`SELECT TOP (1) SnapshotKey,VerifyStatus,VerifyDetail FROM WebEcountSnapshot
    WHERE Dataset=@dataset AND Note=@note ORDER BY SnapshotKey DESC`,{
      dataset:{type:sql.NVarChar,value:DATASET},note:{type:sql.NVarChar,value:refreshNote(custKey)}})).recordset[0],custKey);
  if(current?.status==='PENDING'||current?.status==='RUNNING')return current;
  const last=Date.parse(current?.updatedAt||'');
  if(Number.isFinite(last)&&now-last<10*60000)throw new Error('REQUEST_RATE_LIMIT');
  const requestedAt=new Date(now).toISOString();
  await appendRefreshEvent(custKey,'PENDING',requestedAt);
  return {status:'PENDING',requestedAt};
}
export async function claimNextLedgerRefresh(){
  const r=await query(`WITH Latest AS(
      SELECT Note,MAX(SnapshotKey) SnapshotKey FROM WebEcountSnapshot
      WHERE Dataset=@dataset AND Note LIKE @prefix GROUP BY Note)
    SELECT TOP (1) s.SnapshotKey,s.Note,s.VerifyDetail FROM Latest l JOIN WebEcountSnapshot s ON s.SnapshotKey=l.SnapshotKey
    WHERE s.VerifyStatus='AMBER' AND JSON_VALUE(s.VerifyDetail,'$.kind')='LEDGER_REFRESH_REQUEST'
      AND (JSON_VALUE(s.VerifyDetail,'$.state')='PENDING' OR
        (JSON_VALUE(s.VerifyDetail,'$.state')='RUNNING' AND TRY_CONVERT(datetimeoffset,JSON_VALUE(s.VerifyDetail,'$.updatedAt'))<DATEADD(MINUTE,-120,SYSUTCDATETIME())))
      ORDER BY s.SnapshotKey`,{
    dataset:{type:sql.NVarChar,value:DATASET},prefix:{type:sql.NVarChar,value:'refresh-request:%'}});
  const row=r.recordset[0];if(!row)return null;
  const custKey=Number(row.Note.slice('refresh-request:'.length));
  if(!Number.isSafeInteger(custKey)||custKey<1)return null;
  const event=refreshEvent(row,custKey);
  const customer=(await ledgerCustomers()).find(c=>c.custKey===custKey&&c.linked);
  if(!event||!['PENDING','RUNNING'].includes(event.status))return null;
  if(!customer){await appendRefreshEvent(custKey,'FAILED',event.requestedAt,'SOURCE_UNAVAILABLE');return null;}
  const requestId=await appendRefreshEvent(custKey,'RUNNING',event.requestedAt);
  return {requestId,custKey,sourceCode:customer.ecountCode,period:recentMonth()};
}
export async function finishLedgerRefreshRequest(requestId,success){
  if(!Number.isSafeInteger(Number(requestId))||Number(requestId)<1)throw new Error('INVALID_REFRESH_REQUEST');
  const r=await query(`SELECT SnapshotKey,Note,VerifyStatus,VerifyDetail FROM WebEcountSnapshot
    WHERE Dataset=@dataset AND SnapshotKey=@key AND Note LIKE @prefix`,{
    dataset:{type:sql.NVarChar,value:DATASET},key:{type:sql.Int,value:Number(requestId)},prefix:{type:sql.NVarChar,value:'refresh-request:%'}});
  const row=r.recordset[0];if(!row)throw new Error('INVALID_REFRESH_REQUEST');
  const custKey=Number(row.Note.slice('refresh-request:'.length)),event=refreshEvent(row,custKey);
  if(!event||event.status!=='RUNNING')throw new Error('INVALID_REFRESH_REQUEST');
  await appendRefreshEvent(custKey,success?'COMPLETE':'FAILED',event.requestedAt,success?null:'SOURCE_UNAVAILABLE');
  return {status:success?'COMPLETE':'FAILED'};
}
