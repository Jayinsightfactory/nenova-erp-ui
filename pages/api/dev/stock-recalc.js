import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

function toInt(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function loadProductStock(prodKey, weekFrom, weekTo) {
  const result = await query(
    `SELECT sm.StockKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek,
            sm.isFix AS StockMasterFix,
            CONVERT(NVARCHAR(19), sm.CreateDtm, 120) AS StockMasterCreateDtm,
            ISNULL(sm.CreateID, '') AS StockMasterCreateID,
            ISNULL(ps.Stock,0) AS ProductStock
       FROM StockMaster sm
       LEFT JOIN ProductStock ps ON ps.StockKey=sm.StockKey AND ps.ProdKey=@pk
      WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
      ORDER BY sm.OrderYearWeek, sm.OrderWeek, sm.StockKey`,
    {
      pk: { type: sql.Int, value: prodKey },
      weekFrom: { type: sql.NVarChar, value: weekFrom },
      weekTo: { type: sql.NVarChar, value: weekTo },
    }
  );
  return result.recordset || [];
}

async function loadProduct(prodKey) {
  const result = await query(
    `SELECT ProdKey, ProdCode, ProdName, FlowerName, CounName, CountryFlower,
            ISNULL(Stock,0) AS ProductStockLive
       FROM Product
      WHERE ProdKey=@pk`,
    { pk: { type: sql.Int, value: prodKey } }
  );
  return result.recordset?.[0] || null;
}

async function runStockCalculation({ orderYear, orderWeek, prodKey, uid }) {
  const hasOutput = await query(
    `SELECT COUNT(*) AS cnt
       FROM sys.parameters
      WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
        AND name = N'@oResult'`
  );

  if (Number(hasOutput.recordset?.[0]?.cnt || 0) > 0) {
    const result = await query(
      `DECLARE @r INT, @m NVARCHAR(MAX);
       EXEC dbo.usp_StockCalculation
            @OrderYear = @year,
            @OrderWeek = @week,
            @ProdKey   = @pk,
            @iUserID   = @uid,
            @oResult   = @r OUTPUT,
            @oMessage  = @m OUTPUT;
       SELECT ISNULL(@r, 0) AS result, @m AS message;`,
      {
        year: { type: sql.NVarChar, value: orderYear },
        week: { type: sql.NVarChar, value: orderWeek },
        pk: { type: sql.Int, value: prodKey },
        uid: { type: sql.NVarChar, value: uid },
      }
    );
    return result.recordset?.[0] || { result: 0, message: '' };
  }

  await query(
    `EXEC dbo.usp_StockCalculation
          @OrderYear = @year,
          @OrderWeek = @week,
          @ProdKey   = @pk,
          @iUserID   = @uid;`,
    {
      year: { type: sql.NVarChar, value: orderYear },
      week: { type: sql.NVarChar, value: orderWeek },
      pk: { type: sql.Int, value: prodKey },
      uid: { type: sql.NVarChar, value: uid },
    }
  );
  return { result: 0, message: '' };
}

export default withAuth(async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const source = req.method === 'POST' ? req.body || {} : req.query || {};
  const prodKey = toInt(source.prodKey, null);
  const orderYear = String(source.orderYear || '2026').trim();
  const orderWeek = String(source.orderWeek || '').trim();
  const weekFrom = String(source.weekFrom || orderWeek || '').trim();
  const weekTo = String(source.weekTo || orderWeek || '').trim();
  const confirm = String(source.confirm || '').trim();
  const uid = req.user?.userId || 'admin';

  if (!prodKey || !orderWeek) {
    return res.status(400).json({ success: false, error: 'prodKey, orderWeek required' });
  }
  if (confirm !== 'usp_StockCalculation') {
    return res.status(400).json({
      success: false,
      error: 'confirm=usp_StockCalculation required',
    });
  }

  try {
    const before = await loadProductStock(prodKey, weekFrom, weekTo);
    const beforeProduct = await loadProduct(prodKey);
    const sp = await runStockCalculation({ orderYear, orderWeek, prodKey, uid });
    const after = await loadProductStock(prodKey, weekFrom, weekTo);
    const afterProduct = await loadProduct(prodKey);

    return res.status(200).json({
      success: Number(sp.result || 0) === 0,
      filter: { orderYear, orderWeek, prodKey, weekFrom, weekTo },
      sp,
      product: { before: beforeProduct, after: afterProduct },
      productStock: { before, after },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      number: err.number || err.originalError?.number || null,
    });
  }
});
