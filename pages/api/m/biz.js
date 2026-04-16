// pages/api/m/biz.js — 비즈니스 스냅샷 조회/새로고침
import { withAuth } from '../../../lib/auth';
import { getBizContext } from '../../../lib/chat/bizContext';

async function handler(req, res) {
  try {
    const force = req.method === 'POST' || req.query.refresh === '1';
    const biz = await getBizContext({ force });
    return res.status(200).json({ success: true, ...biz });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
