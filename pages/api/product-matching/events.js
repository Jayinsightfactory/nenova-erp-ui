import { withAuth } from '../../../lib/auth';
import { loadProductMatchingMetrics, recordProductMatchEvent } from '../../../lib/productMatchingLearningStore.js';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'POST') return res.status(201).json({ success: true, ...(await recordProductMatchEvent(req.body || {}, req.user || {})) });
    if (req.method === 'GET') return res.status(200).json({ success: true, metrics: await loadProductMatchingMetrics({ days: req.query.days, minGroupSize: req.query.minGroupSize, tenantKey: req.user?.tenantKey || 'nenova' }) });
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'GET/POST만 지원합니다.' });
  } catch (error) { return res.status(400).json({ success: false, error: error.message || '품목 매칭 학습 이벤트 처리 실패' }); }
});
