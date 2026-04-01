// pages/api/admin/activity.js
// 작업내역 조회 API — 여러 History 테이블을 통합하여 반환
// 수정이력: 2026-03-30 — 초기 작성

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { startDate, endDate, userId, category, page = 1, pageSize = 100 } = req.query;

  const dateParams = {};
  let dateWhere = '';
  if (startDate) { dateWhere += ' AND CAST(ChangeDtm AS DATE) >= @start'; dateParams.start = { type: sql.NVarChar, value: startDate }; }
  if (endDate)   { dateWhere += ' AND CAST(ChangeDtm AS DATE) <= @end';   dateParams.end   = { type: sql.NVarChar, value: endDate }; }

  const userWhere = userId ? ` AND ChangeID = @uid` : '';
  const userParam = userId ? { uid: { type: sql.NVarChar, value: userId } } : {};

  try {
    const results = [];

    // ── 1. 재고 변경 이력 (StockHistory)
    if (!category || category === 'stock') {
      const r = await query(
        `SELECT TOP 200
          CONVERT(NVARCHAR(19), ChangeDtm, 120) AS 변경일시,
          ChangeID AS 사용자,
          '재고' AS 카테고리,
          ChangeType AS 변경유형,
          OrderWeek AS 차수,
          ColumName AS 변경항목,
          BeforeValue AS 이전값,
          AfterValue AS 변경값,
          Descr AS 비고,
          ISNULL(p.ProdName, '') AS 품목명,
          '' AS 거래처명
         FROM StockHistory sh
         LEFT JOIN Product p ON sh.ProdKey = p.ProdKey
         WHERE 1=1 ${dateWhere} ${userWhere}
         ORDER BY ChangeDtm DESC`,
        { ...dateParams, ...userParam }
      );
      results.push(...r.recordset);
    }

    // ── 2. 주문 변경 이력 (OrderHistory)
    if (!category || category === 'order') {
      const r = await query(
        `SELECT TOP 200
          CONVERT(NVARCHAR(19), oh.ChangeDtm, 120) AS 변경일시,
          oh.ChangeID AS 사용자,
          '주문' AS 카테고리,
          oh.ChangeType AS 변경유형,
          om.OrderWeek AS 차수,
          oh.ColumName AS 변경항목,
          oh.BeforeValue AS 이전값,
          oh.AfterValue AS 변경값,
          oh.Descr AS 비고,
          ISNULL(p.ProdName, '') AS 품목명,
          ISNULL(c.CustName, '') AS 거래처명
         FROM OrderHistory oh
         LEFT JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
         LEFT JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
         LEFT JOIN Product p  ON od.ProdKey = p.ProdKey
         LEFT JOIN Customer c ON om.CustKey = c.CustKey
         WHERE 1=1 ${dateWhere} ${userWhere}
         ORDER BY oh.ChangeDtm DESC`,
        { ...dateParams, ...userParam }
      );
      results.push(...r.recordset);
    }

    // ── 3. 출고 변경 이력 (ShipmentHistory)
    if (!category || category === 'shipment') {
      const r = await query(
        `SELECT TOP 200
          CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS 변경일시,
          sh.ChangeID AS 사용자,
          '출고' AS 카테고리,
          sh.ChangeType AS 변경유형,
          sm.OrderWeek AS 차수,
          sh.ColumName AS 변경항목,
          sh.BeforeValue AS 이전값,
          sh.AfterValue AS 변경값,
          sh.Descr AS 비고,
          ISNULL(p.ProdName, '') AS 품목명,
          ISNULL(c.CustName, '') AS 거래처명
         FROM ShipmentHistory sh
         LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
         LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         LEFT JOIN Product p  ON sd.ProdKey = p.ProdKey
         LEFT JOIN Customer c ON sd.CustKey = c.CustKey
         WHERE 1=1 ${dateWhere} ${userWhere}
         ORDER BY sh.ChangeDtm DESC`,
        { ...dateParams, ...userParam }
      );
      results.push(...r.recordset);
    }

    // ── 날짜순 정렬 후 페이징
    results.sort((a, b) => b.변경일시?.localeCompare(a.변경일시));

    // 사용자 목록 (필터 드롭다운용)
    const userList = [...new Set(results.map(r => r.사용자).filter(Boolean))];

    return res.status(200).json({
      success: true,
      total: results.length,
      userList,
      activities: results,
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
