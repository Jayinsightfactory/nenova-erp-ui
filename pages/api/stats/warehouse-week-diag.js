// pages/api/stats/warehouse-week-diag.js
// 진단(읽기전용): 특정 대차수의 입고(WarehouseMaster) OrderYear/OrderWeek 저장형식 확인.
//   GET ?major=24  → 그 대차수 입고의 (연도/주차/계산값/건수/수량) 분포 + 농장 샘플.
// 물량표 입고 필터는 (OrderYear + REPLACE(OrderWeek,'-','')) 로 비교하므로,
// OrderWeek가 '24-01'이 아니라 '24' 등으로 저장돼 있으면 그 차수 입고가 누락된다.
import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';

async function handler(req, res) {
  const major = String(req.query.major || '24').replace(/[^\d]/g, '').slice(0, 3);
  if (!major) return res.status(400).json({ success: false, error: 'major(대차수 숫자) 필요' });
  try {
    const r = await query(
      `SELECT wm.OrderYear, wm.OrderWeek,
              (ISNULL(wm.OrderYear,'') + REPLACE(ISNULL(wm.OrderWeek,''), '-', '')) AS computedYW,
              COUNT(*) AS cnt, SUM(ISNULL(wd.OutQuantity,0)) AS qty,
              COUNT(DISTINCT wm.FarmName) AS farms,
              MIN(wm.FarmName) AS sampleFarm
         FROM WarehouseMaster wm
         JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
        WHERE ISNULL(wm.isDeleted,0) = 0
          AND (wm.OrderWeek LIKE '${major}%' OR wm.OrderWeek LIKE '${major}-%')
        GROUP BY wm.OrderYear, wm.OrderWeek
        ORDER BY wm.OrderYear, wm.OrderWeek`
    );
    return res.status(200).json({
      success: true, major,
      note: '물량표 입고필터 = (OrderYear + REPLACE(OrderWeek,"-","")) 가 차수범위(예 20262401)와 비교됨. OrderWeek가 "24-01"이 아니면 누락.',
      rows: r.recordset,
    });
  } catch (e) {
    return res.status(200).json({ success: false, error: String(e?.message || e) });
  }
}

export default withAuth(handler);
