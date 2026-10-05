import { withAuth } from '../../../lib/auth';
import { savePnlHotelProductMatch } from '../../../lib/pnlHotelProductMatch.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
  try {
    const actor = req.user?.userName || req.user?.userId || 'user';
    const result = await savePnlHotelProductMatch({ ...(req.body || {}), actor });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ success: false, error: error.message, code: error.code || 'INTERNAL_ERROR' });
  }
});
