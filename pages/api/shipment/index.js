// pages/api/shipment/index.js
// GET → exe ViewShipment 기준 조회
// POST → 출고분배 API 사용

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getShipments(req, res);
  if (req.method === 'POST') return await createShipment(req, res);
  return res.status(405).end();
});

async function getShipments(req, res) {
  const { week, custName, area, manager } = req.query;
  let where = 'WHERE 1=1';
  const params = {};
  if (week) { where += ' AND vs.OrderWeek = @week'; params.week = { type: sql.NVarChar, value: normalizeOrderWeek(week) }; }
  if (custName) { where += ' AND vs.CustName LIKE @custName'; params.custName = { type: sql.NVarChar, value: `%${custName}%` }; }
  if (area) { where += ' AND vs.CustArea = @area'; params.area = { type: sql.NVarChar, value: area }; }
  if (manager) { where += ' AND vs.Manager = @manager'; params.manager = { type: sql.NVarChar, value: manager }; }

  try {
    const result = await query(
      `SELECT
        vs.ShipmentKey, vs.OrderWeek, vs.OrderYear, vs.MasterFix AS isFix,
        vs.CustKey, vs.CustName, vs.CustArea, vs.Manager,
        SUM(vs.OutQuantity) AS totalQty,
        SUM(vs.Amount) AS totalAmount
       FROM ViewShipment vs
       ${where}
       GROUP BY vs.ShipmentKey, vs.OrderWeek, vs.OrderYear, vs.MasterFix,
                vs.CustKey, vs.CustName, vs.CustArea, vs.Manager
       ORDER BY vs.CustArea, vs.CustName`, params
    );
    return res.status(200).json({ success: true, source: 'real_db', shipments: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function createShipment(req, res) {
  return res.status(410).json({
    success: false,
    error: '출고 생성은 /api/shipment/distribute 또는 /api/shipment/adjust 를 사용하세요. _new_Shipment* 테스트 저장은 비활성화되었습니다.',
  });
}
