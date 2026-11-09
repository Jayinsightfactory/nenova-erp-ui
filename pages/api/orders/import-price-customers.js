// pages/api/orders/import-price-customers.js
// 업로드 주문등록 → 「분배단가만 수정」 거래처 버튼 목록 (읽기 전용)
// GET ?orderYear=2026&parentWeek=45
//   → 해당 대차수(45-01, 45-02 …)에 분배 행(ShipmentDetail)이 있는 거래처만 이름순으로.
//   주문만 있고 분배 전인 거래처는 제외. 확정 여부(isFix)로 거르지 않는다.
// 규칙 1 준수: SELECT 만. 규칙 5: sm.CustKey 우선, sd.CustKey fallback 포함.

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const orderYear = String(req.query.orderYear || '').trim();
  const parentWeek = String(req.query.parentWeek || '').trim().replace(/-.*$/, '');
  if (!/^\d{4}$/.test(orderYear)) return res.status(400).json({ success: false, error: 'orderYear(4자리) 필요' });
  if (!/^\d{1,2}$/.test(parentWeek)) return res.status(400).json({ success: false, error: 'parentWeek(대차수 NN) 필요' });
  const pw = parentWeek.padStart(2, '0');

  try {
    const r = await query(
      `SELECT x.CustKey, c.CustName, c.Manager AS managerId, ui.UserName AS managerName, x.OrderWeek,
              COUNT(*) AS detailCount,
              SUM(CASE WHEN ISNULL(x.sdFix, 0) = 1 THEN 1 ELSE 0 END) AS fixedCount
         FROM (
           SELECT COALESCE(NULLIF(sd.CustKey, 0), sm.CustKey) AS CustKey, sm.OrderWeek, sd.isFix AS sdFix
             FROM ShipmentDetail sd
             JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
            WHERE sm.OrderYear = @yr
              AND sm.OrderWeek LIKE @pwLike
              AND ISNULL(sm.isDeleted, 0) = 0
         ) x
         JOIN Customer c ON c.CustKey = x.CustKey
         LEFT JOIN UserInfo ui ON ui.UserID = c.Manager
        GROUP BY x.CustKey, c.CustName, c.Manager, ui.UserName, x.OrderWeek
        ORDER BY c.CustName, x.OrderWeek`,
      {
        yr: { type: sql.NVarChar, value: orderYear },
        pwLike: { type: sql.NVarChar, value: `${pw}-%` },
      },
    );
    const byCust = new Map();
    for (const row of r.recordset || []) {
      const key = Number(row.CustKey);
      if (!byCust.has(key)) byCust.set(key, { custKey: key, custName: row.CustName, managerId: row.managerId || '', managerName: row.managerName || '담당자 미지정', detailCount: 0, fixedCount: 0, subWeeks: [] });
      const cst = byCust.get(key);
      cst.detailCount += Number(row.detailCount);
      cst.fixedCount += Number(row.fixedCount);
      cst.subWeeks.push({ orderWeek: row.OrderWeek, detailCount: Number(row.detailCount), fixedCount: Number(row.fixedCount) });
    }
    return res.status(200).json({ success: true, orderYear, parentWeek: pw, customers: [...byCust.values()] });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
