import crypto from 'crypto';
import {query,withTransaction,sql} from './db.js';
import {effectiveAuthority} from './userAccess.js';
import policy from './ecountWorkspacePolicy.cjs';
const {ROOT,FIELDS,scopeOf,prepareImport,assertRevision,reason,fail}=policy;
const WHERE='RootKey=@root AND MenuId=@menu AND Program=@program AND Dataset=@dataset';
const uuid=value=>typeof value==='string'?value.toLowerCase():value;
const normalizedIds=row=>({...row,...(row.versionId?{versionId:uuid(row.versionId)}:{}),...(row.previousVersionId?{previousVersionId:uuid(row.previousVersionId)}:{})});
function params(scope,extra={}) {
  return {root:{type:sql.VarChar(32),value:ROOT},menu:{type:sql.NVarChar(100),value:scope.menuId},program:{type:sql.VarChar(30),value:scope.program},dataset:{type:sql.VarChar(10),value:scope.dataset},...extra};
}
const value=(type,v)=>({type,value:v});
export async function activeAdmin(user) {
  if(!policy.authorized(user)) return false;
  const result=await query('SELECT TOP 1 UserID,Authority FROM dbo.UserInfo WHERE UserID=@id AND ISNULL(isDeleted,0)=0', {id:value(sql.NVarChar(60),user.userId)});
  return result.recordset.length===1 && Number(effectiveAuthority(result.recordset[0]))===1;
}
export async function installed() {
  const r=await query("SELECT CASE WHEN OBJECT_ID(N'ecount_work.Version',N'U') IS NOT NULL AND OBJECT_ID(N'ecount_work.Head',N'U') IS NOT NULL AND OBJECT_ID(N'ecount_work.Audit',N'U') IS NOT NULL THEN 1 ELSE 0 END AS ready");
  return r.recordset[0]?.ready===1;
}
export async function readWorkspace(input) {
  const scope=scopeOf(input),p=params(scope),view=input.view||'current';
  if(!['current','history','metadata'].includes(view)) fail('INVALID_VIEW');
  if(['ordEmpty','quoteEmpty','poEmpty','daySale','unpSale','dayAll'].includes(scope.dataset)&&view==='current')policy.validateObservedCriteria(input.criteria,scope.dataset);
  // Snapshot isolation is not assumed enabled: one repeatable serializable transaction avoids mixed head/version reads.
  return withTransaction(async q=>{
    const head=(await q(`SELECT VersionId AS versionId, Revision AS revision FROM ecount_work.Head WITH(HOLDLOCK) WHERE ${WHERE}`,p)).recordset[0];
    const base={success:true,root:ROOT,revision:head?.revision||0};
    if(view==='metadata') {
      const sources=(await q(`SELECT s.Dataset AS dataset,s.SnapshotKey AS sourceSnapshotKey,s.RowCnt AS [rowCount],s.PeriodFrom AS periodFrom,s.PeriodTo AS periodTo FROM dbo.WebEcountSnapshot s WHERE s.Dataset IN ('cash','ar','ap','sales') AND s.SnapshotKey=(SELECT MAX(t.SnapshotKey) FROM dbo.WebEcountSnapshot t WHERE t.Dataset=s.Dataset)`)).recordset;
      return {...base,datasets:Object.keys(FIELDS),sources:sources.map(s=>{
        let periodFrom=null,periodTo=null;
        try {periodFrom=policy.date(s.periodFrom);periodTo=policy.date(s.periodTo);} catch { /* unknown source period, never echo arbitrary source text */ }
        if(!periodFrom||!periodTo||periodFrom>periodTo) {periodFrom=null;periodTo=null;}
        return {dataset:s.dataset,sourceSnapshotKey:s.sourceSnapshotKey,rowCount:s.rowCount,periodFrom,periodTo,completeness:'unknown'};
      })};
    }
    if(view==='history') {
      const versions=(await q(`SELECT TOP 100 VersionId AS versionId,[RowCount] AS [rowCount],PeriodFrom AS periodFrom,PeriodTo AS periodTo,CreatedAt AS createdAt,SourceKind AS sourceKind,SourceSnapshotKey AS sourceSnapshotKey,SourceTakenAt AS sourceTakenAt FROM ecount_work.Version WHERE ${WHERE} ORDER BY CreatedAt DESC,VersionId`,p)).recordset;
      const events=(await q(`SELECT TOP 100 Revision AS revision,PreviousVersionId AS previousVersionId,VersionId AS versionId,Action AS action,ReasonCode AS reasonCode,CreatedAt AS createdAt FROM ecount_work.Audit WHERE ${WHERE} ORDER BY Revision DESC`,p)).recordset;
      return {...base,versions:versions.map(normalizedIds),events:events.map(normalizedIds)};
    }
    if(!head) return {...base,version:null};
    const v=(await q(`SELECT VersionId AS versionId,Dataset AS dataset,MenuId AS menuId,Program AS program,PeriodFrom AS periodFrom,PeriodTo AS periodTo,CreatedAt AS createdAt,SourceSnapshotKey AS sourceSnapshotKey,SourceTakenAt AS sourceTakenAt,SourceKind AS sourceKind,RowsJson AS rowsJson FROM ecount_work.Version WHERE ${WHERE} AND VersionId=@version`,params(scope,{version:value(sql.UniqueIdentifier,head.versionId)}))).recordset[0];
    if(!v) fail('INVALID_ACTIVE_VERSION',500);
    const decoded=policy.decodeVersionRows({...scope,periodFrom:v.periodFrom,periodTo:v.periodTo},v.rowsJson);
    delete v.rowsJson;
    return {...base,version:{...normalizedIds(v),completeness:'unknown',...decoded}};
  });
}
async function latestSource(q,scope) {
  const p=params(scope);
  const snap=(await q('SELECT TOP 1 SnapshotKey,PeriodFrom,PeriodTo,RowCnt,TakenAt FROM dbo.WebEcountSnapshot WITH(HOLDLOCK) WHERE Dataset=@dataset ORDER BY SnapshotKey DESC',p)).recordset[0];
  if(!snap) fail('SOURCE_NOT_FOUND',404);
  if(snap.RowCnt>20000) fail('SOURCE_TOO_LARGE',413);
  // Strict SQL projection: no raw Payload/name/account/memo leaves the database.
  const fields=[...FIELDS[scope.dataset],...(['cash','sales'].includes(scope.dataset)?['refDate']:[]),...(scope.dataset==='cash'?['flow']:[])];
  const projection=fields.map(f=>`JSON_VALUE(Payload,'$.${f}') AS [${f}]`).join(',');
  const rows=(await q(`SELECT TOP 20001 ${projection}, IsSubtotal AS isSubtotal FROM dbo.WebEcountRow WITH(HOLDLOCK) WHERE SnapshotKey=@snapshot AND Dataset=@dataset ORDER BY RowKey`,params(scope,{snapshot:value(sql.Int,snap.SnapshotKey)}))).recordset;
  if(rows.length>20000) fail('SOURCE_TOO_LARGE',413);
  // Legacy RowCnt counts detail rows only; subtotals remain part of the immutable projection.
  if(rows.filter(r=>!r.isSubtotal).length!==snap.RowCnt) fail('SOURCE_ROW_COUNT_MISMATCH',409);
  return {rows,periodFrom:snap.PeriodFrom,periodTo:snap.PeriodTo,sourceSnapshotKey:snap.SnapshotKey,sourceTakenAt:snap.TakenAt};
}
export async function saveVersion(input,user) {
  const scope=scopeOf(input),expected=policy.expectedRevision(input.expectedRevision);
  if(policy.READ_ONLY_DATASETS.includes(scope.dataset)) fail('IMPORT_NOT_VERIFIED');
  if(!['import','import-latest','activate'].includes(input.action)) fail('INVALID_ACTION');
  if(input.action==='import-latest'&&!policy.SOURCE_DATASETS.includes(scope.dataset)) fail('SOURCE_IMPORT_UNSUPPORTED');
  const reasonCode=reason(input.reasonCode,input.action);
  const actor=crypto.createHash('sha256').update('ecount-workspace:'+user.userId).digest('hex');
  // Validate untrusted upload before acquiring locks, storing only the safe projection.
  const upload=input.action==='import'?prepareImport(input):null;
  if(input.action==='activate' && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.versionId||'')) fail('INVALID_VERSION');
  return withTransaction(async q=>{
    const lock=crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    await q("DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 51003,'Workspace lock unavailable',1",{lock:value(sql.NVarChar(255),'ecount-workspace:'+lock)});
    const head=(await q(`SELECT VersionId AS versionId,Revision AS revision FROM ecount_work.Head WITH(UPDLOCK,HOLDLOCK) WHERE ${WHERE}`,params(scope))).recordset[0];
    assertRevision(head?.revision||0,expected);
    let versionId=input.versionId;
    if(input.action==='activate') {
      const exists=(await q(`SELECT VersionId FROM ecount_work.Version WHERE ${WHERE} AND VersionId=@version`,params(scope,{version:value(sql.UniqueIdentifier,versionId)}))).recordset[0];
      if(!exists) fail('VERSION_NOT_FOUND',404);
      if(['ordEmpty','quoteEmpty','poEmpty','daySale','unpSale','dayAll'].includes(scope.dataset)){const observed=(await q(`SELECT RowsJson AS rowsJson,PeriodFrom AS periodFrom,PeriodTo AS periodTo FROM ecount_work.Version WHERE ${WHERE} AND VersionId=@version`,params(scope,{version:value(sql.UniqueIdentifier,versionId)}))).recordset[0];if(!observed)fail('VERSION_NOT_FOUND',404);policy.decodeVersionRows({...scope,periodFrom:observed.periodFrom,periodTo:observed.periodTo},observed.rowsJson);}
    } else {
      const source=input.action==='import-latest'?await latestSource(q,scope):null;
      const data=upload||prepareImport({...scope,...source});
      const existing=(await q(`SELECT VersionId AS versionId FROM ecount_work.Version WHERE ${WHERE} AND ContentHash=@hash`,params(scope,{hash:value(sql.Char(64),data.hash)}))).recordset[0];
      if(existing && uuid(existing.versionId)===uuid(head?.versionId)) return {success:true,revision:expected,versionId:uuid(existing.versionId),idempotent:true};
      versionId=existing?.versionId||crypto.randomUUID();
      if(!existing) await q(`INSERT INTO ecount_work.Version (VersionId,RootKey,MenuId,Program,Dataset,ContentHash,PeriodFrom,PeriodTo,Completeness,[RowCount],RowsJson,SourceKind,SourceSnapshotKey,SourceTakenAt,ActorHash) VALUES (@version,@root,@menu,@program,@dataset,@hash,@from,@to,'unknown',@count,@rows,@source,@snapshot,@sourceTakenAt,@actor)`,params(scope,{version:value(sql.UniqueIdentifier,versionId),hash:value(sql.Char(64),data.hash),from:value(sql.Char(10),data.periodFrom),to:value(sql.Char(10),data.periodTo),count:value(sql.Int,data.rows.length),rows:value(sql.NVarChar(sql.MAX),policy.encodeVersionRows(data)),source:value(sql.VarChar(20),source?'existing-snapshot':'upload'),snapshot:value(sql.Int,source?.sourceSnapshotKey??null),sourceTakenAt:value(sql.DateTime2,source?.sourceTakenAt??null),actor:value(sql.Char(64),actor)}));
    }
    const p=params(scope,{version:value(sql.UniqueIdentifier,versionId),revision:value(sql.Int,expected+1),previous:value(sql.UniqueIdentifier,head?.versionId||null),action:value(sql.VarChar(20),input.action),reason:value(sql.VarChar(20),reasonCode),actor:value(sql.Char(64),actor)});
    if(head) await q(`UPDATE ecount_work.Head SET VersionId=@version,Revision=@revision WHERE ${WHERE}`,p);
    else await q('INSERT INTO ecount_work.Head (RootKey,MenuId,Program,Dataset,VersionId,Revision) VALUES (@root,@menu,@program,@dataset,@version,@revision)',p);
    await q('INSERT INTO ecount_work.Audit (RootKey,MenuId,Program,Dataset,Revision,PreviousVersionId,VersionId,Action,ReasonCode,ActorHash) VALUES (@root,@menu,@program,@dataset,@revision,@previous,@version,@action,@reason,@actor)',p);
    return {success:true,revision:expected+1,versionId:uuid(versionId),idempotent:false};
  });
}
