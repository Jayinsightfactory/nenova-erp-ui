// pages/api/sales/status.js — 판매현황 API
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { dateFrom, dateTo, week, custKey, manager } = req.query;

  // 날짜 기준: 'ship'(출고일 ShipmentDtm, 기본) | 'confirm'(확정일=ECOUNT 전표일자)
  //   확정일 = 출고일이 속한 차수의 끝 화요일(= 출고일 on-or-after 다음 화요일). ECOUNT 는 이 날짜로 매출을 단다.
  //   DATEFIRST 무관: '19000102'(화요일) 기준 요일차로 계산.
  const basis = String(req.query.dateBasis || 'ship') === 'confirm' ? 'confirm' : 'ship';
  const includeDeduct = String(req.query.deduct || 'on') !== 'off'; // 차감(반품/할인) 포함 여부 (기본 포함)
  const dateExprCol = (col) => basis === 'confirm'
    ? `DATEADD(DAY, (7 - (DATEDIFF(DAY, '19000102', ${col}) % 7)) % 7, CONVERT(DATE, ${col}))`
    : `CONVERT(DATE, ${col})`;

  try {
    const params = {
      dateFrom: { type: sql.Date,    value: dateFrom || null },
      dateTo:   { type: sql.Date,    value: dateTo   || null },
      week:     { type: sql.NVarChar, value: week    || null },
      custKey:  { type: sql.Int,     value: custKey  ? parseInt(custKey) : null },
      manager:  { type: sql.NVarChar, value: manager || null },
    };

    // 금액은 저장된 분배금액(sd.Amount/Vat)을 그대로 사용 = 전산(nenova.exe)·견적서와 일치.
    // ⚠ 예전엔 단가×OutQuantity 로 재계산했는데, 단가(Cost)는 EstQuantity(환산 송이/단) 기준이라
    //   박스수(OutQuantity)를 곱하면 환산품목(카네이션·수국·루스커스 등)에서 10~15배 작게 나왔다.
    // 정상출고(SD, sd.Amount) + 차감(EST, Estimate.Amount 음수)을 UNION.
    //  - 차감은 EstimateDtm 이 53% NULL 이라, 관련 마스터의 대표 출고일(MIN ShipmentDtm)로 날짜를 단다.
    //  - rowType='SD'|'EST' 로 구분, supplyAmt 는 EST 가 음수라 합계가 자동으로 순매출이 됨.
    const estBlock = !includeDeduct ? '' : `
      UNION ALL
      SELECT 'EST' AS rowType,
        ${dateExprCol('md.d')} AS shipDateD,
        CONVERT(NVARCHAR(10), ${dateExprCol('md.d')}, 120) AS shipDate,
        CONVERT(NVARCHAR(10), md.d, 120) AS outDate,
        sm.OrderWeek AS week, c.Manager AS manager,
        c.CustKey, c.CustName, c.CustArea,
        e.ProdKey, ISNULL(p.ProdName, ISNULL(NULLIF(e.Descr,''), e.EstimateType)) AS ProdName,
        ISNULL(p.OutUnit, ISNULL(e.Unit,'')) AS OutUnit, ISNULL(p.CounName,'') AS CounName, ISNULL(p.FlowerName,'') AS FlowerName,
        ISNULL(e.Quantity,0) AS qty, ISNULL(e.Quantity,0) AS estQty,
        0 AS unitCost,
        ISNULL(e.Amount,0) AS supplyAmt, ISNULL(e.Vat,0) AS vatAmt
      FROM ShipmentMaster sm
      JOIN Estimate e ON e.ShipmentKey = sm.ShipmentKey
      JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
      LEFT JOIN Product p ON e.ProdKey = p.ProdKey
      CROSS APPLY (SELECT MIN(sd2.ShipmentDtm) AS d FROM ShipmentDetail sd2 WHERE sd2.ShipmentKey = sm.ShipmentKey) md
      WHERE sm.isDeleted = 0`;

    const result = await query(
      `SELECT * FROM (
        SELECT 'SD' AS rowType,
          ${dateExprCol('sd.ShipmentDtm')} AS shipDateD,
          CONVERT(NVARCHAR(10), ${dateExprCol('sd.ShipmentDtm')}, 120) AS shipDate,
          CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS outDate,
          sm.OrderWeek AS week, c.Manager AS manager,
          c.CustKey, c.CustName, c.CustArea,
          p.ProdKey, p.ProdName, p.OutUnit, p.CounName, p.FlowerName,
          sd.OutQuantity AS qty, sd.EstQuantity AS estQty,
          ISNULL(cpc.Cost, ISNULL(p.Cost,0)) AS unitCost,
          ISNULL(sd.Amount, 0) AS supplyAmt, ISNULL(sd.Vat, 0) AS vatAmt
        FROM ShipmentMaster sm
        JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
        JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
        JOIN Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
        LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = c.CustKey AND cpc.ProdKey = p.ProdKey
        WHERE sm.isDeleted = 0 AND ISNULL(sd.isFix, 0) = 1
        ${estBlock}
      ) t
      WHERE (@dateFrom IS NULL OR t.shipDateD >= @dateFrom)
        AND (@dateTo   IS NULL OR t.shipDateD <= @dateTo)
        AND (@week     IS NULL OR t.week = @week)
        AND (@custKey  IS NULL OR t.CustKey = @custKey)
        AND (@manager  IS NULL OR t.manager = @manager)
      ORDER BY t.shipDateD, t.CustName, t.rowType, t.ProdName`,
      params
    );

    const rows = result.recordset;

    // 요약 집계 — 총매출(정상출고) / 차감 / 순매출
    const sd = rows.filter(r => r.rowType === 'SD');
    const est = rows.filter(r => r.rowType === 'EST');
    const grossSupply  = sd.reduce((a, r) => a + (r.supplyAmt || 0), 0);
    const deductSupply = est.reduce((a, r) => a + (r.supplyAmt || 0), 0); // 음수
    const totalSupply  = grossSupply + deductSupply; // 순매출
    const totalVat     = rows.reduce((a, r) => a + (r.vatAmt || 0), 0);
    const totalAmt     = totalSupply + totalVat;
    const totalQty     = sd.reduce((a, r) => a + (r.qty || 0), 0); // 출고 수량(정상출고만)
    const custKeys     = new Set(rows.map(r => r.CustKey));

    return res.status(200).json({
      success: true,
      rows,
      summary: {
        totalQty,
        grossSupply,
        deductSupply,
        totalSupply,
        totalVat,
        totalAmt,
        deductCount: est.length,
        custCount: custKeys.size,
        rowCount: rows.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
