// pages/api/estimate/index.js — 견적서 (실제 DB 조회, _new_ 테이블 저장)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getEstimates(req, res);
  if (req.method === 'POST') return await createEstimate(req, res);
  return res.status(405).end();
});

async function getEstimates(req, res) {
  const { week, custKey, shipmentKey } = req.query;

  // ── shipmentKey 직접 지정 시: 해당 건 상세만 반환 (왼쪽 목록 불필요)
  if (shipmentKey) {
    try {
      const items = await loadItems(parseInt(shipmentKey));
      return res.status(200).json({ success: true, source: 'real_db', shipments: [], items });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // parentWeek: "14-01" → "14", 검색어가 "14"면 "14-01"~"14-04" 모두 매칭
  const parentWeek = week ? week.split('-')[0].replace(/^0+/, '') || week : '';

  let where = 'WHERE sm.isDeleted = 0';
  const params = {};
  if (week) {
    // 부모주차 기준 LIKE: "14" 입력 시 14-01, 14-02, 14-03, 14-04 모두 조회
    where += ' AND LEFT(sm.OrderYearWeek, LEN(@parentWeek)) = @parentWeek';
    params.parentWeek = { type: sql.NVarChar, value: parentWeek };
  }
  if (custKey) { where += ' AND sm.CustKey = @custKey'; params.custKey = { type: sql.Int, value: parseInt(custKey) }; }

  try {
    // 출고 목록 (왼쪽 패널) — 부모주차+거래처 기준으로 그룹핑 (14-01, 14-02 → "14"로 묶음)
    const masterResult = await query(
      `SELECT
        LEFT(sm.OrderYearWeek, CHARINDEX('-', sm.OrderYearWeek) - 1) AS ParentWeek,
        sm.CustKey, c.CustName,
        STRING_AGG(CAST(sm.ShipmentKey AS NVARCHAR), ',') AS ShipmentKeys,
        STRING_AGG(sm.OrderYearWeek, ',') AS SubWeeks,
        SUM(
          (SELECT ISNULL(SUM(
              ISNULL(p2.Cost,0)
              * ISNULL(NULLIF(sd2.OutQuantity,0), sd2.BoxQuantity+sd2.BunchQuantity+sd2.SteamQuantity)
            ),0)
           FROM ShipmentDetail sd2
           LEFT JOIN Product p2 ON sd2.ProdKey = p2.ProdKey
           WHERE sd2.ShipmentKey = sm.ShipmentKey)
          + (SELECT ISNULL(SUM(e2.Amount + e2.Vat),0) FROM Estimate e2 WHERE e2.ShipmentKey = sm.ShipmentKey)
        ) AS totalAmount,
        MIN(sm.ShipmentKey) AS firstShipmentKey
       FROM ShipmentMaster sm
       LEFT JOIN Customer c ON sm.CustKey = c.CustKey
       ${where}
       GROUP BY LEFT(sm.OrderYearWeek, CHARINDEX('-', sm.OrderYearWeek) - 1), sm.CustKey, c.CustName
       ORDER BY ParentWeek DESC, c.CustName`, params
    );

    // 견적서 상세 — 첫 번째 그룹의 모든 ShipmentKey 항목 합산
    let items = [];
    if (masterResult.recordset.length > 0) {
      const firstRow = masterResult.recordset[0];
      const keys = (firstRow.ShipmentKeys || '').split(',').map(Number).filter(Boolean);
      const allItems = await Promise.all(keys.map(k => loadItems(k)));
      items = allItems.flat();
    }

    return res.status(200).json({
      success: true, source: 'real_db',
      shipments: masterResult.recordset,
      items,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 공통: ShipmentKey → 정상출고(ShipmentDetail) + 차감(Estimate) UNION 반환
async function loadItems(sk) {
  const result = await query(
    `SELECT * FROM (
       -- ① 정상출고 (ShipmentDetail) — isDeleted/Cost/Amount/Vat 없는 원본 테이블 대응
       SELECT
         NULL                                      AS EstimateKey,
         '정상출고'                                AS EstimateType,
         p.ProdName,
         ISNULL(p.FlowerName, '')                  AS FlowerName,
         CASE WHEN sd.BoxQuantity > 0 THEN '박스'
              WHEN sd.BunchQuantity > 0 THEN '단'
              ELSE '송이' END                      AS Unit,
         ISNULL(NULLIF(sd.OutQuantity, 0),
           sd.BoxQuantity + sd.BunchQuantity + sd.SteamQuantity) AS Quantity,
         ISNULL(p.Cost, 0)                         AS Cost,
         ROUND(ISNULL(p.Cost, 0)
           * ISNULL(NULLIF(sd.OutQuantity, 0),
               sd.BoxQuantity + sd.BunchQuantity + sd.SteamQuantity)
           / 1.1, 0)                               AS Amount,
         ROUND(ISNULL(p.Cost, 0)
           * ISNULL(NULLIF(sd.OutQuantity, 0),
               sd.BoxQuantity + sd.BunchQuantity + sd.SteamQuantity)
           / 11, 0)                                AS Vat,
         ''                                        AS Descr,
         CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS outDate
       FROM ShipmentDetail sd
       LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
       WHERE sd.ShipmentKey = @sk
       UNION ALL
       -- ② 차감 (Estimate)
       SELECT
         e.EstimateKey,
         e.EstimateType,
         p.ProdName,
         ISNULL(p.FlowerName, '')                  AS FlowerName,
         e.Unit,
         e.Quantity,
         e.Cost,
         e.Amount,
         e.Vat,
         ISNULL(e.Descr, '')                       AS Descr,
         CONVERT(NVARCHAR(10), sd2.ShipmentDtm, 120) AS outDate
       FROM Estimate e
       LEFT JOIN Product p  ON e.ProdKey = p.ProdKey
       LEFT JOIN ShipmentDetail sd2
         ON e.ShipmentKey = sd2.ShipmentKey AND e.ProdKey = sd2.ProdKey
       WHERE e.ShipmentKey = @sk
     ) T
     ORDER BY outDate, EstimateType, ProdName`,
    { sk: { type: sql.Int, value: sk } }
  );
  return result.recordset;
}

async function createEstimate(req, res) {
  // 불량/검역 등록 → Estimate 테이블에 직접 저장 (원본 테이블)
  const { shipmentKey, prodKey, estimateType, unit, quantity, cost } = req.body;
  try {
    const amount = (quantity || 0) * (cost || 0);
    const vat = Math.round(amount / 11);
    await query(
      `INSERT INTO Estimate
         (EstimateType, ProdKey, Unit, Quantity, Cost, Amount, Vat, ShipmentKey, EstimateDtm)
       VALUES (@type, @pk, @unit, @qty, @cost, @amount, @vat, @sk, GETDATE())`,
      {
        type:   { type: sql.NVarChar, value: estimateType },
        pk:     { type: sql.Int,      value: prodKey },
        unit:   { type: sql.NVarChar, value: unit },
        qty:    { type: sql.Float,    value: quantity },
        cost:   { type: sql.Float,    value: cost },
        amount: { type: sql.Float,    value: amount },
        vat:    { type: sql.Float,    value: vat },
        sk:     { type: sql.Int,      value: shipmentKey },
      }
    );
    return res.status(201).json({ success: true, message: '견적 등록 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
