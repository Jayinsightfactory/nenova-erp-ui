// pages/api/warehouse/[id].js — exe FormWarehouseView.GetDetail
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlWarehouseViewGetDetail } from '../../../lib/exeWarehouseViewSql.js';

export default withAuth(async function handler(req, res) {
  const { id, exeParity } = req.query;
  const useExe = useExeParityFlag(exeParity);
  try {
    if (useExe) {
      const result = await query(sqlWarehouseViewGetDetail(), {
        warehouseKey: { type: sql.Int, value: parseInt(id, 10) },
      });
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', items: result.recordset });
    }
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
