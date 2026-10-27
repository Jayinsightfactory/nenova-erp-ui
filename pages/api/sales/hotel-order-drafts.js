import { withAuth } from '../../../lib/auth';
import store from '../../../lib/hotelOrderDraftStore.cjs';

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };
export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const owner = req.user?.userId;
  try {
    if (req.method === 'GET') {
      const { year, week, id } = req.query;
      if (id) return res.json({ success: true, record: await store.read(owner, year, week, id) });
      return res.json({ success: true, records: await store.list(owner, year, week) });
    }
    if (req.method === 'POST') return res.json({ success: true, record: await store.save(owner, req.body) });
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.statusCode ? e.message : '서버 저장에 실패했습니다. 현재 내용을 유지하고 다시 저장하세요.' });
  }
});
