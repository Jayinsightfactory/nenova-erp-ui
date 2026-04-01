// pages/api/admin/worklog.js
// 작업 내역 통합 조회 API
// OrderHistory + StockHistory + ShipmentHistory 를 하나로 합쳐서 반환
// 수정이력: 2026-03-30 — 신규 작성

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { startDate, endDate, userId, changeType } = req.query;

  // 날짜 조건
  const start = startDate || new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
  const end   = endDate   || new Date().toISOString().slice(0,10);

  try {
    // ── 0. 테스트 주문 등록 이력 (_new_OrderMaster) — try/catch로 테이블 없어도 안전
    let newOrderRows = [];
    try {
      const newOrderResult = await query(
        `SELECT TOP 200
          CONVERT(NVARCHAR(19), nom.CreateDtm, 120) AS changeDtm,
          nom.CreateID                              AS userId,
          '주문등록(테스트)'                        AS category,
          '신규등록'                                AS changeType,
          nom.OrderWeek                             AS week,
          ISNULL(c.CustName,'') + ' / 테스트주문'  AS targetName,
          'OrderMasterKey'                          AS columName,
          ''                                        AS beforeValue,
          CAST(nom.OrderMasterKey AS NVARCHAR)      AS afterValue,
          '테스트 테이블(_new_OrderMaster) 저장'    AS descr
         FROM _new_OrderMaster nom
         LEFT JOIN Customer c ON nom.CustKey = c.CustKey
         WHERE CAST(nom.CreateDtm AS DATE) BETWEEN @start AND @end
         ORDER BY nom.CreateDtm DESC`,
        {
          start: { type: sql.NVarChar, value: start },
          end:   { type: sql.NVarChar, value: end },
        }
      );
      newOrderRows = newOrderResult.recordset;
    } catch { /* _new_OrderMaster 테이블 없으면 무시 */ }

    const results = await Promise.all([

      // ── 1. 주문 변경 이력 (OrderHistory)
      query(
        `SELECT TOP 500
          CONVERT(NVARCHAR(19), oh.ChangeDtm, 120) AS changeDtm,
          oh.ChangeID                               AS userId,
          '주문변경'                                AS category,
          oh.ChangeType                             AS changeType,
          om.OrderWeek                              AS week,
          ISNULL(c.CustName,'') + ' / ' + ISNULL(p.ProdName,'') AS targetName,
          oh.ColumName                              AS columName,
          oh.BeforeValue                            AS beforeValue,
          oh.AfterValue                             AS afterValue,
          oh.Descr                                  AS descr
         FROM OrderHistory oh
         LEFT JOIN OrderDetail od  ON oh.OrderDetailKey = od.OrderDetailKey
         LEFT JOIN OrderMaster om  ON od.OrderMasterKey = om.OrderMasterKey
         LEFT JOIN Customer c      ON om.CustKey = c.CustKey
         LEFT JOIN Product p       ON od.ProdKey = p.ProdKey
         WHERE CAST(oh.ChangeDtm AS DATE) BETWEEN @start AND @end
         ORDER BY oh.ChangeDtm DESC`,
        {
          start: { type: sql.NVarChar, value: start },
          end:   { type: sql.NVarChar, value: end },
        }
      ),

      // ── 2. 재고 변경 이력 (StockHistory)
      query(
        `SELECT TOP 500
          CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS changeDtm,
          sh.ChangeID                               AS userId,
          '재고변경'                                AS category,
          sh.ChangeType                             AS changeType,
          sh.OrderWeek                              AS week,
          ISNULL(p.ProdName, '')                    AS targetName,
          sh.ColumName                              AS columName,
          sh.BeforeValue                            AS beforeValue,
          sh.AfterValue                             AS afterValue,
          sh.Descr                                  AS descr
         FROM StockHistory sh
         LEFT JOIN Product p ON sh.ProdKey = p.ProdKey
         WHERE CAST(sh.ChangeDtm AS DATE) BETWEEN @start AND @end
         ORDER BY sh.ChangeDtm DESC`,
        {
          start: { type: sql.NVarChar, value: start },
          end:   { type: sql.NVarChar, value: end },
        }
      ),

      // ── 3. 출고 변경 이력 (ShipmentHistory)
      query(
        `SELECT TOP 500
          CONVERT(NVARCHAR(19), sh.ChangeDtm, 120) AS changeDtm,
          sh.ChangeID                               AS userId,
          '출고변경'                                AS category,
          sh.ChangeType                             AS changeType,
          sm.OrderWeek                              AS week,
          ISNULL(c.CustName,'') + ' / ' + ISNULL(p.ProdName,'') AS targetName,
          sh.ColumName                              AS columName,
          sh.BeforeValue                            AS beforeValue,
          sh.AfterValue                             AS afterValue,
          sh.Descr                                  AS descr
         FROM ShipmentHistory sh
         LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
         LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         LEFT JOIN Customer c        ON sd.CustKey = c.CustKey
         LEFT JOIN Product p         ON sd.ProdKey = p.ProdKey
         WHERE CAST(sh.ChangeDtm AS DATE) BETWEEN @start AND @end
         ORDER BY sh.ChangeDtm DESC`,
        {
          start: { type: sql.NVarChar, value: start },
          end:   { type: sql.NVarChar, value: end },
        }
      ),
    ]);

    // 세 테이블 + 테스트 주문 합치기 → 날짜 내림차순 정렬
    let logs = [
      ...newOrderRows,
      ...results[0].recordset,
      ...results[1].recordset,
      ...results[2].recordset,
    ].sort((a, b) => b.changeDtm.localeCompare(a.changeDtm));

    // 사용자 필터
    if (userId && userId.trim()) {
      logs = logs.filter(r => r.userId?.toLowerCase().includes(userId.toLowerCase()));
    }

    // 변경유형 필터
    if (changeType && changeType.trim()) {
      logs = logs.filter(r => r.category === changeType);
    }

    return res.status(200).json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
