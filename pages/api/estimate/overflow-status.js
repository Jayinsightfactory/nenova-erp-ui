import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireErpWriteScope } from '../../../lib/erpWriteScope.js';
import { readOverflowResult } from '../../../lib/estimateOverflow.js';

export default withAuth(async function handler(req,res) {
  if (req.method!=='GET') return res.status(405).json({success:false,error:'GET only'});
  try {
    const scope=requireErpWriteScope(req.query,'다음 차수 작업 결과 조회');
    const result=await readOverflowResult(query,sql,{...scope,operationId:req.query.operationId,userId:req.user.userId});
    return res.json({success:true,found:Boolean(result),result});
  } catch(e) { return res.status(e.statusCode||400).json({success:false,code:e.code,error:e.message}); }
});
