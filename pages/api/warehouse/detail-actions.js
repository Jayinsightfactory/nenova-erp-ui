import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';
import { approvalPermissions } from '../../../lib/incomingApprovalPolicy.js';
import { canManageInvoiceReceipt } from '../../../lib/invoiceReceiptAccess.js';
import { changeWarehouseRoundLabel, readWarehouseDetailActions } from '../../../lib/warehouseDetailActions.js';

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const canEdit=canManageInvoiceReceipt(req.user);
  try {
    if(req.method==='GET'){
      if(!canEdit&&!approvalPermissions(req.user).review)
        return res.status(403).json({success:false,error:'입고 이력은 수입부 또는 영업지원 계정에서 확인할 수 있습니다.'});
      return res.json({success:true,canEdit,history:await readWarehouseDetailActions(query,sql,req.query)});
    }
    if(req.method!=='POST'){
      res.setHeader('Allow','GET, POST');
      return res.status(405).end();
    }
    if(!canEdit)return res.status(403).json({success:false,error:'차수 표시 변경은 관리자 또는 수입부 계정만 가능합니다.'});
    const updated=await withTransaction(q=>changeWarehouseRoundLabel(q,sql,req.body??{},req.user.userId));
    return res.json({success:true,...updated});
  } catch (error) {
    return res.status(error.statusCode??503).json({success:false,code:error.statusCode?error.code:undefined,
      error:error.statusCode?error.message:'입고 차수 표시 또는 이력을 확인하지 못했습니다.'});
  }
});
