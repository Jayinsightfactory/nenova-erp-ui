import {withAuth} from '../../../lib/auth';
import {query,withTransaction,sql} from '../../../lib/db';
import drafts from '../../../lib/ecountInputDrafts.cjs';

// ECOUNT 입력 화면 7종 InputDraft API. 웹 전용 ecount_work.InputDraft* 3개 테이블만 읽고 쓴다.
// ECOUNT 원본·ERP 공유 원장은 읽기/쓰기 모두 하지 않으며 DDL 도 실행하지 않는다(마이그레이션은 SSMS 명시 실행).
const MIGRATION='docs/migrations/2026-10-21_ecount_work_input_drafts.sql';
const v=(type,value)=>({type,value});
const UUID_RE=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const err=(code,status=400,detail)=>{const e=new Error(code);e.status=status;if(detail)e.detail=detail;return e;};

async function installed() {
  const r=await query("SELECT CASE WHEN OBJECT_ID(N'ecount_work.InputDraftHead',N'U') IS NOT NULL AND OBJECT_ID(N'ecount_work.InputDraftLine',N'U') IS NOT NULL AND OBJECT_ID(N'ecount_work.InputDraftAudit',N'U') IS NOT NULL THEN 1 ELSE 0 END AS ready");
  return r.recordset[0]?.ready===1;
}
const iso=d=>d instanceof Date?d.toISOString():String(d);
function toDraft(head,lines) {
  return {draftId:String(head.DraftId).toLowerCase(),program:String(head.Program).trim(),status:head.Status,revision:head.Revision,createdBy:head.CreatedBy,createdAt:iso(head.CreatedAt),updatedAt:iso(head.UpdatedAt),cancelledReason:head.CancelledReason||null,
    head:JSON.parse(head.FieldsJson),lines:lines.map(l=>({lineNo:l.LineNo,...JSON.parse(l.FieldsJson)})),contentHash:null,audit:[]};
}
async function loadDraft(q,draftId,lock) {
  if(!UUID_RE.test(String(draftId||''))) throw err('INVALID_DRAFT_ID');
  const id={draftId:v(sql.UniqueIdentifier,draftId)};
  const head=(await q(`SELECT DraftId,Program,Status,Revision,FieldsJson,CreatedBy,CreatedAt,UpdatedAt,CancelledReason FROM ecount_work.InputDraftHead ${lock?'WITH (UPDLOCK, HOLDLOCK)':''} WHERE DraftId=@draftId`,id)).recordset[0];
  if(!head) throw err('DRAFT_NOT_FOUND',404);
  const lines=(await q('SELECT LineNo,FieldsJson FROM ecount_work.InputDraftLine WHERE DraftId=@draftId AND Revision=@revision ORDER BY LineNo',{...id,revision:v(sql.Int,head.Revision)})).recordset;
  return toDraft(head,lines);
}
// 계획(buildSavePlan)의 statements 를 고정 SQL + 매개변수 바인딩으로만 실행한다.
async function execPlan(q,plan,reason) {
  for(const s of plan.statements) {
    const r=s.row,id=v(sql.UniqueIdentifier,plan.draftId);
    if(s.op==='INSERT'&&s.table===drafts.TABLES.head) {
      await q('INSERT INTO ecount_work.InputDraftHead (DraftId,Program,Status,Revision,FieldsJson,LineCount,CreatedBy,CreatedAt,UpdatedAt,CancelledReason) VALUES (@draftId,@program,@status,@revision,@fields,@lineCount,@createdBy,@createdAt,@updatedAt,@cancelled)',
        {draftId:id,program:v(sql.Char(7),r.Program),status:v(sql.VarChar(10),r.Status),revision:v(sql.Int,r.Revision),fields:v(sql.NVarChar(sql.MAX),r.FieldsJson),lineCount:v(sql.Int,r.LineCount),createdBy:v(sql.Char(64),r.CreatedBy),createdAt:v(sql.DateTime2,new Date(r.CreatedAt)),updatedAt:v(sql.DateTime2,new Date(r.UpdatedAt)),cancelled:v(sql.NVarChar(200),r.CancelledReason)});
    } else if(s.op==='INSERT'&&s.table===drafts.TABLES.line) {
      await q('INSERT INTO ecount_work.InputDraftLine (DraftId,Revision,LineNo,FieldsJson) VALUES (@draftId,@revision,@lineNo,@fields)',
        {draftId:id,revision:v(sql.Int,r.Revision),lineNo:v(sql.Int,r.LineNo),fields:v(sql.NVarChar(sql.MAX),r.FieldsJson)});
    } else if(s.op==='UPDATE'&&s.table===drafts.TABLES.head) {
      const res=await q('UPDATE ecount_work.InputDraftHead SET Status=@status,Revision=@revision,FieldsJson=@fields,LineCount=@lineCount,UpdatedAt=@updatedAt,CancelledReason=@cancelled WHERE DraftId=@draftId AND Revision=@prevRevision',
        {draftId:id,prevRevision:v(sql.Int,s.where.Revision),status:v(sql.VarChar(10),s.set.Status),revision:v(sql.Int,s.set.Revision),fields:v(sql.NVarChar(sql.MAX),s.set.FieldsJson),lineCount:v(sql.Int,s.set.LineCount),updatedAt:v(sql.DateTime2,new Date(s.set.UpdatedAt)),cancelled:v(sql.NVarChar(200),s.set.CancelledReason)});
      if(!res||!res.rowsAffected||res.rowsAffected[0]!==1) throw err('REVISION_CONFLICT',409);
    } else if(s.op==='INSERT'&&s.table===drafts.TABLES.audit) {
      let diff=r.DiffJson;
      if(reason) diff=JSON.stringify({...JSON.parse(diff),reason});
      await q('INSERT INTO ecount_work.InputDraftAudit (DraftId,Revision,Action,Actor,At,DiffJson) VALUES (@draftId,@revision,@action,@actor,@at,@diff)',
        {draftId:id,revision:v(sql.Int,r.Revision),action:v(sql.VarChar(10),r.Action),actor:v(sql.Char(64),r.Actor),at:v(sql.DateTime2,new Date(r.At)),diff:v(sql.NVarChar(sql.MAX),diff)});
    } else throw err('WRITE_OUTSIDE_ALLOWLIST',500);
  }
}
const reasonOf=raw=>{
  if(raw===undefined||raw===null||raw==='') return null;
  if(typeof raw!=='string'||raw.trim().length>200) throw err('REASON_TOO_LONG',400,{message:'사유는 200자를 넘을 수 없습니다'});
  return drafts.maskFreeText(raw.trim());
};
const expectedOf=raw=>{const n=Number(raw);if(!Number.isInteger(n)||n<1) throw err('EXPECTED_REVISION_REQUIRED',400);return n;};

