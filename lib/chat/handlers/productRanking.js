// lib/chat/handlers/productRanking.js — 품목 인기/비인기 랭킹 (Phase 6.1)
import { query, sql } from '../../db';

// "인기 품종 TOP 10" / "잘 나가는 카네이션" / "안 팔리는 품종" / "최근 안 나가는"
export async function handleProductRanking(text, user) {
  const isDead = /비인기|안\s*팔|안\s*나가|죽은|재고\s*많/.test(text);
  const n = parseInt((text.match(/TOP\s*(\d+)|상위\s*(\d+)|(\d+)개/i) || [])[1]
                  || (text.match(/TOP\s*(\d+)|상위\s*(\d+)|(\d+)개/i) || [])[2]
                  || (text.match(/TOP\s*(\d+)|상위\s*(\d+)|(\d+)개/i) || [])[3]
                  || '20');

  // 기간: 기본 최근 3개월
  let period = "DATEADD(month, -3, GETDATE())";
  let periodLabel = '최근 3개월';
  if (/이번\s*달|이달/.test(text)) {
    period = "DATEADD(month, -1, GETDATE())";
    periodLabel = '최근 1개월';
  } else if (/올해|금년/.test(text)) {
    period = "DATEFROMPARTS(YEAR(GETDATE()),1,1)";
    periodLabel = '올해';
  } else if (/작년/.test(text)) {
    period = "DATEFROMPARTS(YEAR(DATEADD(year,-1,GETDATE())),1,1)";
    periodLabel = '작년';
  }

  // 꽃 이름/카테고리 필터 (예: "카네이션 인기")
  let nameFilter = '';
  const params = {};
  const m = text.match(/(카네이션|장미|루스커스|튤립|수국|알스트로|소재|국화|아네모네)/);
  if (m) {
    nameFilter = 'AND (p.ProdName LIKE @kw OR p.FlowerName LIKE @kw OR p.CountryFlower LIKE @kw)';
    params.kw = { type: sql.NVarChar, value: `%${m[1]}%` };
  }

  const orderDir = isDead ? 'ASC' : 'DESC';
  const r = await query(
    `SELECT TOP ${n}
        p.ProdKey, p.ProdName, ISNULL(p.FlowerName,'') AS FlowerName,
        SUM(ISNULL(sd.OutQuantity,0)) AS totalQty,
        SUM(ISNULL(sd.Amount,0))      AS totalAmount,
        COUNT(DISTINCT sm.CustKey)    AS custCount
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE ISNULL(sm.isDeleted,0) = 0
        AND ISNULL(p.isDeleted,0) = 0
        AND sd.ShipmentDtm >= ${period}
        ${nameFilter}
   GROUP BY p.ProdKey, p.ProdName, p.FlowerName
   HAVING SUM(ISNULL(sd.OutQuantity,0)) > 0
   ORDER BY SUM(ISNULL(sd.Amount,0)) ${orderDir}`,
    params
  );

  const rows = r.recordset;
  if (rows.length === 0) {
    return { messages: [{ type: 'text', content: `📂 ${periodLabel} 데이터가 없습니다.` }] };
  }

  const title = isDead
    ? `📉 ${periodLabel} 비인기 품목 ${rows.length}`
    : `🏆 ${periodLabel} 인기 품목 TOP ${rows.length}`;

  return {
    messages: [
      {
        type: 'card',
        card: {
          title,
          rows: rows.map((r, i) => ({
            label: `${i + 1}. ${r.ProdName}${r.FlowerName ? ` (${r.FlowerName})` : ''}`,
            value: `${(r.totalAmount || 0).toLocaleString()}원 · ${r.custCount}곳`,
          })),
        },
      },
    ],
    suggestions: [
      { label: '거래처 TOP 10', text: '거래처 TOP 10' },
      { label: '재고 부족 품목', text: '재고 부족 품목' },
      isDead
        ? { label: '인기 품목', text: '인기 품목 TOP 20' }
        : { label: '비인기 품목', text: '비인기 품목 20개' },
    ],
  };
}
