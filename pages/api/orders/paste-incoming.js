import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireOrderYear } from '../../../lib/orderUtils';
import { buildPasteIncomingSql, normalizePasteIncomingProdKeys } from '../../../lib/pasteIncomingDisplay.js';

// 붙여넣기 품목 매칭 보조 조회. nenova.exe ViewWarehouse와 같은
// WarehouseMaster(isDeleted=0) + WarehouseDetail.OutQuantity를 읽기만 한다.
export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  let scope;
  let prodKeys;
  try {
    scope = requireOrderYear(req.query.week, req.query.year || '');
    prodKeys = normalizePasteIncomingProdKeys(req.query.prodKeys);
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code || 'INVALID_REQUEST', error: error.message });
  }
  if (prodKeys.length === 0) return res.status(200).json({ success: true, rows: [] });

  try {
    const params = {
      orderYear: { type: sql.NVarChar, value: scope.orderYear },
      orderWeek: { type: sql.NVarChar, value: scope.orderWeek },
    };
    const keyParams = prodKeys.map((prodKey, index) => {
      params[`pk${index}`] = { type: sql.Int, value: prodKey };
      return `@pk${index}`;
    });
    const result = await query(buildPasteIncomingSql(keyParams), params);
    return res.status(200).json({
      success: true,
      orderYear: scope.orderYear,
      orderWeek: scope.orderWeek,
      rows: result.recordset.map(row => ({
        prodKey: Number(row.ProdKey),
        qty: Number(row.InQuantity || 0),
        outUnit: row.OutUnit || '',
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
