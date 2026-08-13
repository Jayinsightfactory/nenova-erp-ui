import { query, sql } from '../lib/db.js';
import { reconcileWeekAfterScopedOperation } from '../lib/shipmentFixReconcile.js';

const orderYear = '2026';
const orderWeek = '30-02';
const uid = 'nenovaSS3';
const targets = [
  { prodKey: 878, target: 0 },
  { prodKey: 879, target: 5 },
  { prodKey: 3208, target: 0 },
  { prodKey: 1239, target: 0 },
  { prodKey: 1204, target: 0 },
  { prodKey: 1300, target: 0 },
  { prodKey: 389, target: 0 },
  { prodKey: 518, target: 2 },
  { prodKey: 447, target: 0 },
  { prodKey: 470, target: 1 },
  { prodKey: 504, target: 0 },
];

const result = await reconcileWeekAfterScopedOperation({
  q: query,
  sqlTypes: sql,
  orderYear,
  orderWeek,
  uid,
  alreadyCalculatedProdKeys: [],
  scopeLabel: 'approved-stock-30-recovery',
  forceFullWeekRecalc: true,
});

if (result.stockErrors.length > 0 || !result.parity.exeAligned) {
  throw new Error(`RECONCILE FAILED: ${JSON.stringify(result)}`);
}

const params = {
  yr: { type: sql.NVarChar, value: orderYear },
  wk: { type: sql.NVarChar, value: orderWeek },
  ...Object.fromEntries(targets.map((item, index) => [
    `p${index}`,
    { type: sql.Int, value: item.prodKey },
  ])),
};
const keys = targets.map((_, index) => `@p${index}`).join(',');
const verification = await query(
  `SELECT p.ProdKey,
          p.ProdName,
          CAST(ps.Stock - ISNULL(SUM(CASE WHEN ISNULL(sd.isFix, 0) = 1 THEN ISNULL(sd.OutQuantity, 0) ELSE 0 END), 0) AS DECIMAL(18, 2)) AS pageStock
     FROM Product p
     JOIN ProductStock ps ON ps.ProdKey = p.ProdKey
     JOIN StockMaster stk ON stk.StockKey = ps.StockKey
                         AND stk.OrderYear = @yr
                         AND stk.OrderWeek = @wk
     LEFT JOIN ShipmentDetail sd ON sd.ProdKey = p.ProdKey
     LEFT JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
                                AND sm.OrderYear = @yr
                                AND sm.OrderWeek = @wk
                                AND ISNULL(sm.isDeleted, 0) = 0
    WHERE p.ProdKey IN (${keys})
    GROUP BY p.ProdKey, p.ProdName, ps.Stock
    ORDER BY p.ProdKey`,
  params,
);

const expected = new Map(targets.map((item) => [item.prodKey, item.target]));
for (const row of verification.recordset) {
  const actual = Number(row.pageStock);
  const target = expected.get(Number(row.ProdKey));
  if (target === undefined || Math.abs(actual - target) > 0.001) {
    throw new Error(`TARGET MISMATCH pk=${row.ProdKey} target=${target} actual=${actual}`);
  }
  expected.delete(Number(row.ProdKey));
}
if (expected.size > 0) throw new Error(`TARGETS MISSING: ${[...expected.keys()].join(',')}`);

console.log(JSON.stringify({ result, verification: verification.recordset }, null, 2));
