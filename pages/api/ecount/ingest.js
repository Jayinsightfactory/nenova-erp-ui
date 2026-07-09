// POST /api/ecount/ingest — ECOUNT 스크래핑 결과 적재(+검증). 스크래퍼(Chrome/Playwright)가 호출.
// body: { dataset, rows[], screenTotal?, screenRowCnt?, periodFrom, periodTo, source?, note? }
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { ingestEcount, DATASETS } from '../../../lib/ecountIngest';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { dataset, rows, screenTotal, screenRowCnt, periodFrom, periodTo, source, note } = req.body || {};
  if (!DATASETS[dataset]) return res.status(400).json({ success: false, error: `dataset 필요: ${Object.keys(DATASETS).join('/')}` });
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, error: 'rows 배열 필요' });
  try {
    const actor = req.user?.userName || req.user?.userId || 'scraper';
    const r = await ingestEcount({ dataset, rows, screenTotal, screenRowCnt, periodFrom, periodTo, actor, source: source || 'chrome', note });
    return res.status(200).json({ success: true, ...r });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
export default withAuth(withActionLog(handler, { actionType: 'ECOUNT_INGEST', affectedTable: 'WebEcountSnapshot/WebEcountRow', riskLevel: 'LOW' }));
