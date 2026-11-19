import {estimateChangeHistory} from '../../../lib/estimateChangeHistory';
import { readEstimateLedgerReview } from '../../../lib/estimateLedgerReview.js';
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { readEstimateLedgerAlerts } from '../../../lib/estimateLedgerAlerts.js';

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({success:false,error:'조회만 가능합니다.'});
  try {
    const data=req.query?.deductionKey!==undefined?await readEstimateLedgerReview(query,sql,req.query||{},{readDownloads:estimateChangeHistory.calendar}):await readEstimateLedgerAlerts(query,sql,req.query||{});
    return res.status(200).json({success:true,...data});
  } catch(error) {
    return res.status([400,404].includes(error.statusCode)?error.statusCode:500).json({success:false,error:[400,404].includes(error.statusCode)?error.message:'원장 연결 알림을 확인하지 못했습니다. 다시 확인해 주세요.'});
  }
});
