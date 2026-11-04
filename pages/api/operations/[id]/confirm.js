import {withAuth} from '../../../../lib/auth';
import {confirmOperation} from '../../../../lib/operationLedger';
export const config={api:{bodyParser:{sizeLimit:'2kb'}}};
export default withAuth(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false});}
  if(req.headers.origin&&new URL(req.headers.origin).host!==(req.headers['x-forwarded-host']||req.headers.host))return res.status(403).json({success:false,code:'CROSS_ORIGIN'});
  try{return res.status(200).json({success:true,operation:await confirmOperation(req.user,req.query.id,req.body||{})});}
  catch(error){return res.status(error.statusCode||503).json({success:false,code:error.code||'CONFIRM_FAILED',error:error.statusCode?error.message:'작업 결과를 확인하지 못했습니다.'});}
});
