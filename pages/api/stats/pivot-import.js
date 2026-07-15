// pages/api/stats/pivot-import.js
// 수입부 Pivot 데이터 — 입고(WarehouseMaster/Detail) 관점
// 행: 주문차수 → AWB(OrderNo) → BILL번호(InvoiceNo) / 농장명 · 값: 입고총단가(Σ WarehouseDetail.TPrice, USD)
// 기존 Pivot 통계는 주문/품목 관점이라 AWB가 품목당 1개로 뭉개져 BILL 단위 조회가 불가 — 별도 API.

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek, resolveActiveOrderYear, buildOrderYearWeek } from '../../../lib/orderUtils';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { weekStart, weekEnd, orderYear } = req.query;
  try {
    if (!weekStart) return res.status(400).json({ success: false, error: 'weekStart 필요' });
    const ws = normalizeOrderWeek(weekStart);
    const we = normalizeOrderWeek(weekEnd || weekStart);
    const startYear = resolveActiveOrderYear(weekStart, orderYear);
    const endYear = resolveActiveOrderYear(weekEnd || weekStart, orderYear, startYear);
    const yws = buildOrderYearWeek(startYear, ws);
    const ywe = buildOrderYearWeek(endYear, we);
    if (yws > ywe) return res.status(400).json({ success: false, error: '차수 범위가 올바르지 않습니다.' });

    const result = await query(
      `SELECT
          ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear) AS orderYear,
          wm.OrderWeek AS week,
          LTRIM(RTRIM(ISNULL(wm.OrderNo, N''))) AS awb,
          LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))) AS billNo,
          LTRIM(RTRIM(ISNULL(wm.FarmName, N''))) AS farmName,
          ROUND(SUM(ISNULL(wd.TPrice, 0)), 2) AS inTotal,
          COUNT(wd.WdetailKey) AS lineCount,
          ROUND(SUM(ISNULL(wd.OutQuantity, 0)), 2) AS qty
        FROM WarehouseMaster wm
        JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       WHERE ISNULL(wm.isDeleted, 0) = 0
         AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear) + REPLACE(wm.OrderWeek, '-', '')
             BETWEEN @yws AND @ywe
       GROUP BY ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear), wm.OrderWeek,
                LTRIM(RTRIM(ISNULL(wm.OrderNo, N''))), LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))),
                LTRIM(RTRIM(ISNULL(wm.FarmName, N'')))
       ORDER BY wm.OrderWeek, awb, billNo`,
      {
        startYear: { type: sql.NVarChar, value: startYear },
        yws: { type: sql.NVarChar, value: yws },
        ywe: { type: sql.NVarChar, value: ywe },
      }
    );

    return res.status(200).json({
      success: true,
      orderYear: startYear,
      weekStart: ws,
      weekEnd: we,
      rows: result.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