async function handle(req,res) {
  res.setHeader('Cache-Control','no-store');
  const m=req.method;
  if(!['GET','POST','PATCH'].includes(m)) {res.setHeader('Allow','GET, POST, PATCH');return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'});}
  if(m!=='GET'&&req.headers&&req.headers.origin) {
    try {if(new URL(req.headers.origin).host!==req.headers.host) return res.status(403).json({success:false,error:'ORIGIN_REJECTED'});} catch {return res.status(403).json({success:false,error:'ORIGIN_REJECTED'});}
  }
  const actor=(req.user||{}).userId;
  const body=req.body||{};
  const q0=req.query||{};
  try {
    const program=m==='GET'?q0.program:body.program;
    if(m==='GET'&&q0.view==='schema') return res.status(200).json({success:true,schema:drafts.fieldSchema(program)});
    // 입력 검증은 DB 접근 전에 수행(사유 없는 취소·잘못된 본문 → 400)
    let action=null,reason=null,expected=null;
    if(m==='POST') {
      action=body.action||'create';
      if(!['create','review','cancel'].includes(action)) throw err('INVALID_ACTION');
      if(action==='create') {
        if(!drafts.PROGRAMS[program]) throw err('UNKNOWN_PROGRAM');
        const check=drafts.validateDraft(program,{head:body.header,lines:body.lines});
        if(!check.ok) throw err('VALIDATION_FAILED',400,check.errors);
      } else {
        expected=expectedOf(body.expectedRevision);
        if(action==='cancel') {
          if(typeof body.reason!=='string'||body.reason.trim()==='') throw err('CANCEL_REASON_REQUIRED',400,{message:'취소 사유는 필수입니다'});
          reason=reasonOf(body.reason);
        }
      }
    } else if(m==='PATCH') {
      expected=expectedOf(body.expectedRevision);
      reason=reasonOf(body.reason);
    }
    if(!await installed()) return res.status(503).json({success:false,code:'MIGRATION_PENDING',error:'MIGRATION_PENDING',migration:MIGRATION});
    const opts={actor};
    if(m==='GET') {
      const me=drafts.actorHash(actor);
      if(q0.draftId) {
        const draft=await withTransaction(q=>loadDraft(q,q0.draftId,false));
        return res.status(200).json({success:true,draft:{...drafts.readDraft(draft),mine:draft.createdBy===me}});
      }
      if(!drafts.PROGRAMS[program]) throw err('UNKNOWN_PROGRAM');
      const rows=(await query('SELECT TOP 50 DraftId,Program,Status,Revision,LineCount,CreatedBy,UpdatedAt FROM ecount_work.InputDraftHead WHERE Program=@program ORDER BY UpdatedAt DESC',{program:v(sql.Char(7),program)})).recordset;
      return res.status(200).json({success:true,program,drafts:rows.map(r=>({draftId:String(r.DraftId).toLowerCase(),program:String(r.Program).trim(),status:r.Status,revision:r.Revision,lineCount:r.LineCount,updatedAt:iso(r.UpdatedAt),mine:r.CreatedBy===me}))});
    }
    const out=await withTransaction(async q=>{
      let draft;
      if(m==='POST'&&action==='create') {
        draft=drafts.createDraft(program,{head:body.header,lines:body.lines},opts);
      } else {
        const cur=await loadDraft(q,body.draftId,true);
        if(m==='PATCH') draft=drafts.applyCorrection(cur,{head:body.header,lines:body.lines},expected,opts);
        else if(action==='review') draft=drafts.review(cur,expected,opts);
        else draft=drafts.cancel(cur,body.reason,expected,opts);
      }
      const plan=drafts.buildSavePlan(draft.program,draft);
      await execPlan(q,plan,m==='PATCH'?reason:null);
      return {draftId:draft.draftId,program:draft.program,status:draft.status,revision:draft.revision,action:plan.action,accountingPosted:false,sourceSaved:false};
    });
    return res.status(m==='POST'&&action==='create'?201:200).json({success:true,...out});
  } catch(e) {
    // SQL 오류·페이로드·원본 행은 응답에 싣지 않는다.
    if(e&&e.status&&/^[A-Z_]+$/.test(e.message)) return res.status(e.status).json({success:false,error:e.message,...(e.detail?{details:e.detail}:{})});
    return res.status(500).json({success:false,error:'INPUT_DRAFT_UNAVAILABLE'});
  }
}
export default withAuth(handle);
