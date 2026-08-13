// lib/profitReportCustomerMixSql.js — 매출이익 보고서 드라이버 분석용 거래처×품목 매출비중/부가세포함
// 분배단가 조회 (읽기 전용).
//
// 확정 매출 필터는 lib/profitReport.js#salesByCategory 와 **동일**해야 한다. 드라이버 분석
// 카운트가 보고서 자체 N과 어긋나지 않도록 master/detail 확정을 모두 요구하고,
// profitReport.js 쪽 필터(`sm.OrderWeek LIKE 'major-%' AND sm.OrderYearWeek=yw AND
// ISNULL(sm.isDeleted,0)=0 AND ISNULL(sm.isFix,0)=1 AND ISNULL(sd.isFix,0)=1 AND
// ISNULL(sd.OutQuantity,0)<>0` +
// 무게 placeholder 제외)를 그대로 재사용해야 한다.
//
// CustKey 는 sd.CustKey(ShipmentDetail) 가 아니라 sm.CustKey(ShipmentMaster) 를 쓴다 — sd.CustKey는
// NULL/0/미스매치가 흔해 pages/api/shipment/distribute-diagnose.js 가 별도로 복구(repairMissingCustKey)
// 하는 필드다. sm.CustKey가 신뢰 가능한 원천이다.
//
// 부가세포함 분배단가는 lib/salesSnapshot.js#buildCustGroups 의 기존 선례를 따른다: 단가의 수량
// 기준은 OutQuantity 가 아니라 **EstQuantity**(CLAUDE.md 규칙: "EstQuantity = 환산 기준 수량,
// 금액/견적 기준 수량. 카네이션/수국/루스커스처럼 박스 출고지만 단/송이 금액 기준을 쓰는 품목은
// EstQuantity가 다르게 나온다"). 즉 vatInclusiveUnitPrice = SUM(Amount+Vat) / SUM(EstQuantity).
// "총 판매수량"(qty) 자체는 물리적 출고수량인 OutQuantity 합계를 그대로 쓴다 — 이 두 수량은
// 단/송이 환산 품목에서 서로 다를 수 있으므로 응답에 qty(OutQuantity)와 estQty(EstQuantity)를
// 모두 남겨 호출자가 혼동하지 않게 한다.
import { query, sql } from './db.js';

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** lib/profitReport.js 의 nonValueWeightSql('p') 과 동일 조건(무게 placeholder 행 제외).
 * profitReport.js가 이 SQL 문자열 자체를 export 하지 않으므로(재작성 금지 원칙 — CASE_CATEGORY와
 * 같은 이유), 같은 리터럴을 여기서도 그대로 유지한다. 이 조건은 lib/customsForwarding.js 등
 * 다른 파일에서도 각자 로컬 상수로 동일하게 복제해 쓰는 기존 관례를 따른다. */
const NON_VALUE_WEIGHT_SQL = `NOT (
  UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGHT%'
  OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGTH%'
  OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%GROSS WEIGHT%'
  OR UPPER(LTRIM(RTRIM(ISNULL(p.ProdName,N'')))) LIKE N'%GROSS WEIGTH%'
)`;

/**
 * 거래처×품목 매출 조회 — 확정 출고(master/detail isFix=1)만, lib/profitReport.js#salesByCategory
 * 와 같은 필터 기준. CustKey+ProdKey 조합별 수량/금액/부가세포함 분배단가/거래처명을 반환하며,
 * 같은 응답 안에 그 ProdKey의 그 주 전체 대비 거래처별 수량/금액 비중(share, 0~1)도 함께 담는다.
 *
 * @param {string|number} orderYear
 * @param {string|number} major  대차수 (예: '28')
 * @param {{ prodKeys?: Array<number|string> }} [options]  지정하면 그 ProdKey만 스캔(전체 품목 스캔 방지)
 * @returns {Promise<Array<{
 *   custKey:number|null, prodKey:number, custName:string,
 *   qty:number, estQty:number, amount:number, vat:number,
 *   vatInclusiveUnitPrice:number|null,
 *   qtyShare:number|null, amountShare:number|null,
 * }>>}
 */
export async function loadCustomerProductSales(orderYear, major, { prodKeys } = {}) {
  const params = {
    pfx: { type: sql.NVarChar, value: `${major}-%` },
    yw: { type: sql.NVarChar, value: `${orderYear}${major}` },
    yr: { type: sql.NVarChar, value: String(orderYear) },
  };
  let prodFilterSql = '';
  const keys = [...new Set((prodKeys || []).map((k) => Number(k)).filter((k) => Number.isFinite(k) && k > 0))];
  if (keys.length) {
    const placeholders = keys.map((k, i) => {
      const name = `pk${i}`;
      params[name] = { type: sql.Int, value: k };
      return `@${name}`;
    });
    prodFilterSql = `AND sd.ProdKey IN (${placeholders.join(',')})`;
  }

  const result = await query(
    `WITH agg AS (
       SELECT sm.CustKey AS CustKey, sd.ProdKey AS ProdKey,
              LTRIM(RTRIM(ISNULL(c.CustName, N''))) AS CustName,
              LTRIM(RTRIM(ISNULL(p.ProdName, N''))) AS ProductName,
              SUM(ISNULL(sd.OutQuantity,0)) AS Qty,
              SUM(ISNULL(sd.EstQuantity,0)) AS EstQty,
              SUM(ISNULL(sd.Amount,0)) AS Amount,
              SUM(ISNULL(sd.Vat,0)) AS Vat
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         LEFT JOIN Customer c ON c.CustKey = sm.CustKey AND ISNULL(c.isDeleted,0) = 0
         LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
        WHERE sm.OrderWeek LIKE @pfx
          AND ISNULL(sm.OrderYearWeek,'') = @yw
          AND ISNULL(sm.OrderYear,'') = @yr
          AND ISNULL(sm.isDeleted,0) = 0
          AND ISNULL(sm.isFix,0) = 1
          AND ISNULL(sd.isFix,0) = 1
          AND ISNULL(sd.OutQuantity,0) <> 0
          AND ${NON_VALUE_WEIGHT_SQL}
          ${prodFilterSql}
        GROUP BY sm.CustKey, sd.ProdKey, c.CustName, p.ProdName
     )
     SELECT a.CustKey, a.ProdKey, a.CustName, a.ProductName, a.Qty, a.EstQty, a.Amount, a.Vat,
            SUM(a.Qty) OVER (PARTITION BY a.ProdKey) AS ProdTotalQty,
            SUM(a.Amount) OVER (PARTITION BY a.ProdKey) AS ProdTotalAmount
       FROM agg a
      ORDER BY a.ProdKey, a.Amount DESC`,
    params,
  );

  return (result.recordset || []).map((row) => {
    const qty = n0(row.Qty);
    const estQty = n0(row.EstQty);
    const amount = n0(row.Amount);
    const vat = n0(row.Vat);
    const prodTotalQty = n0(row.ProdTotalQty);
    const prodTotalAmount = n0(row.ProdTotalAmount);
    return {
      custKey: row.CustKey != null ? Number(row.CustKey) : null,
      prodKey: Number(row.ProdKey),
      custName: row.CustName || '',
      productName: row.ProductName || '',
      qty,
      estQty,
      amount,
      vat,
      vatInclusiveUnitPrice: estQty !== 0 ? (amount + vat) / estQty : null,
      qtyShare: prodTotalQty !== 0 ? qty / prodTotalQty : null,
      amountShare: prodTotalAmount !== 0 ? amount / prodTotalAmount : null,
    };
  });
}
