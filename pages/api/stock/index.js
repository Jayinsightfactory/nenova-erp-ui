// pages/api/stock/index.js
// GET → 실제 DB 조회, POST → _new_StockHistory 저장

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getStock(req, res);
  if (req.method === 'POST') return await adjustStock(req, res);
  return res.status(405).end();
});

async function getStock(req, res) {
  const { week, prodName } = req.query;
  let where = 'WHERE p.isDeleted = 0';
  const params = {};
  if (prodName) {
    where += ' AND (p.ProdName LIKE @name OR p.FlowerName LIKE @name)';
    params.name = { type: sql.NVarChar, value: `%${prodName}%` };
  }
  try {
    // 실제 DB에서 조회
    const result = await query(
      `SELECT
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
        ISNULL(p.Stock, 0) AS Stock,
        ISNULL(
          (SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey
             AND wm.OrderWeek = @week AND wm.isDeleted = 0), 0) AS inQty,
        ISNULL(
          (SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           WHERE sd.ProdKey = p.ProdKey
             AND sm.OrderWeek = @week AND sm.isDeleted = 0), 0) AS outQty
       FROM Product p
       ${where}
       ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      { ...params, week: { type: sql.NVarChar, value: week || '' } }
    );
    return res.status(200).json({
      success: true,
      source: 'real_db',
      count: result.recordset.length,
      stock: result.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function adjustStock(req, res) {
  const { week, prodKey, prodName, qty, adjustType, descr } = req.body;
  try {
    let pk = prodKey;
    if (!pk && prodName) {
      const r = await query(
        `SELECT TOP 1 ProdKey FROM Product WHERE ProdName LIKE @n AND isDeleted = 0`,
        { n: { type: sql.NVarChar, value: `%${prodName}%` } }
      );
      if (!r.recordset[0]) return res.status(404).json({ success: false, error: '품목 없음' });
      pk = r.recordset[0].ProdKey;
    }
    // 테스트 테이블에 조정 이력 저장
    await query(
      `INSERT INTO _new_StockHistory
         (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
          BeforeValue, AfterValue, Descr, ProdKey)
       VALUES (GETDATE(), @year, @week, @uid, @type, '재고수량',
         (SELECT ISNULL(Stock,0) FROM Product WHERE ProdKey=@pk),
         (SELECT ISNULL(Stock,0) FROM Product WHERE ProdKey=@pk) - @qty,
         @descr, @pk)`,
      {
        year:  { type: sql.NVarChar, value: (week||'').split('-')[0] || new Date().getFullYear().toString() },
        week:  { type: sql.NVarChar, value: week || '' },
        uid:   { type: sql.NVarChar, value: req.user.userId },
        type:  { type: sql.NVarChar, value: adjustType },
        pk:    { type: sql.Int,      value: pk },
        qty:   { type: sql.Float,    value: parseFloat(qty) },
        descr: { type: sql.NVarChar, value: descr || '' },
      }
    );
    return res.status(200).json({
      success: true,
      source: 'test_table',
      message: `재고 조정 기록 완료 (테스트) — ${adjustType}: -${qty}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
