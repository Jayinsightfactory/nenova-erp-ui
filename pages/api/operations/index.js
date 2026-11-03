import {withAuth} from '../../../lib/auth';
import {listOperations} from '../../../lib/operationLedger';
export default withAuth(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({success:false});}
  try{return res.status(200).json({success:true,...await listOperations(req.user,req.query)});}
  catch(error){return res.status(error.statusCode||503).json({success:false,code:error.code||'LIST_FAILED',error:error.statusCode?error.message:'작업 기록을 불러오지 못했습니다.'});}
});
