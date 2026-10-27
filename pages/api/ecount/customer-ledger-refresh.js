import { withAuth } from '../../../lib/auth';
import { ledgerCustomers, readLedgerRefreshRequest, requestLedgerRefresh } from '../../../lib/ecountCustomerLedgerStore';

async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(!req.user?.userId)return res.status(401).json({success:false,error:'LOGIN_REQUIRED'});
  if(!['GET','POST'].includes(req.method))return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'});
  const raw=req.method==='POST'?req.body?.custKey:req.query.custKey;
  const key=String(raw??'');
  if(!/^[1-9]\d*$/.test(key)||!Number.isSafeInteger(Number(key)))return res.status(400).json({success:false,error:'INVALID_CUSTOMER'});
  try{
    const customer=(await ledgerCustomers(req.user.userId)).find(c=>c.custKey===Number(key));
    if(!customer)return res.status(403).json({success:false,error:'CUSTOMER_FORBIDDEN'});
    if(!customer.linked)return res.status(409).json({success:false,error:'CUSTOMER_LINK_REQUIRED'});
    if(req.method==='GET')return res.json({success:true,request:await readLedgerRefreshRequest(customer.custKey)});
    return res.json({success:true,request:await requestLedgerRefresh(req.user.userId,customer.custKey)});
  }catch(e){
    const status={REQUEST_WINDOW_CLOSED:409,REQUEST_RATE_LIMIT:429,CUSTOMER_LINK_REQUIRED:409,CUSTOMER_FORBIDDEN:403}[e.message];
    return res.status(status||503).json({success:false,error:status?e.message:'REFRESH_REQUEST_UNAVAILABLE'});
  }
}
export default withAuth(handler);
