import crypto from 'node:crypto';
import {query,sql,withTransaction} from './db.js';
import {canDeleteFarmQuality,qualityScope,qualityGroups,qualityAnalytics,qualitySignals,qualitySourceCoverage,qualitySignalCoverage,transitionQuality} from './farmQuality.js';
import {canUseDefectIncoming} from './salesDefectDeductionCore.js';
import {normalizeEvidenceKeys} from './farmQualityEvidence.js';
const nv=value=>({type:sql.NVarChar,value});
const num=value=>({type:sql.Int,value});
const uid=value=>({type:sql.UniqueIdentifier,value});
const big=value=>({type:sql.BigInt,value});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function date(value,required=false){if(!value&&!required)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||new Date(value).toISOString().slice(0,10)!==value)throw new Error('날짜를 확인하세요.');return value;}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`내용을 1~${max}자로 입력하세요.`);return value.trim();}
async function ready(){const r=await query("SELECT OBJECT_ID(N'dbo.WebFarmQualityEvent',N'U') AS id, OBJECT_ID(N'dbo.WebFarmQualityCase',N'U') AS caseId, OBJECT_ID(N'dbo.WebFarmQualityEvidence',N'U') AS evidenceId");if(!r.recordset[0]?.id||!r.recordset[0]?.caseId||!r.recordset[0]?.evidenceId)throw new Error('농장 피드백 저장소 설치가 필요합니다. 관리자에게 문의하세요.');}
const sourceSQL=`SELECT d.DeductionKey,d.OrderYear,d.OrderWeek,d.CustKey,d.CustName,d.ProdKey,d.ProdName,
 COALESCE(NULLIF(p.DisplayName,N''),p.ProdName,d.ProdName) ProductName,
 d.FarmKey,d.FarmName,d.SourceUnit,d.Quantity,d.OriginalQuantity,d.ImportConfirmed,d.IsDeleted
 FROM dbo.WebSalesDefectDeduction d LEFT JOIN Product p ON p.ProdKey=d.ProdKey
 WHERE d.OrderYear=@year AND d.DeductionType=N'불량차감'`;
const incomingSQL=`SELECT vw.OrderYear,vw.OrderWeek,LTRIM(RTRIM(ISNULL(vw.FarmName,N''))) FarmName,
 vw.ProdKey,COALESCE(NULLIF(p.DisplayName,N''),p.ProdName,vw.ProdName) ProductName,
 COALESCE(NULLIF(LTRIM(RTRIM(p.OutUnit)),N''),N'미지정') SourceUnit,
 SUM(CONVERT(decimal(19,4),ISNULL(vw.OutQuantity,0))) IncomingQuantity
 FROM dbo.ViewWarehouse vw JOIN dbo.Product p ON p.ProdKey=vw.ProdKey
 WHERE vw.OrderYear=@year
 GROUP BY vw.OrderYear,vw.OrderWeek,LTRIM(RTRIM(ISNULL(vw.FarmName,N''))),vw.ProdKey,
 COALESCE(NULLIF(p.DisplayName,N''),p.ProdName,vw.ProdName),COALESCE(NULLIF(LTRIM(RTRIM(p.OutUnit)),N''),N'미지정')`;
