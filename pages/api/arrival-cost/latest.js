import { withAuth } from '../../../lib/auth.js';
import { loadLatestArrivalReferences } from '../../../lib/latestArrivalReference.js';

export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (req.method !== 'GET') return res.status(405).json({success:false,error:'조회만 가능합니다.'});
  const year = String(req.query.orderYear ?? '');
  let items;
  try { items = JSON.parse(req.query.items || '[]'); } catch { return res.status(400).json({success:false,error:'품목 목록 형식을 확인하세요.'}); }
  if (!/^\d{4}$/.test(year) || !Array.isArray(items) || items.length>200 || items.some(item=>!item || !Number.isSafeInteger(item.prodKey) || item.prodKey<=0 || typeof item.unit!=='string' || item.unit.length>40)) {
    return res.status(400).json({success:false,error:'연도와 품목·단위를 확인하세요. 한 번에 최대 200개를 조회할 수 있습니다.'});
  }
  try { return res.json({success:true,references:await loadLatestArrivalReferences({orderYear:year,items})}); }
  catch { return res.status(500).json({success:false,error:'최신 승인 원가를 조회하지 못했습니다. 다시 조회해 주세요. 기존 확정값은 변경되지 않습니다.'}); }
});
