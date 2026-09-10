import { withAuth } from '../../../lib/auth';
import { listAudits, getAudit } from '../../../lib/distributionAuditStore';

export default withAuth(async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'저장된 비교 결과는 조회만 가능합니다.'});
 try{
  const {year,week,id}=req.query||{};
  if(id!==undefined)return res.json({audit:await getAudit({year,week,id})});
  return res.json({items:await listAudits({year,week})});
 }catch(e){
  const status=e.statusCode||500;
  return res.status(status).json({error:status>=500?'이전 비교 결과를 읽지 못했습니다. 기존 작업은 계속할 수 있습니다.':e.message});
 }
});
