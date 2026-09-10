import { withAuth } from '../../../lib/auth';

const store = require('../../../lib/distributionChecklistStore');

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

function isSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (!host) return false;
  const forwardedProto = req.headers?.['x-forwarded-proto'];
  const protocol = String(Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'http').split(',')[0].trim();
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function sendError(res, error) {
  const status = error?.statusCode || 500;
  return res.status(status).json({
    error: {
      code: error?.code || 'CHECKLIST_STORAGE_ERROR',
      message: status === 500 ? '체크리스트 기록을 처리할 수 없습니다.' : error.message,
    },
  });
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.user?.accountActive === false) {
    return res.status(403).json({ error: { code: 'ACCOUNT_INACTIVE', message: '비활성 계정은 체크리스트를 사용할 수 없습니다.' } });
  }
  if (!isSameOrigin(req)) return res.status(403).json({ error: { code: 'ORIGIN_MISMATCH', message: '같은 사이트에서 보낸 요청만 허용됩니다.' } });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '조회 또는 저장 요청만 허용됩니다.' } });
  }
  try {
    if (req.method === 'GET') {
      const { year, week } = req.query || {};
      return res.status(200).json({ reviews: await store.listReviews({ year, week }) });
    }
    return res.status(201).json({ review: await store.recordReview(req.body, req.user) });
  } catch (error) {
    return sendError(res, error);
  }
});
