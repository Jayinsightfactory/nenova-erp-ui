// pages/api/shipment/index.js — GET → exe FormShipmentView.GetData
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek } from '../../../lib/orderUtils';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlShipmentViewGetData } from '../../../lib/exeShipmentViewSql.js';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getShipments(req, res);
  if (req.method === 'POST') return await createShipment(req, res);
  return res.status(405).end();
});

async function resolveShipmentListWeek(week) {
  const norm = normalizeOrderWeek(week || '');
  if (!norm) {
    const r = await query(
      `SELECT TOP 1 OrderYear, OrderWeek FROM ShipmentMaster WHERE isDeleted=0 ORDER BY CreateDtm DESC`,
      {}
    );
    return { orderYear: String(r.recordset[0]?.OrderYear || new Date().getFullYear()), orderWeek: r.recordset[0]?.OrderWeek || '' };
  }
  const r = await query(
    `SELECT TOP 1 OrderYear, OrderWeek FROM ShipmentMaster
      WHERE isDeleted=0 AND OrderWeek=@ow ORDER BY CreateDtm DESC`,
    { ow: { type: sql.NVarChar, value: norm } }
  );
  const row = r.recordset[0];
  return {
    orderYear: String(row?.OrderYear || new Date().getFullYear()),
    orderWeek: row?.OrderWeek || norm,
  };
}

async function getShipments(req, res) {
  const { week, custName, area, manager, custKey, exeParity } = req.query;
  const useExe = useExeParityFlag(exeParity);

  try {
    if (useExe) {
      const { orderYear, orderWeek } = await resolveShipmentListWeek(week);
      const params = {
        orderYear: { type: sql.NVarChar, value: orderYear },
        orderWeek: { type: sql.NVarChar, value: orderWeek },
      };
      if (custKey) params.custKey = { type: sql.Int, value: parseInt(custKey, 10) };
      if (area) params.custArea = { type: sql.NVarChar, value: area };
      if (manager) params.manager = { type: sql.NVarChar, value: manager };

      let sqlText = sqlShipmentViewGetData({
        custKey: custKey ? parseInt(custKey, 10) : null,
        custArea: area || null,
        manager: manager || null,
      });
      if (custName) {
        sqlText = `SELECT * FROM (${sqlText}) x WHERE x.CustName LIKE @custName`;
        params.custName = { type: sql.NVarChar, value: `%${custName}%` };
      }
      const result = await query(sqlText, params);
      return res.status(200).json({ success: true, source: 'real_db_exe_parity', shipments: result.recordset });
    }

    let where = 'WHERE 1=1';
    const params = {};
    if (week) { where += ' AND vs.OrderWeek = @week'; params.week = { type: sql.NVarChar, value: normalizeOrderWeek(week) }; }
    if (custName) { where += ' AND vs.CustName LIKE @custName'; params.custName = { type: sql.NVarChar, value: `%${custName}%` }; }
    if (area) { where += ' AND vs.CustArea = @area'; params.area = { type: sql.NVarChar, value: area }; }
    if (manager) { where += ' AND vs.Manager = @manager'; params.manager = { type: sql.NVarChar, value: manager }; }

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
    error: '출고 생성은 /api/shipment/distribute 또는 /api/shipment/adjust 를 사용하세요.',
  });
}
