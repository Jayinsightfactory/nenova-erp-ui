// pages/api/stock/index.js
// GET/POST → 실제 전산 StockHistory + usp_StockCalculation 기준

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getStock(req, res);
  if (req.method === 'POST') return await adjustStock(req, res);
  return res.status(405).end();
});

async function getStock(req, res) {
  const { week, prodName, type, prodKey } = req.query;

  // ── 재고 입/출고 내역 조회 (오른쪽 패널용)
  if (type === 'history') {
    if (!week || !prodKey) return res.status(400).json({ success: false, error: 'week, prodKey 필요' });
    try {
      const result = await query(
        `SELECT '입고' AS 구분, wm.InputDate AS 일자,
                wd.OutQuantity AS 변경수량, wm.FarmName AS 비고
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
         WHERE wd.ProdKey = @pk AND wm.OrderWeek = @week AND wm.isDeleted = 0
         UNION ALL
         SELECT '출고' AS 구분, CONVERT(VARCHAR,sd.CreateDtm,23) AS 일자,
                -sd.OutQuantity AS 변경수량, c.CustName AS 비고
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         WHERE sd.ProdKey = @pk AND sm.OrderWeek = @week AND sm.isDeleted = 0
         UNION ALL
         SELECT sh.ChangeType AS 구분, CONVERT(VARCHAR,sh.ChangeDtm,23) AS 일자,
                (ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS 변경수량, sh.Descr AS 비고
         FROM StockHistory sh
         WHERE sh.ProdKey = @pk AND sh.OrderWeek = @week
         ORDER BY 일자 ASC`,
        {
          week: { type: sql.NVarChar, value: week },
          pk:   { type: sql.Int,      value: parseInt(prodKey) },
        }
      );
      return res.status(200).json({ success: true, history: result.recordset });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── 재고 목록 조회
  let where = 'WHERE p.isDeleted = 0';
  const params = {};
  if (prodName) {
    where += ' AND (p.ProdName LIKE @name OR p.FlowerName LIKE @name)';
    params.name = { type: sql.NVarChar, value: `%${prodName}%` };
  }
  try {
    const result = await query(
      `SELECT
        p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
        ISNULL(sm2.StockKey, 0) AS StockKey,
        ISNULL(ps.Stock, 0) AS prevStock,
        ISNULL(
          (SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey
             AND wm.OrderWeek = @week AND wm.isDeleted = 0), 0) AS inQty,
        ISNULL(
          (SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           WHERE sd.ProdKey = p.ProdKey
             AND sm.OrderWeek = @week AND sm.isDeleted = 0), 0) AS outQty,
        ISNULL(
          (SELECT SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) FROM StockHistory sh
           WHERE sh.ProdKey = p.ProdKey AND sh.OrderWeek = @week), 0) AS adjustQty
       FROM Product p
       LEFT JOIN StockMaster sm2 ON sm2.OrderWeek = @week
       LEFT JOIN ProductStock ps ON p.ProdKey = ps.ProdKey AND ps.StockKey = sm2.StockKey
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
    const stockQty = parseFloat(qty);
    if (!(stockQty > 0)) return res.status(400).json({ success: false, error: '수량은 0보다 커야 합니다.' });

    const orderYear = await resolveOrderYear(week);
    const uid = req.user?.userId || 'admin';
    const beforeResult = await query(
      `SELECT ISNULL(Stock,0) AS Stock FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: pk } }
    );
    const before = Number(beforeResult.recordset[0]?.Stock || 0);
    const after = before - stockQty;

    await withTransaction(async (tQuery) => {
      await tQuery(
        `INSERT INTO StockHistory
           (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
            BeforeValue, AfterValue, Descr, ProdKey)
         VALUES (GETDATE(), @year, @week, @uid, @type, N'재고수량',
           @before, @after, @descr, @pk)`,
        {
          year:   { type: sql.NVarChar, value: orderYear },
          week:   { type: sql.NVarChar, value: week || '' },
          uid:    { type: sql.NVarChar, value: uid },
          type:   { type: sql.NVarChar, value: adjustType },
          pk:     { type: sql.Int,      value: pk },
          before: { type: sql.Float,    value: before },
          after:  { type: sql.Float,    value: after },
          descr:  { type: sql.NVarChar, value: descr || '' },
        }
      );

      await tQuery(
        stockCalculationSql(),
        {
          year: { type: sql.NVarChar, value: orderYear },
          week: { type: sql.NVarChar, value: week || '' },
          uid:  { type: sql.NVarChar, value: uid },
        }
      );
    });

    return res.status(200).json({
      success: true,
      source: 'real_db',
      message: `재고 조정 등록 완료 — ${adjustType}: -${qty}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function resolveOrderYear(week) {
  const r = await query(
    `SELECT TOP 1 OrderYear
       FROM StockMaster
      WHERE OrderWeek=@week AND OrderYear IS NOT NULL
      ORDER BY OrderYear DESC`,
    { week: { type: sql.NVarChar, value: week || '' } }
  );
  return String(r.recordset[0]?.OrderYear || new Date().getFullYear());
}

function stockCalculationSql() {
  return `IF EXISTS (
            SELECT 1 FROM sys.parameters
             WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
               AND name = N'@oResult'
          )
          BEGIN
            DECLARE @r INT, @m NVARCHAR(MAX);
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @iUserID   = @uid,
                 @oResult   = @r OUTPUT,
                 @oMessage  = @m OUTPUT;
            SELECT @r AS result, @m AS message;
          END
          ELSE
          BEGIN
            EXEC dbo.usp_StockCalculation
                 @OrderYear = @year,
                 @OrderWeek = @week,
                 @iUserID   = @uid;
          END`;
}
