import {withAuth} from '../../../lib/auth';
import {withTransaction,sql} from '../../../lib/db';
import {validateProductChanges} from '../../../lib/productBulkEdit';
import {saveProductBulk} from '../../../lib/productBulkSave';

export default withAuth(async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'POST만 지원합니다.'});}
  let changes;
  try{changes=validateProductChanges(req.body?.changes);}catch(e){return res.status(400).json({success:false,error:e.message});}
  try{
    const saved=await withTransaction(q=>saveProductBulk(q,sql,changes,req.user.userId));
    if(global._prodCache)global._prodCache.data=null;
    return res.status(200).json({success:true,saved,verifiedCount:saved.length});
  }catch(e){
    return res.status(e.status||500).json({success:false,error:e.status===409?e.message:'저장을 완료하지 못했습니다. 입력값을 보관한 채 다시 조회하여 저장 상태를 확인하세요.',rolledBack:e.transactionRolledBack===true});
  }
});
