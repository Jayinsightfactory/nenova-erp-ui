import {verifyReqUser} from '../../../lib/auth';
import policy from '../../../lib/ecountWorkspacePolicy.cjs';
import {activeAdmin,installed,readWorkspace,saveVersion} from '../../../lib/ecountWorkspaceStore';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)) {res.setHeader('Allow','GET, POST');return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'});}
  const user=await verifyReqUser(req,res);
  if(!user) return res.status(401).json({success:false,error:'LOGIN_REQUIRED'});
  if(!policy.authorized(user)) return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
  // Same-origin browser mutations; no cross-origin credentials or automated scraper token extension.
  if(req.method==='POST' && req.headers.origin) {
    try {if(new URL(req.headers.origin).host!==req.headers.host) return res.status(403).json({success:false,error:'ORIGIN_REJECTED'});} catch {return res.status(403).json({success:false,error:'ORIGIN_REJECTED'});}
  }
  try {
    if(!await activeAdmin(user)) return res.status(403).json({success:false,error:'ACCOUNT_INACTIVE'});
    if(!await installed()) return res.status(503).json({success:false,error:'WORKSPACE_NOT_INSTALLED'});
    const result=req.method==='GET'?await readWorkspace(req.query):await saveVersion(req.body||{},user);
    return res.status(200).json(result);
  } catch(error) {
    // Never echo SQL errors, payloads, names, credentials, or original ECOUNT rows.
    const code=error.status && /^[A-Z_]+$/.test(error.message)?error.message:'WORKSPACE_UNAVAILABLE';
    return res.status(error.status||500).json({success:false,error:code});
  }
}
export const config={api:{bodyParser:{sizeLimit:'8mb'}}};
