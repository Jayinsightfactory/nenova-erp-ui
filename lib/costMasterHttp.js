import * as store from './costMasterStore.js';
import { upgradeLegacyCostWorkbook } from './upgradeLegacyCostSheetXml.js';

// GET: 서버 보관 누적 파일 상태(또는 download=1 다운로드, 읽기·무손실 정화). POST seed/upgrade: 누적 파일 보관 또는 단발 신형 변환.
export function createCostMasterHandler({ authorize, masterStore = store }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!authorize?.(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    try {
      const request = req.method === 'GET' ? req.query : req.body;
      const country = String(request?.country || 'CO').toUpperCase();
      if (req.method === 'GET') {
        if (request?.download === '1' || request?.download === 'true') {
          const buffer = await masterStore.withMasterLock(() => masterStore.readMaster(country));
          if (!buffer) return res.status(404).json({ success: false, error: '서버에 보관된 누적 원가자료가 없습니다.' });
          const fileName = `${country === 'CO_HYDRANGEA' ? '콜롬비아_수국' : '콜롬비아_콜카장'}_누적원가자료.xlsx`;
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', `attachment; filename="cost-master.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
          return res.send(buffer);
        }
        return res.json({ success: true, country, ...(await masterStore.withMasterLock(() => masterStore.masterInfo(country))) });
      }
      if (request?.action === 'upgrade' && typeof request.fileBase64 === 'string') {
        const inputBuf = Buffer.from(request.fileBase64, 'base64');
        if (!inputBuf.length || inputBuf.length > (store.MAX_MASTER_BYTES || 12 * 1024 * 1024) * 2) {
          return res.status(422).json({ success: false, error: '변환할 엑셀 파일 크기를 확인하세요.' });
        }
        await store.sheetNamesOf(inputBuf);
        const upgraded = await upgradeLegacyCostWorkbook(inputBuf);
        const baseName = String(request.fileName || '원가자료').replace(/\.xlsx$/i, '').replace(/[^\w가-힣\s().-]/g, '_').trim() || '원가자료';
        const outName = `${baseName}_품종필터·고정헤드.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="upgraded-cost-sheets.xlsx"; filename*=UTF-8''${encodeURIComponent(outName)}`);
        res.setHeader('X-Upgraded-Sheets', String(upgraded.upgradedSheets.length));
        res.setHeader('X-Removed-Auxiliary-Sheets', String(upgraded.removedSheets.length));
        return res.send(upgraded.buffer);
      }
      if (request?.action !== 'seed' || typeof request.fileBase64 !== 'string') return res.status(400).json({ success: false, error: '누적 파일 올리기 또는 변환만 가능합니다.' });
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
      const status = [400, 404, 409, 422].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ success: false, error: status === 503 ? '누적 파일 처리를 완료하지 못했습니다.' : error.message });
    }
  };
}
