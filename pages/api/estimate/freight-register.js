import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { executeFreight, readFreightReceipt } from '../../../lib/estimateFreightAtomic.js';
import { freightFailureAudit, persistFreightFailure } from '../../../lib/estimateFreightFeedback.js';

export default withAuth(async function handler(req,res) {
  let committing=false;
  try {
    if(req.method==='GET') {
      const result=await readFreightReceipt(query,sql,null,req.user.userId,req.query.operationId);
      return res.json({success:true,found:!!result,result});
    }
    if(req.method!=='POST') return res.status(405).end();
    if(!req.body?.editGuard) throw Object.assign(new Error('운임 등록에는 현재 업체 편집 보호가 필요합니다. 다시 조회해 주세요.'),{statusCode:409,code:'ERP_EDIT_GUARD_REQUIRED'});
    const result=await withTransaction(async tQ=>{
      committing=false;
      const value=await executeFreight(tQ,sql,req.body,req.user);
      committing=true;
      return value;
    });
    return res.json(result);
  } catch(error) {
    // A commit acknowledgement can be lost. Never claim rollback on an unknown
    // transport failure; the client resolves the same operation's receipt.
    const failure=freightFailureAudit(req.body || {},error,committing);
    const auditSaved=req.method==='POST' ? await persistFreightFailure(query,sql,req.user.userId,failure) : false;
    return res.status(error.statusCode||500).json({success:false,code:error.code||'FREIGHT_SAVE_FAILED',error:error.message,
      outcomeUnknown:failure.outcomeUnknown,rolledBack:failure.rolledBack,auditSaved});
  }
});
