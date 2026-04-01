// pages/api/warehouse/[id].js — 입고 상세 (오른쪽 패널)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  const { id } = req.query;
  try {
    const result = await query(
      `SELECT wd.WdetailKey, wd.ProdKey,
        ISNULL(p.ProdName, '') AS ProdName,
        wd.OrderCode AS 주문코드,
        ISNULL(p.OutUnit, '') AS 단위,
        ISNULL(p.SteamOf1Bunch, 0) AS 단송이,
        ISNULL(p.SteamOf1Box, 0) AS 박스송이,
        ISNULL(wd.BoxQuantity, 0) AS BoxQuantity,
        ISNULL(wd.BunchQuantity, 0) AS BunchQuantity,
        ISNULL(wd.SteamQuantity, 0) AS SteamQuantity,
        ISNULL(wd.OutQuantity, 0) AS OutQuantity,
        ISNULL(wd.EstQuantity, 0) AS EstQuantity,
        ISNULL(wd.UPrice, 0) AS 단가,
        ISNULL(wd.TPrice, 0) AS 총액
       FROM WarehouseDetail wd
       LEFT JOIN Product p ON wd.ProdKey = p.ProdKey
       WHERE wd.WarehouseKey = @wk
       ORDER BY wd.WdetailKey`,
      { wk: { type: sql.Int, value: parseInt(id) } }
    );
    return res.status(200).json({ success: true, items: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
