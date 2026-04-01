// pages/api/shipment/index.js
// GET → 실제 DB (ShipmentMaster + ShipmentDetail)
// POST → _new_ShipmentMaster + _new_ShipmentDetail 저장

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getShipments(req, res);
  if (req.method === 'POST') return await createShipment(req, res);
  return res.status(405).end();
});

async function getShipments(req, res) {
  const { week, custName, area, manager } = req.query;
  let where = 'WHERE sm.isDeleted = 0';
  const params = {};
  if (week) { where += ' AND sm.OrderWeek = @week'; params.week = { type: sql.NVarChar, value: week }; }
  if (custName) { where += ' AND c.CustName LIKE @custName'; params.custName = { type: sql.NVarChar, value: `%${custName}%` }; }
  if (area) { where += ' AND c.CustArea = @area'; params.area = { type: sql.NVarChar, value: area }; }
  if (manager) { where += ' AND c.Manager = @manager'; params.manager = { type: sql.NVarChar, value: manager }; }

  try {
    const result = await query(
      `SELECT
        sm.ShipmentKey, sm.OrderWeek, sm.OrderYear, sm.isFix,
        c.CustKey, c.CustName, c.CustArea, c.Manager,
        SUM(sd.OutQuantity) AS totalQty,
        SUM(sd.Amount) AS totalAmount
       FROM ShipmentMaster sm
       LEFT JOIN Customer c ON sm.CustKey = c.CustKey
       LEFT JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
       ${where}
       GROUP BY sm.ShipmentKey, sm.OrderWeek, sm.OrderYear, sm.isFix,
                c.CustKey, c.CustName, c.CustArea, c.Manager
       ORDER BY c.CustArea, c.CustName`, params
    );
    return res.status(200).json({ success: true, source: 'real_db', shipments: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function createShipment(req, res) {
  const { custKey, week, year, items } = req.body;
  try {
    const masterResult = await query(
      `INSERT INTO _new_ShipmentMaster
         (OrderYear, OrderWeek, OrderYearWeek, CustKey, isFix, isDeleted, CreateID, CreateDtm)
       OUTPUT INSERTED.ShipmentKey
       VALUES (@year, @week, @yearweek, @custKey, 0, 0, @uid, GETDATE())`,
      {
        year:     { type: sql.NVarChar, value: year || '' },
        week:     { type: sql.NVarChar, value: week || '' },
        yearweek: { type: sql.NVarChar, value: `${year}${week}` },
        custKey:  { type: sql.Int,      value: custKey },
        uid:      { type: sql.NVarChar, value: req.user.userId },
      }
    );
    const shipmentKey = masterResult.recordset[0].ShipmentKey;

    for (const item of items || []) {
      await query(
        `INSERT INTO _new_ShipmentDetail
           (ShipmentKey, CustKey, ProdKey, ShipmentDtm, BoxQuantity, BunchQuantity,
            SteamQuantity, OutQuantity, EstQuantity, Cost, Amount, Vat, CreateID, CreateDtm)
         VALUES (@sk, @ck, @pk, @dtm, @box, @bunch, @steam, @qty, @qty, @cost, @amount, @vat, @uid, GETDATE())`,
        {
          sk:     { type: sql.Int,      value: shipmentKey },
          ck:     { type: sql.Int,      value: custKey },
          pk:     { type: sql.Int,      value: item.prodKey },
          dtm:    { type: sql.DateTime, value: new Date(item.shipDate || Date.now()) },
          box:    { type: sql.Float,    value: item.boxQty || 0 },
          bunch:  { type: sql.Float,    value: item.bunchQty || 0 },
          steam:  { type: sql.Float,    value: item.steamQty || 0 },
          qty:    { type: sql.Float,    value: item.qty || 0 },
          cost:   { type: sql.Float,    value: item.cost || 0 },
          amount: { type: sql.Float,    value: item.amount || 0 },
          vat:    { type: sql.Float,    value: item.vat || 0 },
          uid:    { type: sql.NVarChar, value: req.user.userId },
        }
      );
    }
    return res.status(201).json({ success: true, source: 'test_table', shipmentKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
