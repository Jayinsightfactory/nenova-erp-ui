// lib/chat/handlers/customerHistory.js — 거래처별 판매 이력 (Phase 6.1)
import { query, sql } from '../../db';
import { findCustomer } from '../entities';

// "꽃길 작년 판매" / "꽃길 이력" / "꽃길 작년 뭐 많이"
export async function handleCustomerHistory(text, user) {
  const cust = await findCustomer(text);
  if (!cust) {
    return {
      messages: [
        { type: 'text', content: '거래처를 찾지 못했습니다. 거래처명을 정확히 포함해서 다시 물어보세요. 예) "꽃길 작년 판매"' },
      ],
    };
  }

  // 기간 결정 (작년 / 올해 / 최근12개월)
  let yearWhere = "AND sd.ShipmentDtm >= DATEADD(month, -12, GETDATE())";
  let periodLabel = '최근 12개월';
  if (/작년/.test(text)) {
    yearWhere = "AND YEAR(sd.ShipmentDtm) = YEAR(DATEADD(year, -1, GETDATE()))";
    periodLabel = '작년';
  } else if (/올해|금년|이번\s*년/.test(text)) {
    yearWhere = "AND YEAR(sd.ShipmentDtm) = YEAR(GETDATE())";
    periodLabel = '올해';
  }

  // 거래처 TOP 품목 (상위 10)
  const topProducts = await query(
    `SELECT TOP 10
        p.ProdName,
        ISNULL(p.FlowerName,'') AS FlowerName,
        SUM(ISNULL(sd.OutQuantity,0)) AS totalQty,
        SUM(ISNULL(sd.Amount,0))      AS totalAmount,
        COUNT(DISTINCT sm.OrderWeek)  AS weekCount
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Product p          ON p.ProdKey = sd.ProdKey
      WHERE ISNULL(sm.isDeleted,0) = 0
        AND sm.CustKey = @ck ${yearWhere}
   GROUP BY p.ProdName, p.FlowerName
   ORDER BY SUM(ISNULL(sd.Amount,0)) DESC`,
    { ck: { type: sql.Int, value: cust.CustKey } }
  );

  // 합계
  const totals = await query(
    `SELECT
        SUM(ISNULL(sd.Amount,0)) AS totalAmount,
        SUM(ISNULL(sd.Vat,0))    AS totalVat,
        COUNT(DISTINCT sm.OrderWeek) AS weekCount,
        COUNT(DISTINCT sd.ProdKey)   AS prodCount
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      WHERE ISNULL(sm.isDeleted,0) = 0
        AND sm.CustKey = @ck ${yearWhere}`,
    { ck: { type: sql.Int, value: cust.CustKey } }
  );
  const t = totals.recordset[0] || {};

  if (!t.totalAmount) {
    return {
      messages: [
        { type: 'text', content: `📂 ${cust.CustName} · ${periodLabel} 기간 거래 내역이 없습니다.` },
      ],
      suggestions: [
        { label: `${cust.CustName} 미수금`, text: `${cust.CustName} 미수금` },
      ],
    };
  }

  return {
    messages: [
      {
        type: 'card',
        card: {
          title: `📈 ${cust.CustName} · ${periodLabel} 거래 요약`,
          rows: [
            { label: '총 매출', value: `${(t.totalAmount || 0).toLocaleString()}원` },
            { label: '부가세', value: `${(t.totalVat || 0).toLocaleString()}원` },
            { label: '거래 차수', value: `${t.weekCount || 0}회` },
            { label: '구매 품목', value: `${t.prodCount || 0}종` },
          ],
        },
      },
      {
        type: 'card',
        card: {
          title: `🏆 주력 구매 품목 TOP ${topProducts.recordset.length}`,
          rows: topProducts.recordset.map((r, i) => ({
            label: `${i + 1}. ${r.ProdName}`,
            value: `${(r.totalAmount || 0).toLocaleString()}원 (${r.weekCount}차수)`,
          })),
        },
      },
    ],
    suggestions: [
      { label: `${cust.CustName} 작년 대비`, text: `${cust.CustName} 작년 대비 매출` },
      { label: `${cust.CustName} 예상 주문`, text: `${cust.CustName} 다음 차수 예상 주문` },
      { label: `${cust.CustName} 미수금`, text: `${cust.CustName} 미수금` },
    ],
  };
}
