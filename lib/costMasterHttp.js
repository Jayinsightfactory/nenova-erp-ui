import * as store from './costMasterStore.js';

// GET: 서버 보관 누적 파일 상태(읽기 전용). POST seed: 기존 누적 파일을 최초 1회 올린다.
export function createCostMasterHandler({ authorize, masterStore = store }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!authorize?.(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    try {
      const request = req.method === 'GET' ? req.query : req.body;
      const country = String(request?.country || 'CO').toUpperCase();
      if (req.method === 'GET') return res.json({ success: true, country, ...(await masterStore.masterInfo(country)) });
      if (request?.action !== 'seed' || typeof request.fileBase64 !== 'string') return res.status(400).json({ success: false, error: '누적 파일 올리기만 가능합니다.' });
      const buffer = Buffer.from(request.fileBase64, 'base64');
      const result = await masterStore.withMasterLock(async () => {
        const current = await masterStore.masterInfo(country);
        if (current.exists && request.replace !== true) {
          throw Object.assign(new Error('이미 서버에 누적 파일이 있습니다. 교체하려면 교체 확인이 필요합니다.'), { statusCode: 409 });
        }
        await masterStore.writeMaster(country, buffer);
        return masterStore.masterInfo(country);
      });
      return res.json({ success: true, country, ...result });
    } catch (error) {
      const status = [400, 409, 422].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ success: false, error: status === 503 ? '누적 파일 처리를 완료하지 못했습니다.' : error.message });
    }
  };
}
