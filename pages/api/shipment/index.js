// pages/api/shipment/index.js — GET → exe FormShipmentView.GetData
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek, requireOrderYear } from '../../../lib/orderUtils';
import { useExeParityFlag } from '../../../lib/exeParity/common.js';
import { sqlShipmentViewGetData } from '../../../lib/exeShipmentViewSql.js';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getShipments(req, res);
  if (req.method === 'POST') return await createShipment(req, res);
  return res.status(405).end();
});

async function resolveShipmentListWeek(week, explicitYear = '') {
  const norm = normalizeOrderWeek(week || '');
  if (!norm) {
    if (!/^\d{4}$/.test(String(explicitYear || ''))) {
      const error = new Error('출고 목록을 조회할 연도를 선택하세요.');
      error.code = 'ORDER_YEAR_REQUIRED';
      throw error;
    }
    const r = await query(
      `SELECT TOP 1 OrderYear, OrderWeek FROM ShipmentMaster
        WHERE isDeleted=0 AND (@yr=N'' OR CAST(OrderYear AS NVARCHAR(4))=@yr)
        ORDER BY CreateDtm DESC`,
      { yr: { type: sql.NVarChar, value: String(explicitYear || '') } }
    );
    return { orderYear: String(r.recordset[0]?.OrderYear || explicitYear), orderWeek: r.recordset[0]?.OrderWeek || '' };
  }
  const selected = requireOrderYear(week, explicitYear);
  const r = await query(
    `SELECT TOP 1 OrderYear, OrderWeek FROM ShipmentMaster
      WHERE isDeleted=0 AND CAST(OrderYear AS NVARCHAR(4))=@yr AND OrderWeek=@ow
      ORDER BY CreateDtm DESC`,
    {
      ow: { type: sql.NVarChar, value: norm },
      yr: { type: sql.NVarChar, value: selected.orderYear },
    }
  );
  const row = r.recordset[0];
  return {
    orderYear: String(row?.OrderYear || selected.orderYear),
    orderWeek: row?.OrderWeek || norm,
  };
}

async function getShipments(req, res) {
  const { week, orderYear: requestedYear, year, custName, area, manager, custKey, exeParity } = req.query;
  const useExe = useExeParityFlag(exeParity);

  try {
    if (useExe) {
      const { orderYear, orderWeek } = await resolveShipmentListWeek(week, requestedYear || year || '');
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
    if (week) {
      const { orderYear: resolvedYear, orderWeek: normalizedWeek } = requireOrderYear(week, requestedYear || year || '');
      where += ' AND vs.OrderWeek = @week AND vs.OrderYear = @orderYear';
      params.week = { type: sql.NVarChar, value: normalizedWeek };
      params.orderYear = { type: sql.NVarChar, value: resolvedYear };
    }
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
    const status = ['ORDER_YEAR_REQUIRED', 'ORDER_YEAR_MISMATCH', 'INVALID_ORDER_YEAR', 'INVALID_ORDER_WEEK'].includes(err.code) ? 400 : 500;
    return res.status(status).json({ success: false, code: err.code, error: err.message });
  }
}

async function createShipment(req, res) {
  return res.status(410).json({
    success: false,
    error: '출고 생성은 /api/shipment/distribute 또는 /api/shipment/adjust 를 사용하세요.',
  });
}
