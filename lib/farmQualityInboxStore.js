import crypto from 'node:crypto';
import {query,sql,withTransaction} from './db.js';
import {qualityScope,qualitySignals,transitionQuality} from './farmQuality.js';
import {buildQualityInbox,resolveQualityInboxTarget,qualityInboxMutationPolicy,inboxError} from './farmQualityInbox.js';
import {normalizeEvidenceKeys} from './farmQualityEvidence.js';
const nv=value=>({type:sql.NVarChar,value}),num=value=>({type:sql.Int,value}),uid=value=>({type:sql.UniqueIdentifier,value}),big=value=>({type:sql.BigInt,value});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const lower=v=>String(v||'').toLowerCase();
const iso=v=>v?.toISOString?.()||v||null;
const publicEvent=e=>({EventKey:String(e.EventKey),Kind:e.Kind,Body:e.Body,AuthorName:e.AuthorName,Department:e.Department,BeforeStatus:e.BeforeStatus,AfterStatus:e.AfterStatus,EventDate:iso(e.EventDate),DueDate:iso(e.DueDate),AppliedWeek:e.AppliedWeek,CreatedAt:iso(e.CreatedAt),Evidence:[]});
const bounded=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>n)throw inboxError('INBOX_INVALID',`내용을 1~${n}자로 입력하세요.`);return v.trim();};
const date=v=>{if(v==null||v==='')return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw inboxError('INBOX_INVALID','날짜를 확인하세요.');return v;};
async function readyQualityInbox(){
 const result=await query(`SELECT OBJECT_ID(N'dbo.WebFarmQualityInbox',N'U') AS inboxId,
  OBJECT_ID(N'dbo.WebFarmQualityInboxSource',N'U') AS sourceId,
  COL_LENGTH(N'dbo.WebFarmQualityCase',N'InboxKey') AS caseInboxLength`);
 const row=result.recordset[0];
 if(!row?.inboxId||!row?.sourceId||row?.caseInboxLength==null)throw inboxError('INBOX_NOT_READY','농장 피드백 인박스 저장소 설치가 필요합니다. 관리자에게 문의하세요.');
}
export async function lockQualityInboxYear(q,year){
 const r=await q(`DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result LockResult`,{resource:nv(`farm-quality-inbox:${year}`)});
 if(Number(r.recordset[0]?.LockResult)<0||r.recordset[0]?.LockResult==null)throw inboxError('INBOX_STALE','다른 저장이 진행 중입니다. 다시 확인하세요.');
}
async function readState(q,scope,locked=false){
 const hint=locked?' WITH(UPDLOCK,HOLDLOCK)':'',p={year:num(scope.year)};
 const sources=await q(`SELECT d.DeductionKey,d.OrderYear,d.OrderWeek,d.CustKey,d.CustName,d.ProdKey,d.ProdName,d.FarmKey,d.FarmName,d.SourceUnit,d.Quantity,d.OriginalQuantity,d.ImportConfirmed,d.IsDeleted,
 COALESCE(NULLIF(p.DisplayName,N''),p.ProdName,d.ProdName) ProductName FROM dbo.WebSalesDefectDeduction d${hint}
 LEFT JOIN dbo.Product p ON p.ProdKey=d.ProdKey WHERE d.OrderYear=@year AND d.DeductionType=N'불량차감'`,p);
 const inboxes=await q(`SELECT * FROM dbo.WebFarmQualityInbox${hint} WHERE OrderYear=@year`,p);
 const links=await q(`SELECT * FROM dbo.WebFarmQualityInboxSource${hint} WHERE OrderYear=@year`,p);
 const cases=await q(`SELECT * FROM dbo.WebFarmQualityCase${hint} WHERE OrderYear=@year`,p);
 const events=await q(`SELECT e.EventKey,e.CaseKey,e.Kind,e.Body,e.AuthorName,e.Department,e.CreatedAt FROM dbo.WebFarmQualityEvent e JOIN dbo.WebFarmQualityCase c ON c.CaseKey=e.CaseKey WHERE c.OrderYear=@year ORDER BY e.EventKey`,p);
 const rows=cases.recordset.map(c=>{const history=events.recordset.filter(e=>lower(e.CaseKey)===lower(c.CaseKey));return {...c,EventCount:history.length,RecentEvents:history.slice(-3).map((e,i)=>({...e,EventNo:history.length-Math.min(3,history.length)+i+1,CreatedAt:iso(e.CreatedAt)}))};});
 return {scope,sources:sources.recordset,inboxes:inboxes.recordset,links:links.recordset,cases:rows,signals:qualitySignals(sources.recordset,{...scope,from:1,to:53})};
}
export async function loadQualityInbox(input){const scope=qualityScope(input);await readyQualityInbox();return buildQualityInbox(await readState(query,scope));}
export async function saveQualityInboxEvent(input,user){return mutate(input,user,'event');}
export async function setQualityInboxExclusion(input,user){return mutate(input,user,input.action);}
async function mutate(input,user,action){
 const scope=qualityScope(input),requestId=lower(input.requestId);
 if(!uuid.test(requestId))throw inboxError('INBOX_INVALID','저장 요청 번호를 확인하세요.');
 const policy=qualityInboxMutationPolicy({action,user,reason:input.reason,kind:input.kind});
 const evidenceKeys=normalizeEvidenceKeys(input.evidenceKeys);
 if(action!=='event'&&evidenceKeys.length)throw inboxError('INBOX_INVALID','제외·복원에는 이미지를 첨부할 수 없습니다.');
 const kind=policy.kind,body=action==='event'?bounded(input.body,4000):policy.reason;
 const eventDate=date(input.eventDate),dueDate=date(input.dueDate),appliedWeek=kind==='APPLY'?Number(input.appliedWeek):null;
 if(['REQUEST','RESPONSE'].includes(kind)&&!eventDate)throw inboxError('INBOX_INVALID','요청일 또는 답변일을 입력하세요.');
 if(kind==='REQUEST'&&(!dueDate||dueDate<eventDate))throw inboxError('INBOX_INVALID','답변기한을 요청일 이후로 지정하세요.');
 if(kind==='APPLY'&&(!Number.isInteger(appliedWeek)||appliedWeek<1||appliedWeek>53))throw inboxError('INBOX_INVALID','적용 차수를 확인하세요.');
 const hash=crypto.createHash('sha256').update(JSON.stringify({input,action,userId:user.userId,evidenceKeys})).digest('hex');
 await readyQualityInbox();
 return withTransaction(async q=>{
  // The year lock also serializes first materializations with different UUIDs.
  await lockQualityInboxYear(q,scope.year);
  const previous=await q('SELECT e.*,c.OrderYear FROM dbo.WebFarmQualityEvent e WITH(UPDLOCK,HOLDLOCK) JOIN dbo.WebFarmQualityCase c ON c.CaseKey=e.CaseKey WHERE e.RequestKey=@req',{req:uid(requestId)});
  if(previous.recordset[0]){
   const e=previous.recordset[0];if(e.PayloadHash!==hash||Number(e.OrderYear)!==scope.year)throw inboxError('INBOX_INVALID','같은 저장 요청의 내용이 변경되었습니다.');
   const state=await readState(q,scope,true),inbox=buildQualityInbox(state).items.find(i=>i.caseKeys.includes(lower(e.CaseKey)));
   const c=state.cases.find(c=>lower(c.CaseKey)===lower(e.CaseKey));
   return {replayed:true,inbox,caseKey:lower(e.CaseKey),caseVersion:Number(c?.Version),eventKey:String(e.EventKey),event:{EventKey:String(e.EventKey),Kind:e.Kind,Body:e.Body,CreatedAt:iso(e.CreatedAt)}};
  }
  const state=await readState(q,scope,true),resolved=resolveQualityInboxTarget({...state,target:input.target});
  const {component}=resolved;let current=resolved.targetCase;
  qualityInboxMutationPolicy({action,user,item:component,reason:input.reason,kind});
  if(current&&Number(input.caseVersion)!==Number(current.Version))throw inboxError('INBOX_STALE','이력 버전이 변경되었습니다.',{inbox:component});
  if(action!=='event'&&component.inboxKeys.length>1&&!input.target?.inboxKey)throw inboxError('INBOX_TARGET_REQUIRED','제외·복원할 인박스 범위를 선택하세요.',{inbox:component});
  let inboxKey=lower(current?.InboxKey)||lower(input.target?.inboxKey)||component.inboxKeys[0];
  if(inboxKey){
   const old=state.inboxes.find(r=>lower(r.InboxKey)===inboxKey);
   if(!old||Number(input.inboxVersion)!==Number(old.Version))throw inboxError('INBOX_STALE','인박스 버전이 변경되었습니다.',{inbox:component});
  }else{
   inboxKey=crypto.randomUUID();
   await q(`INSERT dbo.WebFarmQualityInbox(InboxKey,OrderYear,CreatedBy) VALUES(@inbox,@year,@actor)`,{inbox:uid(inboxKey),year:num(scope.year),actor:nv(user.userId)});
  }
  if(!current){
   const anchor=state.sources.find(r=>Number(r.DeductionKey)===Math.min(...component.sourceKeys));
   if(!anchor||Number(anchor.OrderYear)!==scope.year)throw inboxError('INBOX_NOT_FOUND','같은 연도의 원본을 확인할 수 없습니다.');
   const caseKey=crypto.randomUUID();
   const title=String(anchor.ProductName||anchor.ProdName||'불량 원본').slice(0,180)+' 피드백';
   await q(`INSERT dbo.WebFarmQualityCase(CaseKey,OrderYear,SourceKey,ProdKey,FarmName,FarmKey,ProductName,Title,Status,CreatedBy,CreatedByName,CreateRequest,InboxKey)
    VALUES(@key,@year,@source,@prod,@farm,@fk,@product,@title,N'NEW',@actor,@name,@req,@inbox)`,{key:uid(caseKey),year:num(scope.year),source:num(anchor.DeductionKey),prod:num(anchor.ProdKey),farm:nv(String(anchor.FarmName||'').trim()),fk:num(String(anchor.FarmName||'').trim()?anchor.FarmKey:null),product:nv(anchor.ProductName||anchor.ProdName||String(anchor.ProdKey)),title:nv(title),actor:nv(user.userId),name:nv(user.userName||user.userId),req:uid(requestId),inbox:uid(inboxKey)});
   current={CaseKey:caseKey,Status:'NEW',Version:1,InboxKey:inboxKey};
  }else if(!current.InboxKey){
   await q('UPDATE dbo.WebFarmQualityCase SET InboxKey=@inbox WHERE CaseKey=@key AND OrderYear=@year AND InboxKey IS NULL',{inbox:uid(inboxKey),key:uid(current.CaseKey),year:num(scope.year)});
  }
  const status=action==='event'?transitionQuality(current.Status,kind,policy.manage):current.Status;
  const inserted=await q(`INSERT dbo.WebFarmQualityEvent(CaseKey,RequestKey,PayloadHash,Kind,Body,AuthorId,AuthorName,Department,BeforeStatus,AfterStatus,EventDate,DueDate,AppliedWeek)
   OUTPUT INSERTED.* VALUES(@key,@req,@hash,@kind,@body,@actor,@name,@dept,@before,@after,@date,@due,@applied)`,{key:uid(current.CaseKey),req:uid(requestId),hash:nv(hash),kind:nv(kind),body:nv(body),actor:nv(user.userId),name:nv(user.userName||user.userId),dept:nv(user.deptName||'부서 미지정'),before:nv(current.Status),after:nv(status),date:nv(eventDate),due:nv(dueDate),applied:num(appliedWeek)});
  const event=inserted.recordset[0];if(!event?.EventKey)throw inboxError('INBOX_INVALID','저장된 이력을 확인하지 못했습니다.');
  // Membership is acknowledged only here, after rebuilding the reviewed set.
  for(const sourceKey of resolved.newSourceKeys){
   const row=state.sources.find(r=>Number(r.DeductionKey)===sourceKey&&Number(r.OrderYear)===scope.year);
   if(!row)throw inboxError('INBOX_STALE','원본 범위가 변경되었습니다.');
  }
  for(let offset=0;offset<resolved.newSourceKeys.length;offset+=200){
   const chunk=resolved.newSourceKeys.slice(offset,offset+200),params={year:num(scope.year),inbox:uid(inboxKey),event:big(event.EventKey)};
   chunk.forEach((key,i)=>{params[`source${i}`]=num(key);});
   await q(`INSERT dbo.WebFarmQualityInboxSource(OrderYear,SourceKey,InboxKey,LinkedEventKey) VALUES ${chunk.map((_,i)=>`(@year,@source${i},@inbox,@event)`).join(',')}`,params);
  }
  for(const evidenceKey of evidenceKeys){
   const e=await q('SELECT EvidenceKey FROM dbo.WebFarmQualityEvidence WITH(UPDLOCK,HOLDLOCK) WHERE EvidenceKey=@evidence AND OrderYear=@year AND CreatedBy=@actor AND EventKey IS NULL AND ExpiresAt>SYSUTCDATETIME()',{evidence:uid(evidenceKey),year:num(scope.year),actor:nv(user.userId)});
   if(!e.recordset[0])throw inboxError('INBOX_INVALID','증거 이미지가 만료되었거나 다른 기록에 연결되었습니다.');
   await q('UPDATE dbo.WebFarmQualityEvidence SET EventKey=@event,ExpiresAt=DATEADD(year,100,SYSUTCDATETIME()) WHERE EvidenceKey=@evidence AND EventKey IS NULL',{event:big(event.EventKey),evidence:uid(evidenceKey)});
  }
  await q(`UPDATE dbo.WebFarmQualityCase SET Status=@status,Version=Version+1,UpdatedAt=SYSUTCDATETIME(),
   DueDate=CASE WHEN @kind=N'REQUEST' THEN @due ELSE DueDate END,
   AppliedWeek=CASE WHEN @kind=N'APPLY' THEN @applied WHEN @kind=N'REQUEST' THEN NULL ELSE AppliedWeek END
   WHERE CaseKey=@key AND OrderYear=@year`,{status:nv(status),kind:nv(kind),due:nv(dueDate),applied:num(appliedWeek),key:uid(current.CaseKey),year:num(scope.year)});
  if(action==='event')await q('UPDATE dbo.WebFarmQualityInbox SET Excluded=CASE WHEN @reactivate=1 THEN 0 ELSE Excluded END,Version=Version+1,UpdatedAt=SYSUTCDATETIME() WHERE InboxKey=@inbox AND OrderYear=@year',{reactivate:num(component.newSourceKeys.length>0?1:0),inbox:uid(inboxKey),year:num(scope.year)});
  else await q(`UPDATE dbo.WebFarmQualityInbox SET Excluded=@excluded,ExclusionReason=@reason,ExcludedAt=SYSUTCDATETIME(),ExcludedBy=@actor,Version=Version+1,UpdatedAt=SYSUTCDATETIME() WHERE InboxKey=@inbox AND OrderYear=@year`,{excluded:num(action==='exclude'?1:0),reason:nv(body),actor:nv(user.userId),inbox:uid(inboxKey),year:num(scope.year)});
  const updated=await readState(q,scope,true),inbox=buildQualityInbox(updated).items.find(i=>i.caseKeys.includes(lower(current.CaseKey)));
  const savedCase=updated.cases.find(c=>lower(c.CaseKey)===lower(current.CaseKey));
  return {inbox,caseKey:lower(current.CaseKey),caseVersion:Number(savedCase.Version),caseStatus:savedCase.Status,inboxKey,inboxVersion:Number(updated.inboxes.find(r=>lower(r.InboxKey)===inboxKey).Version),eventKey:String(event.EventKey),event:publicEvent(event)};
 });
}
