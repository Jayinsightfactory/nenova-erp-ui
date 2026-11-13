import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { readEstimateLedgerAlerts } from '../../../lib/estimateLedgerAlerts.js';

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({success:false,error:'조회만 가능합니다.'});
  try {
    return res.status(200).json({success:true,...await readEstimateLedgerAlerts(query,sql,req.query || {})});
  } catch(error) {
    return res.status(error.statusCode===400?400:500).json({success:false,error:error.statusCode===400?error.message:'원장 연결 알림을 확인하지 못했습니다. 다시 확인해 주세요.'});
  }
});
