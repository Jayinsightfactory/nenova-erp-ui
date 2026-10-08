import { withAuth } from '../../../lib/auth';
import snapshot from '../../../data/generated/full-development-history.json';

const { queryJourney } = require('../../../lib/developmentJourney.cjs');

export default withAuth(function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Allow', 'GET');
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET만 지원합니다.' });
  const query = {};
  for (const key of ['q', 'source', 'project', 'type', 'workType', 'menu', 'from', 'to']) {
    const value = req.query?.[key];
    if (typeof value === 'string') query[key] = value;
  }
  return res.status(200).json(queryJourney(snapshot, query));
});
