import { withAuth } from '../../../lib/auth.js';
import { loadHotelCustomerMap, saveHotelCustomerMap, loadHotelCustomerShipments } from '../../../lib/pnlHotelCustomerMap.js';
export default withAuth(async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 try {
  if(req.method==='GET' && req.query.reference==='1') return res.json({success:true,...await loadHotelCustomerShipments(req.query.partner,req.query.year,req.query.major)});
  if(req.method==='GET') return res.json({success:true,mapping:await loadHotelCustomerMap(req.query.partner)});
  if(req.method==='POST') return res.json({success:true,mapping:await saveHotelCustomerMap(req.body || {},req.user?.userName || req.user?.userId)});
  res.setHeader('Allow','GET, POST'); return res.status(405).json({success:false,error:'GET 또는 POST만 지원합니다.'});
 } catch(error) { return res.status(error.statusCode || 503).json({success:false,error:error.statusCode ? error.message : '업체 연결을 조회·저장하지 못했습니다. 잠시 후 다시 시도하세요.'}); }
});
