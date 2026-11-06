import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { validateSalesRequest, shipmentDateSalesSql, summarizeSales } from '../../../lib/estimateShipmentDateSales';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 지원합니다.' }); }
  let scope;
  try { scope = validateSalesRequest(req.query); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  try {
    const result = await query(shipmentDateSalesSql, {
      custKey: { type: sql.Int, value: scope.custKey },
      startDate: { type: sql.Date, value: scope.startDate },
      endDate: { type: sql.Date, value: scope.endDate },
    });
    return res.status(200).json({ success: true, periods: summarizeSales(result.recordset, scope.periods) });
  } catch (error) {
    console.error('[shipment-date-sales]', error.code ?? 'QUERY_FAILED');
    return res.status(500).json({ success: false, error: '출고일 매출 조회에 실패했습니다. 잠시 후 다시 조회하세요.' });
  }
});
