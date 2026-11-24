import { withAuth } from '../../../lib/auth';
import { query, sql, withTransaction } from '../../../lib/db';
import { canManageInvoiceReceipt } from '../../../lib/invoiceReceiptAccess.js';
import { inspectWarehouseIdentity, updateWarehouseIdentity } from '../../../lib/warehouseInlineIdentity.js';

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!['GET','PATCH'].includes(req.method)) {
    res.setHeader('Allow','GET, PATCH');
    return res.status(405).end();
  }
  if (!canManageInvoiceReceipt(req.user)) {
    return res.status(403).json({success:false,error:'입고 원장 수정은 관리자 또는 수입부 계정만 가능합니다.'});
  }
  try {
    if(req.method==='GET'){
      const {header,issues}=await inspectWarehouseIdentity(query,sql,req.query);
      return res.status(200).json({success:true,header,issues});
    }
    const result=await withTransaction(transaction=>updateWarehouseIdentity(transaction,sql,req.body??{},String(req.user.userId)));
    if(result.issues?.length) return res.status(409).json({success:false,issues:result.issues,error:result.issues[0].message});
    return res.status(200).json({success:true,...result});
  } catch(error) {
    const status=error.status || (error.number===1205||error.number===1222?409:503);
    return res.status(status).json({success:false,code:error.code,
      error:error.status?error.message:status===409?'다른 작업이 번호를 수정 중입니다. 다시 조회하세요.':'입고 번호를 확인하거나 저장하지 못했습니다.'});
  }
});