export async function loadQuality(input){
 const scope=qualityScope(input);await ready();
 const [sources,incoming,cases,recentEvents]=await Promise.all([query(sourceSQL,{year:num(scope.year)}),query(incomingSQL,{year:num(scope.year)}),query(`SELECT c.*, latest.Body LatestBody, latest.AuthorName LatestAuthor,
 latest.Department LatestDepartment FROM dbo.WebFarmQualityCase c OUTER APPLY
 (SELECT TOP (1) Body,AuthorName,Department FROM dbo.WebFarmQualityEvent e WHERE e.CaseKey=c.CaseKey ORDER BY EventKey DESC) latest
 WHERE c.OrderYear=@year ORDER BY c.UpdatedAt DESC`,{year:num(scope.year)}),query(`WITH RankedEvents AS (
  SELECT e.CaseKey,e.EventKey,e.Kind,e.Body,e.AuthorName,e.Department,e.CreatedAt,
   ROW_NUMBER() OVER(PARTITION BY e.CaseKey ORDER BY e.EventKey) EventNo,
   ROW_NUMBER() OVER(PARTITION BY e.CaseKey ORDER BY e.EventKey DESC) RecentRank,
   COUNT(*) OVER(PARTITION BY e.CaseKey) EventCount
  FROM dbo.WebFarmQualityEvent e JOIN dbo.WebFarmQualityCase c ON c.CaseKey=e.CaseKey
  WHERE c.OrderYear=@year
 ) SELECT CaseKey,EventKey,Kind,Body,AuthorName,Department,CreatedAt,EventNo,EventCount
 FROM RankedEvents WHERE RecentRank<=3 ORDER BY CaseKey,EventKey`,{year:num(scope.year)})]);
 const result=qualityGroups(sources.recordset,scope);
 const analytics=qualityAnalytics(result.groups,incoming.recordset,scope);
 const signals=qualitySignals(sources.recordset,scope);
 result.signalCoverage=qualitySignalCoverage(sources.recordset,scope,signals);
 const coverage=qualitySourceCoverage(sources.recordset,scope);
 const all=qualityGroups(sources.recordset,{...scope,from:1,to:53}).groups;
 const previews=new Map();for(const event of recentEvents.recordset){const key=String(event.CaseKey).toLowerCase();if(!previews.has(key))previews.set(key,[]);previews.get(key).push({...event,CaseKey:key,CreatedAt:event.CreatedAt?.toISOString()});}
 return {...result,...analytics,signals,coverage,cases:cases.recordset.map(c=>{const CaseKey=String(c.CaseKey).toLowerCase(),RecentEvents=previews.get(CaseKey)||[];return {...c,CaseKey,RecentEvents,EventCount:Number(RecentEvents[0]?.EventCount||0),DueDate:c.DueDate?.toISOString().slice(0,10)||null,UpdatedAt:c.UpdatedAt?.toISOString(),suspectedRecurrence:c.AppliedWeek!=null&&['OBSERVING','CLOSED'].includes(c.Status)&&all.some(g=>g.prodKey===c.ProdKey&&g.farmName===c.FarmName&&Object.keys(g.weeks).some(w=>Number(w)>=c.AppliedWeek))};}),scope};
}
export async function qualityEvents(caseKey,year){
 if(!uuid.test(caseKey))throw new Error('피드백을 다시 선택하세요.');
 const scope=qualityScope({year});await ready();
 const [r,images]=await Promise.all([
  query(`SELECT e.* FROM dbo.WebFarmQualityEvent e JOIN dbo.WebFarmQualityCase c ON c.CaseKey=e.CaseKey WHERE c.CaseKey=@key AND c.OrderYear=@year ORDER BY e.EventKey`,{key:uid(caseKey),year:num(scope.year)}),
  query(`SELECT v.EventKey,e.EvidenceKey,e.FileName,e.MimeType,e.ByteSize FROM dbo.WebFarmQualityEvidence e
   JOIN dbo.WebFarmQualityEvent v ON v.EventKey=e.EventKey JOIN dbo.WebFarmQualityCase c ON c.CaseKey=v.CaseKey
   WHERE c.CaseKey=@key AND c.OrderYear=@year AND e.OrderYear=@year ORDER BY v.EventKey,e.CreatedAt,e.EvidenceKey`,{key:uid(caseKey),year:num(scope.year)})
 ]);
 const byEvent=new Map();for(const image of images.recordset){const key=String(image.EventKey);if(!byEvent.has(key))byEvent.set(key,[]);byEvent.get(key).push({...image,EvidenceKey:String(image.EvidenceKey).toLowerCase()});}
 return r.recordset.map((event,index)=>({...event,EventNo:index+1,Evidence:byEvent.get(String(event.EventKey))||[]}));
}
export async function deleteQualityCase(input,user){
 if(!canDeleteFarmQuality(user))throw Object.assign(new Error('피드백 삭제는 nenovaSS3 관리자만 가능합니다.'),{code:'FARM_QUALITY_DELETE_ADMIN_ONLY'});
 const scope=qualityScope(input);
 if(!uuid.test(input.caseKey||''))throw new Error('삭제할 피드백을 다시 선택하세요.');
 const expectedVersion=Number(input.version);
 if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw new Error('최신 피드백 상태를 다시 불러오세요.');
 await ready();
 return withTransaction(async q=>{
  const locked=await q(`SELECT CaseKey,Version,Title FROM dbo.WebFarmQualityCase WITH(UPDLOCK,HOLDLOCK)
   WHERE CaseKey=@key AND OrderYear=@year`,{key:uid(input.caseKey),year:num(scope.year)});
  const current=locked.recordset[0];
  if(!current)throw new Error('피드백을 찾지 못했습니다.');
  if(Number(current.Version)!==expectedVersion)throw Object.assign(new Error('다른 담당자가 내용을 변경했습니다. 새로고침 후 다시 확인하세요.'),{code:'QUALITY_STALE'});
  const events=await q('SELECT EventKey FROM dbo.WebFarmQualityEvent WITH(UPDLOCK,HOLDLOCK) WHERE CaseKey=@key',{key:uid(input.caseKey)});
  for(const event of events.recordset)await q('DELETE FROM dbo.WebFarmQualityEvidence WHERE EventKey=@event',{event:big(event.EventKey)});
  await q('DELETE FROM dbo.WebFarmQualityEvent WHERE CaseKey=@key',{key:uid(input.caseKey)});
  const removed=await q('DELETE FROM dbo.WebFarmQualityCase WHERE CaseKey=@key AND OrderYear=@year AND Version=@version',{key:uid(input.caseKey),year:num(scope.year),version:num(expectedVersion)});
  if(Number(removed.rowsAffected?.[0]||0)!==1)throw Object.assign(new Error('삭제 직전에 내용이 변경되었습니다. 새로고침 후 다시 확인하세요.'),{code:'QUALITY_STALE'});
  console.info('[farm-quality-delete]',JSON.stringify({caseKey:String(input.caseKey).toLowerCase(),orderYear:scope.year,eventCount:events.recordset.length,actorId:user.userId,actorName:user.userName||user.userId}));
  return {deleted:true,caseKey:String(input.caseKey).toLowerCase(),eventCount:events.recordset.length};
 });
}
export async function saveQuality(input,user){
 if(!['create','event'].includes(input.action))throw new Error('작업 종류를 확인하세요.');
 const scope=qualityScope(input);await ready();
 const requestId=input.requestId;if(!uuid.test(requestId||''))throw new Error('저장 요청 번호가 올바르지 않습니다.');
 const evidenceKeys=normalizeEvidenceKeys(input.evidenceKeys);
 const create=input.action==='create';const caseKey=create?crypto.randomUUID():input.caseKey;
 if(!uuid.test(caseKey||''))throw new Error('피드백을 다시 선택하세요.');
 const body=text(input.body,4000),kind=create?'COMMENT':input.kind;
 const eventDate=date(input.eventDate),dueDate=date(input.dueDate,kind==='REQUEST');
 const appliedWeek=kind==='APPLY'?Number(input.appliedWeek):null;
 if(kind==='APPLY'&&(!Number.isInteger(appliedWeek)||appliedWeek<1||appliedWeek>53))throw new Error('개선 적용 대차수를 1~53으로 입력하세요.');
 if(['REQUEST','RESPONSE'].includes(kind)&&!eventDate)throw new Error('요청일 또는 답변 받은 날짜를 입력하세요.');
 if(kind==='REQUEST'&&dueDate<eventDate)throw new Error('답변기한은 요청일 이후로 지정하세요.');
 const hash=crypto.createHash('sha256').update(JSON.stringify({input:{...input,evidenceKeys},userId:user.userId})).digest('hex');
 return withTransaction(async q=>{
  const previous=await q('SELECT CaseKey,PayloadHash FROM dbo.WebFarmQualityEvent WITH(UPDLOCK,HOLDLOCK) WHERE RequestKey=@req',{req:uid(requestId)});
  if(previous.recordset[0]){if(previous.recordset[0].PayloadHash!==hash)throw new Error('같은 저장 요청의 내용이 변경되었습니다.');return {caseKey:String(previous.recordset[0].CaseKey).toLowerCase(),replayed:true};}
  let current;
  if(create){
   const source=await q(sourceSQL+' AND d.DeductionKey=@source',{year:num(scope.year),source:num(Number(input.sourceKey))});
   const valid=qualityGroups(source.recordset,{...scope,from:1,to:53});if(!valid.groups.length)throw new Error('수입부 확인이 완료된 품목·농장만 등록할 수 있습니다.');
   const r=source.recordset[0];const title=text(input.title,200);
   await q(`INSERT dbo.WebFarmQualityCase(CaseKey,OrderYear,SourceKey,ProdKey,FarmName,FarmKey,ProductName,Title,Status,CreatedBy,CreatedByName,CreateRequest)
    VALUES(@key,@year,@source,@prod,@farm,@fk,@product,@title,N'NEW',@author,@name,@req)`,{key:uid(caseKey),year:num(scope.year),source:num(r.DeductionKey),prod:num(r.ProdKey),farm:nv(r.FarmName.trim()),fk:num(r.FarmKey),product:nv(r.ProductName),title:nv(title),author:nv(user.userId),name:nv(user.userName||user.userId),req:uid(requestId)});
   current={Status:'NEW',Version:1};
  }else{
   const r=await q('SELECT * FROM dbo.WebFarmQualityCase WITH(UPDLOCK,HOLDLOCK) WHERE CaseKey=@key AND OrderYear=@year',{key:uid(caseKey),year:num(scope.year)});current=r.recordset[0];
   if(!current)throw new Error('피드백을 찾지 못했습니다.');
   if(kind!=='COMMENT'&&Number(input.version)!==current.Version)throw Object.assign(new Error('다른 담당자가 상태를 변경했습니다. 새로고침 후 다시 확인하세요.'),{code:'QUALITY_STALE'});
  }
  const status=transitionQuality(current.Status,kind,canUseDefectIncoming(user));
  const inserted=await q(`INSERT dbo.WebFarmQualityEvent(CaseKey,RequestKey,PayloadHash,Kind,Body,AuthorId,AuthorName,Department,BeforeStatus,AfterStatus,EventDate,DueDate,AppliedWeek)
    OUTPUT INSERTED.EventKey,INSERTED.Kind,INSERTED.Body,INSERTED.AuthorId,INSERTED.AuthorName,INSERTED.Department,
     INSERTED.BeforeStatus,INSERTED.AfterStatus,INSERTED.EventDate,INSERTED.DueDate,INSERTED.AppliedWeek,INSERTED.CreatedAt
    VALUES(@key,@req,@hash,@kind,@body,@author,@name,@dept,@before,@after,@date,@due,@applied)`,{key:uid(caseKey),req:uid(requestId),hash:nv(hash),kind:nv(kind),body:nv(body),author:nv(user.userId),name:nv(user.userName||user.userId),dept:nv(user.deptName||'부서 미지정'),before:nv(current.Status),after:nv(status),date:nv(eventDate),due:nv(dueDate),applied:num(appliedWeek)});
  const savedEvent=inserted.recordset[0];const eventKey=savedEvent?.EventKey;if(eventKey==null)throw new Error('피드백 이력 번호를 확인하지 못했습니다.');
  for(const evidenceKey of evidenceKeys){
   const evidence=await q(`SELECT EvidenceKey FROM dbo.WebFarmQualityEvidence WITH(UPDLOCK,HOLDLOCK)
    WHERE EvidenceKey=@evidence AND OrderYear=@year AND CreatedBy=@author AND EventKey IS NULL AND ExpiresAt>SYSUTCDATETIME()`,{evidence:uid(evidenceKey),year:num(scope.year),author:nv(user.userId)});
   if(!evidence.recordset[0])throw new Error('증거 이미지가 만료되었거나 다른 기록에 이미 연결되었습니다. 다시 첨부하세요.');
   await q('UPDATE dbo.WebFarmQualityEvidence SET EventKey=@event,ExpiresAt=DATEADD(year,100,SYSUTCDATETIME()) WHERE EvidenceKey=@evidence AND EventKey IS NULL',{event:big(eventKey),evidence:uid(evidenceKey)});
  }
  const updated=await q(`UPDATE dbo.WebFarmQualityCase SET Status=@status,Version=Version+1,UpdatedAt=SYSUTCDATETIME(),
    DueDate=CASE WHEN @kind=N'REQUEST' THEN @due ELSE DueDate END,
    AppliedWeek=CASE WHEN @kind=N'APPLY' THEN @applied WHEN @kind=N'REQUEST' THEN NULL ELSE AppliedWeek END
    OUTPUT INSERTED.Version,INSERTED.Status,INSERTED.DueDate,INSERTED.AppliedWeek,INSERTED.UpdatedAt
    WHERE CaseKey=@key AND OrderYear=@year`,{status:nv(status),kind:nv(kind),due:nv(dueDate),applied:num(appliedWeek),key:uid(caseKey),year:num(scope.year)});
  const savedCase=updated.recordset[0];if(!savedCase)throw new Error('피드백 저장 결과를 확인하지 못했습니다.');
  console.info('[farm-quality-save]',JSON.stringify({action:input.action,caseKey:String(caseKey).toLowerCase(),eventKey:String(eventKey),orderYear:scope.year,kind,actorId:user.userId}));
  return {caseKey:String(caseKey).toLowerCase(),eventKey:String(eventKey),event:{...savedEvent,EventKey:String(eventKey),Evidence:[]},caseVersion:Number(savedCase.Version),caseStatus:savedCase.Status,dueDate:savedCase.DueDate?.toISOString?.().slice(0,10)||savedCase.DueDate||null,appliedWeek:savedCase.AppliedWeek,updatedAt:savedCase.UpdatedAt?.toISOString?.()||savedCase.UpdatedAt};
 });
}
