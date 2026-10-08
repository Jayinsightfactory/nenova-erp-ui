import { withAuth } from '../../../lib/auth';
import snapshot from '../../../data/generated/full-development-history.json';
import catalog from '../../../config/development-purpose-stories.json';
const { buildPurposeIndex, queryPurposeStories } = require('../../../lib/developmentPurposeStories.cjs');
const index = buildPurposeIndex(snapshot, catalog);
export default withAuth(function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Allow', 'GET');
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET만 지원합니다.' });
  const query = {};
  for (const key of ['mode', 'storyId', 'page', 'limit', 'order']) if (typeof req.query?.[key] === 'string') query[key] = req.query[key];
  const result = queryPurposeStories(index, query);
  return res.status(result.success ? 200 : 400).json(result);
});
