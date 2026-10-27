import { readNativeCostSource, calculateNativeCost, nativeCostDocument } from './nativeReceiptCost.js';
import { createNativeCostWorkbook } from './invoiceReceiptCostExport.js';

export function createNativeCostHandler({ queryFn, types, authorize, generate = createNativeCostWorkbook }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!authorize?.(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    try {
      const request = req.method === 'GET' ? req.query : req.body;
      if (req.method === 'POST' && !['preview', 'download'].includes(request?.action))
        return res.status(400).json({ success: false, error: '계산 또는 다운로드만 가능합니다.' });
      const source = await readNativeCostSource({ queryFn, types, input: request });
      if (req.method === 'GET') return res.json({ success: true, source, document: nativeCostDocument(source) });
      const result = calculateNativeCost(source, request);
      if (request.action === 'preview') return res.json({ success: true, preview: result.preview, persisted: false });
      const file = await generate(result);
      const latest = await readNativeCostSource({ queryFn, types, input: request });
      if (latest.sourceHash !== source.sourceHash) return res.status(409).json({ success: false, error: '엑셀 생성 중 입고자료가 변경되었습니다. 다시 조회하세요.' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="native-cost-${source.orderYear}-${source.orderWeek}-${source.warehouseKey}.xlsx"`);
      return res.send(file);
    } catch (error) {
      const status = [400,404,409,422].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ success: false, error: status === 503 ? '입고자료 계산을 완료하지 못했습니다. 입력값을 유지한 채 다시 시도하세요.' : error.message });
    }
  };
}
