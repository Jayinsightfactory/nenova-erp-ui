// pages/api/estimate/index.js — 견적서 (실제 DB 조회, _new_ 테이블 저장)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getEstimates(req, res);
  if (req.method === 'POST') return await createEstimate(req, res);
  return res.status(405).end();
});

async function getEstimates(req, res) {
  const { week, custKey } = req.query;
  let where = 'WHERE sm.isDeleted = 0';
  const params = {};
  if (week)    { where += ' AND sm.OrderYearWeek LIKE @week'; params.week = { type: sql.NVarChar, value: `%${week}%` }; }
  if (custKey) { where += ' AND sm.CustKey = @custKey'; params.custKey = { type: sql.Int, value: parseInt(custKey) }; }

  try {
    // 출고 목록 (왼쪽 패널)
    const masterResult = await query(
      `SELECT sm.ShipmentKey, sm.OrderYearWeek, sm.CustKey,
        c.CustName, SUM(e.Amount + e.Vat) AS totalAmount
       FROM ShipmentMaster sm
       LEFT JOIN Customer c ON sm.CustKey = c.CustKey
       LEFT JOIN Estimate e ON sm.ShipmentKey = e.ShipmentKey
       ${where}
       GROUP BY sm.ShipmentKey, sm.OrderYearWeek, sm.CustKey, c.CustName
       ORDER BY sm.OrderYearWeek DESC, c.CustName`, params
    );

    // 견적서 상세 (오른쪽 패널) - 첫 번째 항목
    let items = [];
    if (masterResult.recordset.length > 0) {
      const firstKey = masterResult.recordset[0].ShipmentKey;
      const detailResult = await query(
        `SELECT e.EstimateKey, e.EstimateType, p.ProdName,
          e.Unit, e.Quantity, e.Cost, e.Amount, e.Vat, e.Descr,
          CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS outDate
         FROM Estimate e
         LEFT JOIN Product p ON e.ProdKey = p.ProdKey
         LEFT JOIN ShipmentDetail sd ON e.ShipmentKey = sd.ShipmentKey AND e.ProdKey = sd.ProdKey
         WHERE e.ShipmentKey = @sk
         ORDER BY e.EstimateKey`,
        { sk: { type: sql.Int, value: firstKey } }
      );
      items = detailResult.recordset;
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
