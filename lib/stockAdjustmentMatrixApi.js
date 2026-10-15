import { parseStockAdjustmentMatrixScope } from './stockAdjustmentMatrixSql.js';

export function createStockAdjustmentMatrixHandler({ loadMatrix, loadFlow, buildWorkbook }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ok:false,message:'조회만 가능합니다.'}); }
    const scope = parseStockAdjustmentMatrixScope(req.query);
    if (!scope) return res.status(400).json({ok:false,message:'연도·차수·검색 조건을 확인해 주세요.'});
    try {
      const matrix = await loadMatrix(scope);
      if (matrix.orderYear !== scope.orderYear) throw Error('조회 연도가 일치하지 않습니다.');
      if (scope.format !== 'xlsx') return res.status(200).json({ok:true,source:'StockHistory',...matrix,queriedAt:new Date().toISOString()});
      const flow = await loadFlow(scope.orderYear);
      const workbook = await buildWorkbook(matrix, flow);
      const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
      const filename = `재고조정_${scope.orderYear}년_${scope.major ? Number(scope.major)+'차' : '전체차수'}.xlsx`;
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',`attachment; filename="stock-adjustments-${scope.orderYear}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.status(200).send(bytes);
    } catch {
      return res.status(500).json({ok:false,message:'재고조정 조회 또는 엑셀 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.'});
    }
  };
}
