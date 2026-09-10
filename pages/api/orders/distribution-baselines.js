import { withAuth } from '../../../lib/auth';

const store = require('../../../lib/distributionBaselineStore');

export const config = { api: { bodyParser: { sizeLimit: '750kb' } } };

function requestOriginIsSame(req) {
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
  return res.status(status).json({ error: { code: error?.code || 'BASELINE_STORAGE_ERROR', message: status === 500 ? '기준본 저장소 오류가 발생했습니다.' : error.message } });
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (!requestOriginIsSame(req)) return res.status(403).json({ error: { code: 'ORIGIN_MISMATCH', message: 'same-origin 요청만 허용됩니다.' } });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET 또는 POST만 허용됩니다.' } });
  }
  try {
    if (req.method === 'GET') {
      const { year, week, id } = req.query || {};
      if (id !== undefined) return res.status(200).json({ baseline: await store.getBaseline({ year, week, id }) });
      return res.status(200).json({ items: await store.listBaselines({ year, week }) });
    }
    return res.status(201).json({ baseline: await store.createBaseline(req.body, req.user) });
  } catch (error) {
    return sendError(res, error);
  }
});
