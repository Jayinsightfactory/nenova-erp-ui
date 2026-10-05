import { resolveDutchWorkOwner, saveDutchWorkSnapshot, listDutchWorkSnapshots, getDutchWorkSnapshot, dutchWorkError, DUTCH_WORK_MAX_BYTES, normalizeDutchWorkSnapshot } from './dutchVolumeWorkStore.js';

export function assertDutchWorkOrigin(req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') throw dutchWorkError('WORK_ORIGIN_REJECTED', '같은 사이트에서 작업을 저장하세요.', 403);
  const origin = req.headers?.origin;
  if (!origin) return; // Bearer/API clients do not necessarily send Origin.
  try {
    const parsed = new URL(origin), host = req.headers?.host;
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== host || parsed.origin !== origin) throw Error();
  } catch { throw dutchWorkError('WORK_ORIGIN_REJECTED', '같은 사이트에서 작업을 저장하세요.', 403); }
}
export function createDutchVolumeWorkHandler(deps = {}) {
  const save = deps.saveDutchWorkSnapshot ?? saveDutchWorkSnapshot, list = deps.listDutchWorkSnapshots ?? listDutchWorkSnapshots, get = deps.getDutchWorkSnapshot ?? getDutchWorkSnapshot;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const ownerId = resolveDutchWorkOwner(req.user);
      if (req.method === 'GET') {
        const query = req.query ?? {};
        if (Object.values(query).some(Array.isArray)) throw dutchWorkError('INVALID_WORK_QUERY', '조회 값은 하나씩만 입력하세요.');
        if (query.id !== undefined) return res.status(200).json({ success: true, snapshot: await get({ ownerId, id: query.id }) });
        return res.status(200).json({ success: true, ...await list({ ownerId, cursor: query.cursor, limit: query.limit ?? 20 }) });
      }
      if (req.method === 'POST') {
        assertDutchWorkOrigin(req);
        if (Number(req.headers?.['content-length']) > DUTCH_WORK_MAX_BYTES) throw dutchWorkError('WORK_TOO_LARGE', '작업 저장은 900KiB까지 가능합니다.', 413);
        const data = normalizeDutchWorkSnapshot(req.body);
        // Owner and actor are always from the verified JWT, never the body.
        const snapshot = await save({ ...data, ownerId, savedBy: req.user.userName || ownerId });
        return res.status(200).json({ success: true, snapshot });
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: '지원하지 않는 요청입니다.' });
    } catch (error) {
      return res.status(error.statusCode ?? 500).json({ success: false, code: error.code ?? 'WORK_FAILED', error: error.statusCode ? error.message : '작업 저장 이력 처리에 실패했습니다.' });
    }
  };
}
