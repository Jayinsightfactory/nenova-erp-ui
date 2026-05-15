// pages/api/warehouse/pivot.js
// 발주 피벗 API
// 수정이력: 2026-03-30 — 거래처명, CN, 단위, 주문수량(변경수량) 추가

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { week: rawWeek } = req.query;
  const week = rawWeek ? normalizeOrderWeek(rawWeek) : '';
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

  try {
    // 날짜 목록
    const datesResult = await query(
      `SELECT DISTINCT CONVERT(NVARCHAR(10), wm.InputDate, 120) AS inputDate
       FROM WarehouseMaster wm
       WHERE wm.OrderWeek = @week AND wm.isDeleted = 0
       ORDER BY inputDate`,
      { week: { type: sql.NVarChar, value: week } }
    );
    const dates = datesResult.recordset.map(r => r.inputDate);

    // 품목 × 날짜 × 거래처별 주문수량
    const result = await query(
      `SELECT
        p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName, p.ProdKey,
        p.OutUnit AS unit,
        c.CustName AS custName, c.OrderCode AS cn,
        wd.OrderCode AS wdCn,
        CONVERT(NVARCHAR(10), wm.InputDate, 120) AS inputDate,
        SUM(wd.OutQuantity) AS qty
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey AND wm.isDeleted = 0
       JOIN Product p ON wd.ProdKey = p.ProdKey
       LEFT JOIN OrderDetail od ON od.ProdKey = p.ProdKey
       LEFT JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
         AND om.OrderWeek = @week AND om.isDeleted = 0
       LEFT JOIN Customer c ON om.CustKey = c.CustKey AND c.isDeleted = 0
       WHERE wm.OrderWeek = @week
       GROUP BY p.CounName, p.FlowerName, p.ProdName, p.ProdKey, p.OutUnit,
                c.CustName, c.OrderCode, wd.OrderCode,
                CONVERT(NVARCHAR(10), wm.InputDate, 120)
       ORDER BY p.CounName, p.FlowerName, p.ProdName, c.CustName`,
      { week: { type: sql.NVarChar, value: week } }
    );

    // 피벗 구조
    const pivotMap = {};
    for (const row of result.recordset) {
      const key = `${row.country}|${row.flower}|${row.prodName}|${row.custName||''}|${row.cn||row.wdCn||''}`;
      if (!pivotMap[key]) {
        pivotMap[key] = {
          country:  row.country,
          flower:   row.flower,
          prodName: row.prodName,
          custName: row.custName || '',
          cn:       row.cn || row.wdCn || '',
          unit:     row.unit || '박스',
          dates: {}
        };
      }
      pivotMap[key].dates[row.inputDate] = (pivotMap[key].dates[row.inputDate]||0) + row.qty;
    }

    return res.status(200).json({
      success: true, source: 'real_db',
      dates,
      items: Object.values(pivotMap),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
