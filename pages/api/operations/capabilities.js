import {withAuth} from '../../../lib/auth';
import {operationCapabilities} from '../../../lib/operationLedger';
export default withAuth((req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({success:false});}
  return res.status(200).json({success:true,capabilities:operationCapabilities(req.user)});
});
