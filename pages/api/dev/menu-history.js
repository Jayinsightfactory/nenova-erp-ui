import { withAuth } from '../../../lib/auth';
import snapshot from '../../../data/generated/menu-development-history.json';

const { querySnapshot } = require('../../../lib/menuDevelopmentHistory.cjs');

export default withAuth(function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Allow', 'GET');
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET만 지원합니다.' });
  const query = {};
  for (const key of ['q', 'sort', 'menu', 'feature', 'page', 'limit']) {
    const value = req.query?.[key];
    if (typeof value === 'string') query[key] = value;
  }
  return res.status(200).json(querySnapshot(snapshot, query));
});
