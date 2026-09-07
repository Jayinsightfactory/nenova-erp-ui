import { withAuth } from '../../../lib/auth';
import { loadShillaBulkMatchGroups, saveShillaBulkMatch } from '../../../lib/shillaPnlBulkMatch.js';

// Keep complete snapshots below the production proxy's 1MB request limit.
export const config = { api: { bodyParser: { sizeLimit: '900kb' } } };

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const result = await loadShillaBulkMatchGroups(req.query || {});
      return res.status(200).json({ success: true, ...result });
    }
    if (req.method === 'POST') {
      const actor = req.user?.userName || req.user?.userId || 'user';
      const result = await saveShillaBulkMatch({ ...(req.body || {}), actor });
      return res.status(200).json({ success: true, ...result });
    }
    return res.status(405).json({ success: false, error: 'GET 또는 POST만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
  } catch (cause) {
    return res.status(Number(cause.statusCode) || 500).json({
      success: false,
      error: cause.message || '일괄 품목 연결 처리 중 오류가 발생했습니다.',
      code: cause.code || 'INTERNAL_ERROR',
    });
  }
});
