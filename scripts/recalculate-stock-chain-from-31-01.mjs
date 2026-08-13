import { sql, withTransaction } from '../lib/db.js';

const year = '2026';
const week = '31-01';
const userId = 'nenovaSS3';
const productKeys = [878, 879, 3208, 1239, 1204, 1300, 389, 518, 447, 470, 504];
const params = {
  yr: { type: sql.NVarChar, value: year },
  wk: { type: sql.NVarChar, value: week },
  ...Object.fromEntries(productKeys.map((key, index) => [`p${index}`, { type: sql.Int, value: key }])),
};
const inList = productKeys.map((_, index) => `@p${index}`).join(',');

function shipmentFingerprint(tQuery) {
  return tQuery(
    `SELECT COUNT(*) detailCount,
            CAST(ISNULL(SUM(sd.OutQuantity), 0) AS DECIMAL(18,4)) outQty,
            SUM(CASE WHEN ISNULL(sd.isFix, 0) = 1 THEN 1 ELSE 0 END) fixedCount
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      WHERE sm.OrderYear = @yr
        AND sm.OrderWeek >= @wk
        AND ISNULL(sm.isDeleted, 0) = 0`,
    params
  );
}

const output = await withTransaction(async (tQuery) => {
  const shipmentBefore = (await shipmentFingerprint(tQuery)).recordset[0];
  const results = [];

  for (const prodKey of productKeys) {
    const response = await tQuery(
      `DECLARE @result INT, @message NVARCHAR(MAX);
       EXEC dbo.usp_StockCalculation
            @OrderYear = @yr,
            @OrderWeek = @wk,
            @ProdKey = @pk,
            @iUserID = @uid,
            @oResult = @result OUTPUT,
            @oMessage = @message OUTPUT;
       SELECT ISNULL(@result, 0) result, @message message;`,
      {
        ...params,
        pk: { type: sql.Int, value: prodKey },
        uid: { type: sql.NVarChar, value: userId },
      }
    );
    const row = response.recordset.at(-1) || {};
    results.push({ prodKey, ...row });
    if (Number(row.result) !== 0) {
      throw new Error(`CALC FAILED pk=${prodKey} ${JSON.stringify(row)}`);
    }
  }

  const shipmentAfter = (await shipmentFingerprint(tQuery)).recordset[0];
  if (JSON.stringify(shipmentBefore) !== JSON.stringify(shipmentAfter)) {
    throw new Error('SHIPMENT CHANGED');
  }

  const parity = await tQuery(
    `WITH stock AS (
       SELECT ps.ProdKey, ps.Stock, sm.OrderYearWeek
         FROM StockMaster sm
         JOIN ProductStock ps ON ps.StockKey = sm.StockKey
     ), calculated AS (
       SELECT p.ProdKey,
              p.ProdName,
              ISNULL(currentStock.Stock, 0) savedStock,
              ROUND(ISNULL(previousStock.Stock, 0)
                + ISNULL(warehouse.qty, 0)
                - ISNULL(shipment.qty, 0)
                + ISNULL(adjustment.qty, 0), 2) formulaStock
         FROM Product p
         JOIN stock currentStock
           ON currentStock.OrderYearWeek = N'20263101'
          AND currentStock.ProdKey = p.ProdKey
         LEFT JOIN stock previousStock
           ON previousStock.OrderYearWeek = N'20263002'
          AND previousStock.ProdKey = p.ProdKey
         LEFT JOIN (
           SELECT ProdKey, SUM(OutQuantity) qty
             FROM ViewWarehouse
            WHERE OrderYearWeek2 = N'20263101'
            GROUP BY ProdKey
         ) warehouse ON warehouse.ProdKey = p.ProdKey
         LEFT JOIN (
           SELECT ProdKey, SUM(OutQuantity) qty
             FROM ViewShipment
            WHERE OrderYearWeek2 = N'20263101'
            GROUP BY ProdKey
         ) shipment ON shipment.ProdKey = p.ProdKey
         LEFT JOIN (
           SELECT sh.ProdKey, SUM(sh.AfterValue - sh.BeforeValue) qty
             FROM StockHistory sh
             JOIN CodeInfo ci
               ON ci.Category = N'StockType'
              AND ci.Descr = sh.ChangeType
            WHERE sh.OrderYear = N'2026'
              AND sh.OrderWeek = N'31-01'
            GROUP BY sh.ProdKey
         ) adjustment ON adjustment.ProdKey = p.ProdKey
        WHERE p.ProdKey IN (${inList})
     )
     SELECT *, CAST(savedStock - formulaStock AS DECIMAL(18,4)) diff
       FROM calculated
      ORDER BY ProdKey`,
    params
  );
  const bad = parity.recordset.filter((row) => Math.abs(Number(row.diff)) > 0.001);
  if (bad.length) {
    throw new Error(`PARITY FAILED ${JSON.stringify(bad)}`);
  }

  return { results, shipmentBefore, shipmentAfter, parity: parity.recordset };
});

console.log(JSON.stringify(output, null, 2));
