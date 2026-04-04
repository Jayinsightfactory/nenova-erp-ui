// pages/api/ecount/raw-test.js
// 이카운트 API 응답 구조 디버깅용 (개발 전용)
import { withAuth } from '../../../lib/auth';
import { ecountPost } from '../../../lib/ecount';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { endpoint, body } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint 필요' });

  try {
    const result = await ecountPost(endpoint, body || {});
    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
});
