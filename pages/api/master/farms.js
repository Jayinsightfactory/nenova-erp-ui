import {withAuth} from '../../../lib/auth';
import {withTransaction,sql} from '../../../lib/db';
import {canManageInvoiceReceipt} from '../../../lib/invoiceReceiptAccess';
import {farmRegistrationInput,registerFarmMaster} from '../../../lib/farmMasterRegistration.js';
export function createFarmRegistrationHandler({transaction=withTransaction,types=sql}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'POST만 허용됩니다.'});}
  if(!canManageInvoiceReceipt(req.user))return res.status(403).json({success:false,error:'농장 등록 권한이 없습니다.'});
  try{
   farmRegistrationInput(req.body);
   const result=await transaction(q=>registerFarmMaster(q,types,req.body,String(req.user.userId??req.user.UserID)));
   return res.status(result.created?201:200).json({success:true,...result});
  }catch(error){return res.status(error.status||503).json({success:false,error:error.status?error.message:'농장 등록에 실패했습니다. 기존 농장을 다시 조회해 등록 여부를 확인하세요. 자동 재요청하지 않습니다.',...(error.status===409&&Array.isArray(error.candidates)?{candidates:error.candidates}:{} )});}
 };
}
export default withAuth(createFarmRegistrationHandler());
