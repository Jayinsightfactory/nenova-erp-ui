import links from '../../../lib/ecountVerifiedCustomerLinks.cjs';
import crypto from 'crypto';
import { getAutomationToken, checkAutomationAuth } from '../../../lib/automationAuth';
import { ledgerCustomers, saveLedger, saveLedgerFailure, claimNextLedgerRefresh, finishLedgerRefreshRequest } from '../../../lib/ecountCustomerLedgerStore';
import { recentMonth } from '../../../lib/ecountCustomerLedgerPolicy.cjs';
import { isRefreshRequestAllowed } from '../../../lib/ecountLedgerSchedule.cjs';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const token=getAutomationToken(req), expected=process.env.ORBIT_DRIVE_INGEST_TOKEN;
  const drive=!!token && !!expected && Buffer.byteLength(token)===Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected));
  if(!drive && !checkAutomationAuth(req).ok) return res.status(401).json({success:false,error:'UNAUTHORIZED'});
  try {
    if(req.method==='GET'){
      if(req.query?.queue==='refresh')return res.json({success:true,refreshRequest:isRefreshRequestAllowed()?await claimNextLedgerRefresh():null});
      return res.json({success:true,period:recentMonth(),customers:(await ledgerCustomers()).filter(c=>c.linked&&c.canonicalKey===c.custKey).map(links.syncCustomer)});
    }
    if(req.method==='POST'){
      if(req.body?.refreshRequestId!==undefined&&typeof req.body.refreshSuccess==='boolean')return res.json({success:true,...await finishLedgerRefreshRequest(req.body.refreshRequestId,req.body.refreshSuccess)});
      return res.json({success:true,...await (req.body?.failure?saveLedgerFailure(req.body):saveLedger(req.body))});
    }
    return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'});
  } catch(e) {
    const expectedErrors=['INVALID_LEDGER','SOURCE_IDENTITY_MISMATCH','EXPIRED_COLLECTION','INVALID_REFRESH_REQUEST'];
    return res.status(expectedErrors.includes(e.message)?422:503).json({success:false,error:expectedErrors.includes(e.message)?e.message:'SYNC_UNAVAILABLE'});
  }
}
export const config={api:{bodyParser:{sizeLimit:'4mb'}}};
