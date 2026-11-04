import { withAuth } from '../../../lib/auth';
import { query,withTransaction,sql } from '../../../lib/db';
import { canManageInvoiceReceipt } from '../../../lib/invoiceReceiptAccess';
import { readWarehouseCorrection,prepareWarehouseCorrection,commitWarehouseCorrection } from '../../../lib/warehouseCorrection';

export const config={api:{bodyParser:{sizeLimit:'2mb'}}};
export default withAuth(async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!canManageInvoiceReceipt(req.user))return res.status(403).json({success:false,error:'입고 수정은 관리자 또는 수입부 계정만 가능합니다.'});
  try{
    if(req.method==='GET')return res.json({success:true,draftOwner:req.user.userId,...await readWarehouseCorrection({...req.query,queryFn:query,types:sql})});
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).end();}
    if(req.body?.action==='preview'){
      const preview=await prepareWarehouseCorrection({queryFn:query,types:sql,input:req.body});
      const {canCommit,baselineDigest,issues,plan,receipt}=preview;
      return res.json({success:true,canCommit,baselineDigest,issues,changes:plan.changes,before:plan.before,after:plan.after,
        farmBefore:receipt.header.FarmName,farmAfter:preview.request.farmName,detailsChanged:plan.detailsChanged});
    }
    if(req.body?.action==='commit')return res.json({success:true,...await commitWarehouseCorrection({withTransactionFn:withTransaction,types:sql,input:req.body,actor:req.user.userId})});
    return res.status(400).json({success:false,error:'미리보기 또는 저장 동작을 선택하세요.'});
  }catch(error){
    const safe=error.code?.startsWith('CORRECTION_')||error.statusCode;
    return res.status(error.statusCode||409).json({success:false,code:safe?error.code:'CORRECTION_SAVE_FAILED',error:safe?error.message:'입고 처리에 실패했습니다. 수정 이력을 확인한 후 같은 작업으로 다시 시도하세요.'});
  }
});
