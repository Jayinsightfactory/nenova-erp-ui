import { withAuth } from '../../../lib/auth';
import jobs from '../../../lib/customsSettlementJobs.cjs';
import plans from '../../../lib/customsSettlementPlan.cjs';
import {reviewSettlementRegistration,registerSettlementJob} from '../../../lib/customsSettlementRegistration';

export const config = { api: { bodyParser: { sizeLimit: '36mb' } } };
export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const uid = req.user?.userId;
    if (req.method === 'GET') {
      const job = await jobs.getSettlementJob(uid, req.query.jobId);
      return job ? res.json({ success: true, job, worker:await jobs.workerStatus(),...(job.status==='REVIEW_READY'?{review:await reviewSettlementRegistration(job)}:{}) }) : res.status(404).json({ success: false, error: '작업을 찾지 못했습니다.' });
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'GET 또는 POST만 지원합니다.' });
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site' || origin && ![ `https://${host}`, `http://${host}` ].includes(origin)) return res.status(403).json({ success: false, error: '같은 사이트의 JSON 요청만 허용합니다.' });
    const { action, year, major, jobId, selectedHashes, reviewDigest, confirmed, links={} } = req.body || {};
    if (action === 'upload') return res.json({ success: true, job: await jobs.createSettlementJob(uid, req.body) });
    if (!['preview', 'apply','resume'].includes(action)) return res.status(400).json({ success: false, error: '알 수 없는 작업입니다.' });
    const scope = plans.scopeOf(year, major), job = await jobs.getSettlementJob(uid, jobId);
    if (!job || job.year !== scope.year || job.major !== scope.major || job.status !== 'REVIEW_READY') return res.status(409).json({ success: false, error: '선택 연도·차수의 OCR 검토 완료 작업이 필요합니다.' });
    if(action==='resume'){
      const result=await registerSettlementJob(job,{automatic:true,actor:uid});
      const updated=await jobs.recordRegistration(jobId,{state:result.errors.length?'RETRY':'DONE',registeredDocuments:result.registeredDocuments,errors:result.errors});
      return res.json({success:true,job:updated,result,review:await reviewSettlementRegistration(updated),message:result.errors.length?'자동등록이 일부 보류되었습니다. 연결 상태와 차수별 결과를 확인하세요.':'자동등록 확인 완료. 저장 매출자료는 등록 대상 차수에서 직접 갱신하세요.'});
    }
    if (!Array.isArray(selectedHashes) || !selectedHashes.length || new Set(selectedHashes).size !== selectedHashes.length || selectedHashes.some(h => !job.files.some(f => f.sourceHash === h && f.status === 'READY'))) return res.status(400).json({ success: false, error: '검산된 정산서를 선택하세요.' });
    if(!links||typeof links!=='object'||Array.isArray(links)||Object.keys(links).length>80)return res.status(400).json({success:false,error:'입고 연결 선택을 확인하세요.'});
    if (action === 'preview') return res.json({ success: true, review: await reviewSettlementRegistration(job,{links,selectedHashes}) });
    const result = await registerSettlementJob(job,{links,selectedHashes,reviewDigest,confirmed,actor:uid});
    return res.json({ success: true, result,review:await reviewSettlementRegistration(job), message: result.errors.length?'일부 원천 등록이 보류되었습니다. 차수별 결과를 확인하고 다시 검토하세요.':'실제 정산 원천 등록 완료. 저장된 매출자료는 대상 차수에서 직접 갱신해야 하며 확정본은 그대로 보존됩니다.' });
  } catch (error) {
    return res.status(error.statusCode || 503).json({ success: false, error: error.statusCode ? error.message : '통관 정산 연결에 실패했습니다. 원본은 다시 적용하지 말고 상태를 확인하세요.' });
  }
});
