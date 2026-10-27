import crypto from 'crypto';
import { query, sql } from './db';
import { recentMonth } from './ecountCustomerLedgerPolicy.cjs';
import { validateLedger,validateFailure } from './ecountLedgerValidation.cjs';
import { freshness } from './ecountLedgerSchedule.cjs';

const DATASET = 'ledger723';
const fingerprint = code => crypto.createHash('sha256').update(`E040723:${code}`).digest('hex');
// Resolve a single active owner, including legacy Manager=UserName records.
// Exact official identity only; OrderCode is an order-entry mnemonic, not a verified source code.
export async function ledgerCustomers(userId = null) {
  const r = await query(`
    SELECT c.CustKey, c.CustName, identityValue.code, owner.UserID AS managerUserId,
           identityCount.matches AS codeMatchCount
    FROM Customer c
    CROSS APPLY (SELECT REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(c.BusinessNumber,''))),'-',''),' ','') AS code) identityValue
    CROSS APPLY (SELECT COUNT(*) AS matches, MIN(u.UserID) AS UserID FROM UserInfo u
      WHERE ISNULL(u.isDeleted,0)=0 AND NULLIF(LTRIM(RTRIM(c.Manager)),'') IS NOT NULL
      AND (LTRIM(RTRIM(c.Manager))=u.UserID OR LTRIM(RTRIM(c.Manager))=u.UserName)) owner
    CROSS APPLY (SELECT COUNT(*) AS matches FROM Customer other
      WHERE ISNULL(other.isDeleted,0)=0 AND REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(other.BusinessNumber,''))),'-',''),' ','')=identityValue.code) identityCount
    WHERE ISNULL(c.isDeleted,0)=0 AND owner.matches=1 AND (@uid IS NULL OR owner.UserID=@uid)
    ORDER BY c.CustName,c.CustKey`, { uid: { type: sql.NVarChar, value: userId } });
  return r.recordset.map(c => ({ custKey: c.CustKey, name: c.CustName, managerUserId: c.managerUserId,
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
  const takenAt = JSON.parse(record.VerifyDetail).collectedAt;
  return { ledger, takenAt, failure,snapshotKey:record.SnapshotKey, period:{from:ledger.periodFrom,to:ledger.periodTo}, schedule:freshness(takenAt) };
}
export async function saveLedger(input) {
  const ledger = validateLedger(input);
  const customer = (await ledgerCustomers()).find(c=>c.custKey===ledger.custKey && c.linked);
  if (!customer || input.observedCode !== customer.ecountCode || input.observedBusinessIdentity !== customer.ecountCode) throw new Error('SOURCE_IDENTITY_MISMATCH');
  const collected = Date.parse(input.collectedAt);
  if (!Number.isFinite(collected) || collected > Date.now()+60000 || collected < Date.now()-10*60000) throw new Error('EXPIRED_COLLECTION');
  const stored = { ...ledger, collectedAt:new Date(collected).toISOString(), codeHash:fingerprint(customer.ecountCode) };
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
