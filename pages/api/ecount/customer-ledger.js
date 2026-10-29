import { withAuth } from '../../../lib/auth';
import { ledgerCustomers, readLedger, readLedgerRefreshRequest } from '../../../lib/ecountCustomerLedgerStore';
import { canReadCustomer, isLedgerAdmin, recentMonth } from '../../../lib/ecountCustomerLedgerPolicy.cjs';
import { freshness } from '../../../lib/ecountLedgerSchedule.cjs';

export async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET') return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'});
  try {
    if (!req.user?.userId) return res.status(401).json({success:false,error:'LOGIN_REQUIRED'});
    // A fresh DB lookup on every request excludes inactive accounts. SS3 can browse all active customers.
    const admin = isLedgerAdmin(req.user);
    const visible = await ledgerCustomers(req.user.userId, admin);
    if(req.query.custKey===undefined) return res.json({success:true,scope:admin?'all':'assigned',customers:visible.map(c=>({
      custKey:c.custKey,name:c.name,managerName:c.managerName||'담당자 미확인',linked:c.linked,refreshable:!admin||c.managerMatchCount===1,
    })),period:recentMonth(),schedule:freshness(null)});
    const key=String(req.query.custKey);
    if(!/^[1-9]\d*$/.test(key)) return res.status(400).json({success:false,error:'INVALID_CUSTOMER'});
    const customer=visible.find(c=>c.custKey===Number(key));
    if(!customer) return res.status(403).json({success:false,error:'CUSTOMER_FORBIDDEN'});
    if(!canReadCustomer({userId:req.user.userId,accountActive:true},customer)) return res.status(409).json({success:false,error:'CUSTOMER_LINK_REQUIRED'});
    return res.json({success:true,...await readLedger(customer),refreshRequest:await readLedgerRefreshRequest(customer.custKey)});
  } catch {return res.status(503).json({success:false,error:'LEDGER_UNAVAILABLE'});}
}
export default withAuth(handler);
